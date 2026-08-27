// Schema validation for entries/*.json. Used by build.js (fails the deploy on a
// bad entry), by the migrator, and by the /things skill before committing.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ENTRIES = path.join(ROOT, "entries");
const TYPES = new Set(["idea", "note", "link", "photo", "video"]);
// Videos live on the Railway volume, not in git: media/<id>.<ext>, served at /media/.
const VIDEO_RE = /^media\/\d{8}_\d{6}(_\d+)?\.(mp4|webm|mov)$/;
const POSTER_RE = /^media\/\d{8}_\d{6}(_\d+)?\.jpg$/;
const SOURCES = new Set(["claude", "telegram"]);
const ID_RE = /^\d{8}_\d{6}(_\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const KNOWN_KEYS = new Set([
  "schema", "id", "date", "type", "source", "text", "text_raw", "url", "title",
  "image", "video", "poster", "preview", "tags", "claude", "migrated", "date_precision",
]);

function loadTags() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "tags.json"), "utf8"));
}

function validateEntry(e, file, tags) {
  const errs = [];
  const name = path.basename(file, ".json");
  const need = (cond, msg) => { if (!cond) errs.push(msg); };

  need(e && typeof e === "object" && !Array.isArray(e), "not an object");
  if (errs.length) return errs;

  for (const k of Object.keys(e)) need(KNOWN_KEYS.has(k), `unknown key "${k}"`);
  need(e.schema === 1, "schema must be 1");
  need(typeof e.id === "string" && ID_RE.test(e.id), "id must be YYYYMMDD_HHMMSS");
  need(e.id === name, `id "${e.id}" != filename "${name}"`);
  need(typeof e.date === "string" && DATE_RE.test(e.date), "date must be ISO with explicit offset (no Z)");
  if (typeof e.date === "string" && DATE_RE.test(e.date)) need(!Number.isNaN(Date.parse(e.date)), "date does not parse");
  need(TYPES.has(e.type), `type must be one of ${[...TYPES].join("|")}`);
  need(SOURCES.has(e.source), `source must be one of ${[...SOURCES].join("|")}`);
  need(typeof e.text === "string", "text must be a string");
  if (e.type === "idea" || e.type === "note") need(typeof e.text === "string" && e.text.trim() !== "", "text must not be empty");
  if (e.text_raw !== undefined) need(typeof e.text_raw === "string" && e.text_raw !== e.text, "text_raw must be a string different from text");

  if (e.type === "link") {
    need(typeof e.url === "string", "link needs url");
    if (typeof e.url === "string") { try { new URL(e.url); } catch { errs.push(`url does not parse: ${e.url}`); } }
    need(typeof e.title === "string" && e.title.trim() !== "", "link needs title");
  } else {
    need(e.url === undefined && e.title === undefined, "url/title only allowed on link");
    need(e.preview === undefined, "preview only allowed on link");
  }

  if (e.type === "photo") {
    need(typeof e.image === "string" && e.image.startsWith("images/"), "photo needs image under images/");
    if (typeof e.image === "string") need(fs.existsSync(path.join(ROOT, e.image)), `image file missing: ${e.image}`);
  } else {
    need(e.image === undefined, "image only allowed on photo");
  }

  if (e.type === "video") {
    need(typeof e.video === "string" && VIDEO_RE.test(e.video), "video needs video: media/<id>.(mp4|webm|mov)");
    if (typeof e.video === "string") need(e.video.startsWith(`media/${e.id}.`), `video path must be named after the id (${e.id})`);
    if (e.poster !== undefined) need(typeof e.poster === "string" && POSTER_RE.test(e.poster) && e.poster === `media/${e.id}.jpg`, "poster must be media/<id>.jpg");
  } else {
    need(e.video === undefined && e.poster === undefined, "video/poster only allowed on video");
  }

  if (e.preview !== undefined) {
    need(e.preview && typeof e.preview.src === "string" && e.preview.src.startsWith("images/previews/"), "preview.src must be under images/previews/");
    if (e.preview && typeof e.preview.src === "string") need(fs.existsSync(path.join(ROOT, e.preview.src)), `preview file missing: ${e.preview.src}`);
    need(e.preview && typeof e.preview.origin === "string", "preview.origin must be a string");
  }

  if (e.tags !== undefined) {
    need(Array.isArray(e.tags) && e.tags.every((t) => typeof t === "string"), "tags must be an array of strings");
    if (Array.isArray(e.tags)) for (const t of e.tags) need(t in tags, `unknown tag "${t}" (add it to tags.json)`);
  }

  if (e.claude !== undefined) {
    need(e.claude && typeof e.claude === "object", "claude must be an object");
    if (e.claude && typeof e.claude === "object") {
      need(typeof e.claude.summary === "string" && e.claude.summary.trim() !== "", "claude.summary must be a non-empty string");
      need(typeof e.claude.model === "string", "claude.model must be a string");
      need(typeof e.claude.at === "string" && DATE_RE.test(e.claude.at), "claude.at must be ISO with offset");
    }
  }

  if (e.migrated !== undefined) need(e.migrated === true, "migrated must be true when present");
  if (e.date_precision !== undefined) need(e.date_precision === "day", 'date_precision must be "day" when present');
  return errs;
}

// Returns entries sorted newest first. Throws an Error listing every problem.
function loadEntries() {
  const tags = loadTags();
  const files = fs.existsSync(ENTRIES) ? fs.readdirSync(ENTRIES).filter((f) => f.endsWith(".json")).sort() : [];
  const problems = [];
  const entries = [];
  const seen = new Set();
  for (const f of files) {
    const p = path.join(ENTRIES, f);
    let e;
    try {
      e = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (err) {
      problems.push(`${f}: invalid JSON (${err.message})`);
      continue;
    }
    const errs = validateEntry(e, f, tags);
    if (errs.length) problems.push(...errs.map((m) => `${f}: ${m}`));
    else {
      if (seen.has(e.id)) problems.push(`${f}: duplicate id`);
      seen.add(e.id);
      entries.push(e);
    }
  }
  if (problems.length) {
    const err = new Error(`${problems.length} validation problem(s):\n  ${problems.join("\n  ")}`);
    err.problems = problems;
    throw err;
  }
  entries.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || (a.id < b.id ? 1 : -1));
  return { entries, tags };
}

module.exports = { loadEntries, validateEntry, loadTags, ROOT, ENTRIES, DATE_RE };

if (require.main === module) {
  try {
    const { entries } = loadEntries();
    console.log(`ok: ${entries.length} entries valid`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
