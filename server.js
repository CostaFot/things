// Dependency-free static server for the built site in ./site, plus /media/*
// served from the Railway volume (videos are too big for git).
// Copied from CostaFot/stats and extended with image/feed MIME types.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "site");
// Railway mounts the volume at /data and sets RAILWAY_VOLUME_MOUNT_PATH;
// locally ./media (gitignored) mirrors it. MEDIA_DIR overrides both.
const MEDIA = path.resolve(
  process.env.MEDIA_DIR ||
    (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "media") : path.join(__dirname, "media")),
);
const PORT = process.env.PORT || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/rss+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function cacheControl(rel, ext) {
  if (ext === ".html" || ext === ".json" || ext === ".xml") return "no-cache";
  if (rel.startsWith("images/") || rel.startsWith("media/")) return "public, max-age=31536000, immutable";
  return "public, max-age=300";
}

// Streams a file with HTTP Range support so <video> can seek. Ids never
// collide (one file per entry), so everything under /media is immutable.
function serveMedia(req, res, rel) {
  const file = path.resolve(MEDIA, rel.slice("media/".length));
  if (!file.startsWith(MEDIA + path.sep)) { res.writeHead(403).end("Forbidden"); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": cacheControl(rel, ext),
      "Accept-Ranges": "bytes",
    };
    let start = 0, end = st.size - 1, status = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
      else { start = Math.max(st.size - Number(m[2]), 0); } // suffix range: last N bytes
      if (start > end || start >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
  });
}

http
  .createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
    if (rel.startsWith("media/")) { serveMedia(req, res, rel); return; }
    const file = path.resolve(ROOT, rel);

    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": cacheControl(rel, ext),
      });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Serving ${ROOT} on http://localhost:${PORT} (media from ${MEDIA})`));
