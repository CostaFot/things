// Fetch a page title and a preview image for a URL. Zero deps: global fetch.
// Shared by scripts/capture.js and scripts/migrate-index.js.
const fs = require("node:fs");
const path = require("node:path");

const UA = "Mozilla/5.0 (X11; Linux x86_64) things-feed/2 (+https://things.costafotiadis.com)";
const TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 1024 * 1024;

const YT_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([A-Za-z0-9_-]{11})/;

function youtubeId(url) {
  const m = YT_RE.exec(url);
  return m ? m[1] : null;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function get(url, accept) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res;
}

function decode(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}

function metaContent(html, ...names) {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
    const tag = re.exec(html);
    if (!tag) continue;
    const c = /content=["']([^"']*)["']/i.exec(tag[0]);
    if (c && c[1]) return decode(c[1]);
  }
  return null;
}

// Returns { title, image } — either may be null. Never throws.
async function fetchMeta(url) {
  const yt = youtubeId(url);
  if (yt) {
    let title = null;
    try {
      const r = await get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, "application/json");
      if (r.ok) title = (await r.json()).title || null;
    } catch {}
    return { title, image: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` };
  }
  try {
    const r = await get(url, "text/html,application/xhtml+xml");
    if (!r.ok) return { title: null, image: null };
    const html = (await r.text()).slice(0, 400_000);
    const ogTitle = metaContent(html, "og:title", "twitter:title");
    const t = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    const title = ogTitle || (t ? decode(t[1]) : null);
    let image = metaContent(html, "og:image", "og:image:url", "twitter:image", "twitter:image:src");
    if (image) {
      try { image = new URL(image, r.url).href; } catch { image = null; }
    }
    return { title, image };
  } catch {
    return { title: null, image: null };
  }
}

const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

// Downloads an image to destDir/<baseName>.<ext>. Returns the repo-relative
// path or null (too big, not an image, network error). Never throws.
async function downloadImage(url, destDir, baseName, repoRoot) {
  try {
    const r = await get(url, "image/*");
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
    const ext = EXT[ct];
    if (!ext) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES || buf.length < 100) return null;
    fs.mkdirSync(destDir, { recursive: true });
    const file = path.join(destDir, baseName + ext);
    fs.writeFileSync(file, buf);
    return path.relative(repoRoot, file).split(path.sep).join("/");
  } catch {
    return null;
  }
}

module.exports = { fetchMeta, downloadImage, youtubeId, domainOf };
