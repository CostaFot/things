// Dependency-free static server for the built site in ./site.
// Copied from CostaFot/stats and extended with image/feed MIME types.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "site");
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
};

function cacheControl(rel, ext) {
  if (ext === ".html" || ext === ".json" || ext === ".xml") return "no-cache";
  if (rel.startsWith("images/")) return "public, max-age=31536000, immutable";
  return "public, max-age=300";
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
  .listen(PORT, () => console.log(`Serving ${ROOT} on http://localhost:${PORT}`));
