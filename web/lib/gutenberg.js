export function normalizeGutenbergSource(source) {
  const raw = (source || "").trim();
  if (!raw) throw new Error("Paste a Project Gutenberg link.");

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }

  const host = url.hostname.toLowerCase();
  if (!host.endsWith("gutenberg.org") && !host.endsWith("gutenberg.pglaf.org")) {
    throw new Error("Use a Project Gutenberg link.");
  }

  const path = url.pathname || "";
  if (path.toLowerCase().endsWith(".zip")) return url.toString();

  let m = path.match(/\/ebooks\/(\d+)\/?$/);
  if (m) {
    const id = m[1];
    return `https://www.gutenberg.org/cache/epub/${id}/pg${id}-h.zip`;
  }

  m = path.match(/\/cache\/epub\/(\d+)\//);
  if (m) {
    const id = m[1];
    return `https://www.gutenberg.org/cache/epub/${id}/pg${id}-h.zip`;
  }

  throw new Error("Could not find a book id in that Gutenberg link.");
}

export function getProxyBase() {
  const saved = localStorage.getItem("pocketbook_proxy");
  if (saved) return saved.replace(/\/$/, "");
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return "http://127.0.0.1:8787";
  }
  return "https://pocketbook-gutenberg-proxy.workers.dev";
}

export async function fetchBookZip(zipUrl, onStatus) {
  const proxy = getProxyBase();
  const endpoint = `${proxy}/?url=${encodeURIComponent(zipUrl)}`;
  onStatus?.(1, "Downloading from Project Gutenberg…");
  let response;
  try {
    response = await fetch(endpoint);
  } catch {
    throw new Error(
      "Could not reach the download proxy. Run the Gutenberg proxy (see README) or set localStorage.pocketbook_proxy."
    );
  }
  if (!response.ok) {
    let detail = `Download failed (${response.status}).`;
    try {
      const data = await response.json();
      if (data?.error) detail = String(data.error);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return response.arrayBuffer();
}
