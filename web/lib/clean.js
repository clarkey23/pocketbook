function guessTitle(doc, fallback) {
  const meta = doc.querySelector('meta[name="dc.title"]');
  const raw = (meta?.getAttribute("content") || doc.title || fallback || "pocketbook").trim();
  const safe = raw.replace(/[^0-9a-zA-Z]+/g, "_").replace(/^_+|_+$/g, "");
  return (safe.length > 40 ? safe.slice(0, 40).replace(/_+$/, "") : safe) || "pocketbook";
}

const START_RE =
  /\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*{3}/i;
const END_RE =
  /\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*{3}/i;

/** Keep only the HTML between the Gutenberg START/END markers (text-only later). */
export function clipToGutenbergBook(html) {
  const start = START_RE.exec(html);
  const end = END_RE.exec(html);
  if (!start || !end || end.index <= start.index + start[0].length) {
    return html;
  }
  const body = html.slice(start.index + start[0].length, end.index);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

function isBoilerplateLine(text) {
  return /^\*{3}\s*(START|END) OF (?:THE|THIS) PROJECT GUTENBERG/i.test(text);
}

/**
 * Clean Gutenberg HTML and return { title, blocks: [{type, text}] }
 * Text only, clipped to *** START *** … *** END ***.
 */
export function prepareBookFromHtml(htmlString, fallbackName = "book") {
  const parser = new DOMParser();
  const titleDoc = parser.parseFromString(htmlString, "text/html");
  const title = guessTitle(titleDoc, fallbackName);

  const doc = parser.parseFromString(clipToGutenbergBook(htmlString), "text/html");

  doc.querySelectorAll("#pg-header, #pg-footer, script, style, link, noscript").forEach((el) => el.remove());
  doc.querySelectorAll("img, svg, picture, source, object, embed, video, audio, iframe").forEach((el) => el.remove());

  // Keep link text (incl. TOC entries).
  for (const a of [...doc.querySelectorAll("a")]) {
    a.replaceWith(doc.createTextNode(a.textContent || ""));
  }

  doc.querySelectorAll("figure").forEach((fig) => {
    if (!(fig.textContent || "").trim()) fig.remove();
  });

  const blocks = [];
  const root = doc.body || doc;

  const pushText = (type, el) => {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || isBoilerplateLine(text)) return;
    blocks.push({ type, text });
  };

  // Include table rows — many Gutenberg TOCs are <table>, not <p>/<li>.
  const nodes = root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, blockquote, li, pre, tr");
  if (nodes.length) {
    nodes.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      // Don't also emit cell <p>/<li> text when the whole row is already collected.
      if (tag !== "tr" && el.closest("table")) return;
      if (/^h[1-6]$/.test(tag)) pushText("heading", el);
      else pushText("para", el);
    });
  } else {
    const text = (root.textContent || "").replace(/\s+/g, " ").trim();
    if (text && !isBoilerplateLine(text)) blocks.push({ type: "para", text });
  }

  return { title, blocks };
}

export async function extractHtmlFromZip(arrayBuffer, onStatus) {
  onStatus?.(2, "Extracting book…");
  const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  const zip = await JSZip.loadAsync(arrayBuffer);
  const htmlName = Object.keys(zip.files).find((name) => /\.html?$/i.test(name) && !zip.files[name].dir);
  if (!htmlName) throw new Error("No HTML file found in that Gutenberg download.");
  const html = await zip.files[htmlName].async("string");
  onStatus?.(3, "Preparing text…");
  const base = htmlName.split("/").pop().replace(/\.html?$/i, "");
  return prepareBookFromHtml(html, base);
}
