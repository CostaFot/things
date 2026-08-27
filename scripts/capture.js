#!/usr/bin/env node
// Write a new entry. Used by the /things skill.
//   node scripts/capture.js --type link  --url URL [--text "comment"]
//   node scripts/capture.js --type idea  --text "…"
//   node scripts/capture.js --type note  --text "…"
//   node scripts/capture.js --type photo --file /path/to.jpg [--text "caption"]
//   node scripts/capture.js --type video --file /path/to.mp4 [--text "caption"]
// Options: --no-fetch (skip title/preview), --date ISO (override, must carry an offset),
//          --no-upload (video: keep the local media/ copy only, skip the Railway upload)
// Videos are not committed: the file is copied to media/<id>.<ext> (gitignored
// mirror) and uploaded to the Railway volume with `railway volume files upload`.
// Prints the path of the written file, then the entry JSON. Exits 1 on any problem.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { fetchMeta, downloadImage, domainOf } = require("../src/fetch-meta.js");
const { validateEntry, loadTags, ROOT, ENTRIES, DATE_RE } = require("../src/validate.js");

// Railway volume `media`, mounted at /data on the `things` service. server.js
// serves /data/media/* as /media/*. Ids are in skill/SKILL.md too.
const RAILWAY = {
  project: "5335fc44-4a68-4f44-8668-61e72b879033",
  service: "fac0a982-4553-4d4b-950a-461292cfc42a",
  env: "b49eb826-41a2-4283-90b8-dafc3199f155",
  volume: "media",
};
const VIDEO_EXT = [".mp4", ".webm", ".mov"];

function uploadToVolume(local, remote) {
  const argv = ["volume", "-p", RAILWAY.project, "-s", RAILWAY.service, "-e", RAILWAY.env,
    "files", "--volume", RAILWAY.volume, "upload", local, remote, "--json"];
  const r = spawnSync("railway", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) throw new Error(`railway CLI not runnable: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`railway upload failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) throw new Error(`unexpected argument: ${a[i]}`);
    const k = a[i].slice(2);
    if (k === "no-fetch") { o.noFetch = true; continue; }
    if (k === "no-upload") { o.noUpload = true; continue; }
    o[k] = a[++i];
    if (o[k] === undefined) throw new Error(`--${k} needs a value`);
  }
  return o;
}

function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

function utcStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

async function main() {
  const o = args();
  const type = o.type;
  if (!["idea", "note", "link", "photo", "video"].includes(type)) throw new Error("--type must be idea|note|link|photo|video");
  const text = (o.text || "").trim();
  if ((type === "idea" || type === "note") && !text) throw new Error(`--text is required for ${type}`);
  if (type === "link" && !o.url) throw new Error("--url is required for link");
  if ((type === "photo" || type === "video") && !o.file) throw new Error(`--file is required for ${type}`);
  if (o.date && !DATE_RE.test(o.date)) throw new Error("--date must be ISO with an explicit offset");

  const date = o.date || localIso();
  const when = new Date(date);
  fs.mkdirSync(ENTRIES, { recursive: true });
  let id, tries = 0;
  do { id = utcStamp(new Date(when.getTime() + tries++ * 1000)); } while (fs.existsSync(path.join(ENTRIES, `${id}.json`)));

  const e = { schema: 1, id, date, type, source: "claude", text };

  if (type === "link") {
    const url = new URL(o.url).href; // throws on garbage
    e.url = url;
    e.title = domainOf(url);
    if (!o.noFetch) {
      const meta = await fetchMeta(url);
      if (meta.title) e.title = meta.title;
      if (meta.image) {
        const src = await downloadImage(meta.image, path.join(ROOT, "images", "previews"), id, ROOT);
        if (src) e.preview = { src, origin: meta.image };
      }
    }
  }

  if (type === "photo") {
    const from = path.resolve(o.file);
    if (!fs.existsSync(from)) throw new Error(`no such file: ${from}`);
    const ext = path.extname(from).toLowerCase().replace(/^\.jpeg$/, ".jpg");
    if (![".jpg", ".png", ".webp", ".gif"].includes(ext)) throw new Error(`unsupported image type: ${ext}`);
    const rel = `images/${id}${ext}`;
    const to = path.join(ROOT, rel);
    if (from !== to) {
      if (from.startsWith(path.join(ROOT, "images") + path.sep)) fs.renameSync(from, to); else fs.copyFileSync(from, to);
    }
    e.image = rel;
  }

  let upload = null;
  if (type === "video") {
    const from = path.resolve(o.file);
    if (!fs.existsSync(from)) throw new Error(`no such file: ${from}`);
    const ext = path.extname(from).toLowerCase();
    if (!VIDEO_EXT.includes(ext)) throw new Error(`unsupported video type: ${ext} (want ${VIDEO_EXT.join("|")})`);
    const rel = `media/${id}${ext}`;
    const to = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (from !== to) fs.copyFileSync(from, to);
    e.video = rel;
    upload = { local: to, remote: `/${rel}`, bytes: fs.statSync(to).size };
  }

  const errs = validateEntry(e, `${id}.json`, loadTags());
  if (errs.length) throw new Error(`invalid entry: ${errs.join("; ")}`);
  if (upload && !o.noUpload) {
    console.error(`uploading ${(upload.bytes / 1e6).toFixed(1)} MB to railway volume ${RAILWAY.volume}:${upload.remote} …`);
    uploadToVolume(upload.local, upload.remote);
  }
  const file = path.join(ENTRIES, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(e, null, 2) + "\n");
  console.log(path.relative(ROOT, file));
  console.log(JSON.stringify(e, null, 2));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
