#!/usr/bin/env node
// One-off migration: index.md (+ git history for timestamps) -> entries/*.json.
// Idempotent: existing entry ids are skipped. Flags: --dry (no writes),
// --no-fetch (skip title/preview fetching).
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { fetchMeta, downloadImage, domainOf } = require("../src/fetch-meta.js");
const { validateEntry, loadTags, ROOT, ENTRIES } = require("../src/validate.js");

const DRY = process.argv.includes("--dry");
const NO_FETCH = process.argv.includes("--no-fetch");
const INDEX = path.join(ROOT, "index.md");
const PREVIEWS = path.join(ROOT, "images", "previews");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HEADING_RE = /^## (\d{1,2}) ([A-Z][a-z]+) (\d{4})$/;
const PHOTO_RE = /^🖼️? <img src="([^"]+)" alt="([^"]*)" width="320">(?: — (.*))?$/;
const ICON_RE = /^<img src="https:\/\/cdn\.simpleicons\.org\/[\w-]+"[^>]*> (.*)$/;
const PREFIX_LINK_RE = /^(?:🔗|▶️?) (.*)$/;
const LINK_RE = /^\[(.+)\]\((\S+?)\)(?: — (.*))?$/;
const IDEA_RE = /^💡 (.*)$/;
const NOTE_RE = /^💬 (.*)$/;

const norm = (s) => s.replace(/\s+/g, " ").trim();

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// ---- 1. parse index.md ------------------------------------------------------
function parseIndex() {
  const lines = fs.readFileSync(INDEX, "utf8").split("\n");
  const raw = [];
  let heading = null;
  let cur = null;
  for (const line of lines) {
    const h = HEADING_RE.exec(line);
    if (h) {
      const mi = MONTHS.indexOf(h[2]);
      if (mi < 0) throw new Error(`bad month in heading: ${line}`);
      heading = `${h[3]}-${String(mi + 1).padStart(2, "0")}-${h[1].padStart(2, "0")}`;
      cur = null;
      continue;
    }
    if (line.startsWith("- ")) {
      cur = { heading, first: line, body: line.slice(2), extra: [] };
      raw.push(cur);
      continue;
    }
    if (line.trim() === "") continue;
    if (!cur) throw new Error(`orphan line outside an entry: ${line}`);
    cur.extra.push(line);
  }
  return raw.map(classify);
}

function classify(r) {
  const b = r.body;
  const extra = r.extra.length ? "\n" + r.extra.join("\n") : "";
  let m;
  if ((m = PHOTO_RE.exec(b))) {
    const image = "images/" + path.posix.basename(new URL(m[1]).pathname);
    const alt = m[2];
    const caption = m[3] !== undefined ? m[3] : (/^Image \d{8}_\d{6}$/.test(alt) ? "" : alt);
    return { ...r, type: "photo", image, text: (caption + extra).trim() };
  }
  let rest = b;
  if ((m = ICON_RE.exec(rest))) rest = m[1];
  else if ((m = PREFIX_LINK_RE.exec(rest))) rest = m[1];
  if ((m = LINK_RE.exec(rest))) {
    return { ...r, type: "link", title: m[1].trim(), url: m[2], text: ((m[3] || "") + extra).trim() };
  }
  if (rest !== b) throw new Error(`link prefix but no [title](url): ${b}`);
  if ((m = IDEA_RE.exec(b))) {
    return { ...r, type: "idea", text: (m[1].replace(/^-\s+/, "") + extra).trim() };
  }
  if ((m = NOTE_RE.exec(b))) {
    let t = m[1];
    let type = "note";
    if (t.startsWith("💡 ")) { t = t.slice(2); type = "idea"; }
    return { ...r, type, text: (t + extra).trim() };
  }
  throw new Error(`unclassified entry: ${b}`);
}

// ---- 2. timestamps from git history -----------------------------------------
function lineDates() {
  const map = new Map(); // normalised "- …" line -> author date (later commits win)
  const log = git("log", "--reverse", "--format=%H %aI", "--", "index.md").trim().split("\n").filter(Boolean);
  for (const row of log) {
    const [sha, date] = row.split(" ");
    const diff = git("show", sha, "--format=", "-U0", "--", "index.md");
    for (const l of diff.split("\n")) {
      if (l.startsWith("+- ")) map.set(norm(l.slice(1)), date);
    }
  }
  return map;
}

function utcStamp(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// ---- 3. main ---------------------------------------------------------------
async function main() {
  const parsed = parseIndex();
  const dates = lineDates();
  const tags = loadTags();
  const existing = new Set(fs.existsSync(ENTRIES) ? fs.readdirSync(ENTRIES).map((f) => f.replace(/\.json$/, "")) : []);
  const usedIds = new Set(existing);

  const out = [];
  let lastOffset = "+02:00";
  const unmatched = [];
  const moved = [];

  for (const p of parsed) {
    let date = dates.get(norm(p.first));
    let precision;
    if (!date) {
      unmatched.push(p.first);
      date = `${p.heading}T12:00:00${lastOffset}`;
      precision = "day";
    } else {
      lastOffset = date.slice(-6);
    }
    let id = p.type === "photo" ? path.basename(p.image, path.extname(p.image)) : utcStamp(date);
    let base = id, n = 2;
    while (usedIds.has(id) && !existing.has(id)) id = `${base}_${n++}`;
    usedIds.add(id);

    const e = { schema: 1, id, date, type: p.type, source: "telegram", text: p.text };
    if (p.type === "link") { e.url = p.url; e.title = p.title; }
    if (p.type === "photo") e.image = p.image;
    e.migrated = true;
    if (precision) e.date_precision = precision;
    if (date.slice(0, 10) !== p.heading) moved.push({ id, heading: p.heading, local: date.slice(0, 10), text: (e.title || e.text).slice(0, 50) });
    out.push(e);
  }

  // Report
  const byType = {};
  for (const e of out) byType[e.type] = (byType[e.type] || 0) + 1;
  console.log(`parsed ${out.length} entries:`, byType);
  console.log(`timestamp unmatched (fallback to heading@12:00): ${unmatched.length}`);
  for (const u of unmatched) console.log("   ", u.slice(0, 100));
  console.log(`entries whose local day differs from the old heading: ${moved.length}`);
  for (const m of moved) console.log(`    ${m.id}  ${m.heading} -> ${m.local}  ${m.text}`);

  const fresh = out.filter((e) => !existing.has(e.id));
  console.log(`new: ${fresh.length}, already present: ${out.length - fresh.length}`);

  // Enrich links: re-fetch hostname-only titles, download previews
  if (!NO_FETCH) {
    for (const e of fresh.filter((x) => x.type === "link")) {
      const meta = await fetchMeta(e.url);
      if (meta.title && e.title === domainOf(e.url)) { console.log(`    title ${e.id}: "${e.title}" -> "${meta.title}"`); e.title = meta.title; }
      if (meta.image && !DRY) {
        const src = await downloadImage(meta.image, PREVIEWS, e.id, ROOT);
        if (src) e.preview = { src, origin: meta.image };
        console.log(`    preview ${e.id}: ${src ? src : "none"} (${domainOf(e.url)})`);
      }
    }
  }

  // Validate + write
  let bad = 0;
  for (const e of fresh) {
    const errs = validateEntry(e, `${e.id}.json`, tags);
    if (errs.length) { bad++; console.error(`INVALID ${e.id}: ${errs.join("; ")}`); }
  }
  if (bad) { console.error(`${bad} invalid entries, nothing written`); process.exit(1); }
  if (DRY) { console.log("--dry: nothing written"); return; }

  fs.mkdirSync(ENTRIES, { recursive: true });
  for (const e of fresh) fs.writeFileSync(path.join(ENTRIES, `${e.id}.json`), JSON.stringify(e, null, 2) + "\n");
  console.log(`wrote ${fresh.length} files to entries/`);

  // Orphan photos (top-level images/ not referenced by any entry)
  const referenced = new Set(out.filter((e) => e.image).map((e) => path.basename(e.image)));
  const orphans = fs.readdirSync(path.join(ROOT, "images")).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !referenced.has(f));
  for (const o of orphans) { fs.unlinkSync(path.join(ROOT, "images", o)); console.log(`deleted orphan image ${o}`); }
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
