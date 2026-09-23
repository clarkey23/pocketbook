#!/usr/bin/env node
/**
 * Production server for Coolify / Docker:
 * - serves web/ static files
 * - proxies Gutenberg zips at /proxy?url=…
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "web");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const ALLOWED = new Set([
  "www.gutenberg.org",
  "gutenberg.org",
  "gutenberg.pglaf.org",
  "www.gutenberg.pglaf.org",
  "aleph.gutenberg.org",
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".pdf": "application/pdf",
};

function cors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, obj, origin) {
  cors(res, origin);
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleProxy(req, res, incoming) {
  const origin = req.headers.origin || "*";
  if (req.method === "OPTIONS") {
    cors(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "GET only" }, origin);
    return;
  }

  const target = incoming.searchParams.get("url");
  if (!target) {
    sendJson(res, 400, { error: "Missing ?url=" }, origin);
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    sendJson(res, 400, { error: "Invalid url" }, origin);
    return;
  }

  if (!ALLOWED.has(parsed.hostname.toLowerCase())) {
    sendJson(res, 400, { error: "Host not allowed" }, origin);
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "PocketBook/2.0 (+https://github.com/clarkey23/pocketbook)",
        Accept: "*/*",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: `Upstream ${upstream.status}` }, origin);
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    cors(res, origin);
    res.writeHead(200, {
      "Content-Type": upstream.headers.get("content-type") || "application/zip",
      "Content-Length": buf.length,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(buf);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) }, origin);
  }
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function serveStatic(req, res) {
  let reqPath = new URL(req.url, "http://local").pathname;
  if (reqPath === "/") reqPath = "/index.html";

  const filePath = safeJoin(WEB_ROOT, reqPath);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (incoming.pathname === "/proxy" || incoming.pathname === "/proxy/") {
    await handleProxy(req, res, incoming);
    return;
  }
  if (incoming.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`PocketBook web on http://${HOST}:${PORT}`);
});
