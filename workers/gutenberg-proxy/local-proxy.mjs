#!/usr/bin/env node
/**
 * Local Gutenberg CORS proxy for web/ development.
 * Usage: node workers/gutenberg-proxy/local-proxy.mjs
 * Listens on http://127.0.0.1:8787
 */
import http from "node:http";
import { URL } from "node:url";

const PORT = 8787;
const ALLOWED = new Set([
  "www.gutenberg.org",
  "gutenberg.org",
  "gutenberg.pglaf.org",
  "www.gutenberg.pglaf.org",
  "aleph.gutenberg.org",
]);

function cors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "*";
  if (req.method === "OPTIONS") {
    cors(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const incoming = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const target = incoming.searchParams.get("url");
    if (!target) {
      cors(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing ?url=" }));
      return;
    }
    const parsed = new URL(target);
    if (!ALLOWED.has(parsed.hostname.toLowerCase())) {
      cors(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Host not allowed" }));
      return;
    }

    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "PocketBook/2.0 (+local-proxy)",
        Accept: "*/*",
      },
      redirect: "follow",
    });

    cors(res, origin);
    if (!upstream.ok) {
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Upstream ${upstream.status}` }));
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": upstream.headers.get("content-type") || "application/zip",
      "Content-Length": buf.length,
      "Access-Control-Allow-Origin": origin,
    });
    res.end(buf);
  } catch (err) {
    cors(res, origin);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Gutenberg proxy on http://127.0.0.1:${PORT}`);
});
