/**
 * server.mjs — 极简本地静态服务器（可选）
 * 用法：node server.mjs [端口]
 * 之后浏览器打开 http://127.0.0.1:8080
 * （也可以不启动服务器，直接双击 index.html 使用）
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.argv[2]) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ics": "text/calendar; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end("Not Found: " + req.url);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("课程表应用已启动： http://127.0.0.1:" + PORT);
});
