#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "build");
const PORT = parseInt(process.argv[2] || process.env.PORT || "3000", 10);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.normalize(path.join(ROOT, reqPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const indexPath = path.join(filePath, "index.html");
    if (fs.existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      filePath = path.join(ROOT, "index.html");
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[CoRead] Web Reader is running at http://localhost:${PORT} (or http://127.0.0.1:${PORT})`);
});
