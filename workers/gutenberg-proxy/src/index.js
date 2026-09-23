/**
 * Tiny Gutenberg proxy — fetches book zips so the browser can read them (CORS).
 * Does not generate PDFs. Free to run on Cloudflare Workers.
 */

const ALLOWED_HOSTS = new Set([
  "www.gutenberg.org",
  "gutenberg.org",
  "gutenberg.pglaf.org",
  "www.gutenberg.pglaf.org",
  "aleph.gutenberg.org",
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function badRequest(message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "GET") {
      return badRequest("GET only", origin);
    }

    const incoming = new URL(request.url);
    const target = incoming.searchParams.get("url");
    if (!target) {
      return badRequest("Missing ?url=", origin);
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return badRequest("Invalid url", origin);
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return badRequest("Only http(s) URLs allowed", origin);
    }

    if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
      return badRequest("Host not allowed", origin);
    }

    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "PocketBook/2.0 (+https://github.com/clarkey23/pocketbook)",
        Accept: "*/*",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({
          error: `Upstream ${upstream.status}`,
        }),
        {
          status: upstream.status,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    const headers = new Headers(corsHeaders(origin));
    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") || "application/octet-stream"
    );
    const len = upstream.headers.get("Content-Length");
    if (len) headers.set("Content-Length", len);
    headers.set("Cache-Control", "public, max-age=3600");

    return new Response(upstream.body, { status: 200, headers });
  },
};
