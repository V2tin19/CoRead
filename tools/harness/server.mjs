#!/usr/bin/env node
/**
 * 独立验证工具本地静态服务（零依赖）
 *
 * 用法:
 *   node tools/harness/server.mjs [port]
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const PORT = parseInt(process.argv[2] || process.env.HARNESS_PORT || "3000", 10);

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

export function createStaticServer(root = ROOT) {
  return http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split("?")[0]);
    if (reqPath === "/" || reqPath === "") {
      reqPath = "/tools/harness/index.html";
    }

    const safePath = path.normalize(path.join(root, reqPath));
    if (!safePath.startsWith(root)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    fs.stat(safePath, (err, stats) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found: " + reqPath);
        return;
      }

      let filePath = safePath;
      if (stats.isDirectory()) {
        filePath = path.join(safePath, "index.html");
      }

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not Found: " + reqPath);
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";

        res.writeHead(200, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        });
        res.end(content);
      });
    });
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const server = createStaticServer(ROOT);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[Harness Server] 运行于 http://127.0.0.1:${PORT}`);
    console.log(`[Harness Server] 验证页面: http://127.0.0.1:${PORT}/tools/harness/index.html`);
  });
}
