#!/usr/bin/env node
// Write a new entry. Used by the /things skill.
//   node scripts/capture.js --type link  --url URL [--text "comment"]
//   node scripts/capture.js --type idea  --text "…"
//   node scripts/capture.js --type note  --text "…"
//   node scripts/capture.js --type photo --file /path/to.jpg [--text "caption"]
// Options: --no-fetch (skip title/preview), --date ISO (override, must carry an offset)
// Prints the path of the written file, then the entry JSON. Exits 1 on any problem.
const fs = require("node:fs");
const path = require("node:path");
const { fetchMeta, downloadImage, domainOf } = require("../src/fetch-meta.js");
const { validateEntry, loadTags, ROOT, ENTRIES, DATE_RE } = require("../src/validate.js");

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) throw new Error(`unexpected argument: ${a[i]}`);
    const k = a[i].slice(2);
    if (k === "no-fetch") { o.noFetch = true; continue; }
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
  if (!["idea", "note", "link", "photo"].includes(type)) throw new Error("--type must be idea|note|link|photo");
  const text = (o.text || "").trim();
  if ((type === "idea" || type === "note") && !text) throw new Error(`--text is required for ${type}`);
  if (type === "link" && !o.url) throw new Error("--url is required for link");
  if (type === "photo" && !o.file) throw new Error("--file is required for photo");
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

  const errs = validateEntry(e, `${id}.json`, loadTags());
  if (errs.length) throw new Error(`invalid entry: ${errs.join("; ")}`);
  const file = path.join(ENTRIES, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(e, null, 2) + "\n");
  console.log(path.relative(ROOT, file));
  console.log(JSON.stringify(e, null, 2));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
