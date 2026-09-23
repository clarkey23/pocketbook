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

function normSpace(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function isBoilerplateLine(text) {
  return /^\*{3}\s*(START|END) OF (?:THE|THIS) PROJECT GUTENBERG/i.test(text);
}

function isContentsHeading(text) {
  return /^(table of\s+)?contents$/i.test(normSpace(text));
}

function isIllustrationsHeading(text) {
  return /^(list of\s+)?illustrations$/i.test(normSpace(text));
}

function isPgEditionPicker(text) {
  return /several editions of this ebook/i.test(text || "");
}

function isPageRefText(text) {
  const t = normSpace(text);
  if (!t) return true;
  if (/^\d+([–—-]\d+)?$/.test(t)) return true;
  if (/^[ivxlcdm]+$/i.test(t)) return true;
  if (/^p\.?\s*\d+$/i.test(t)) return true;
  return false;
}

function isPageTargetId(id) {
  return /^page_?\d+$/i.test(id || "");
}

function anchorTarget(a) {
  const href = (a.getAttribute("href") || "").trim();
  if (!href.startsWith("#") || href === "#") return "";
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

/** id on el, nested named anchor, or empty anchor just before. */
function headingId(el) {
  if (el.id) return el.id;
  const nested = el.querySelector("[id], a[name]");
  if (nested) return nested.id || nested.getAttribute("name") || "";
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.tagName === "A") {
      const id = prev.id || prev.getAttribute("name") || "";
      if (id && !normSpace(prev.textContent)) return id;
      prev = prev.previousElementSibling;
      continue;
    }
    if (
      (prev.tagName === "P" || prev.tagName === "DIV" || prev.tagName === "SPAN") &&
      !normSpace(prev.textContent).replace(/\[\d+\]/g, "")
    ) {
      const inner = prev.querySelector("[id], a[name]");
      if (inner) return inner.id || inner.getAttribute("name") || "";
    }
    break;
  }
  return "";
}

/**
 * Locate the original CONTENTS block across common Gutenberg shapes:
 * heading + following toc-like siblings, div.contents, p.toc, table summary=Contents.
 */
function isTocLikeElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "BR" || tag === "HR") return true;
  if (tag === "TABLE" || tag === "UL" || tag === "OL" || tag === "DL") return true;
  if (tag === "NAV") return true;
  const cls = (el.getAttribute("class") || "").toLowerCase();
  if (/\b(toc|contents)\b/.test(cls)) return true;
  if (tag === "P" && el.querySelector('a[href^="#"]')) return true;
  if (tag === "DIV" && el.querySelector('a[href^="#"]') && !el.querySelector("h1, h2, h3, h4, h5, h6")) {
    return true;
  }
  return false;
}

function findTocRegion(doc) {
  const skip = new Set();
  let roots = [];
  let tocHeading = null;

  tocHeading = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")].find((h) =>
    isContentsHeading(h.textContent)
  );
  if (tocHeading) {
    skip.add(tocHeading);
    let el = tocHeading.nextElementSibling;
    while (el) {
      if (/^H[1-6]$/.test(el.tagName)) break;
      // Body chapters are often wrapped in div.chapter — stop before them.
      if (/\bchapter\b/i.test(el.getAttribute("class") || "")) break;
      if (el.querySelector?.("h1, h2, h3, h4, h5, h6")) break;
      if (!isTocLikeElement(el)) break;
      roots.push(el);
      skip.add(el);
      el = el.nextElementSibling;
    }
  }

  if (!roots.length) {
    const tagged = [
      ...doc.querySelectorAll(
        'table[data-summary="Contents"], table[data-summary="contents"], div.contents, p.toc, div.toc, nav.toc'
      ),
    ];
    for (const el of tagged) {
      roots.push(el);
      skip.add(el);
    }
  }

  // Drop illustration indexes (images are stripped anyway).
  const illusHeading = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")].find((h) =>
    isIllustrationsHeading(h.textContent)
  );
  if (illusHeading) {
    skip.add(illusHeading);
    let el = illusHeading.nextElementSibling;
    while (el) {
      if (/^H[1-6]$/.test(el.tagName)) break;
      if (/\bchapter\b/i.test(el.getAttribute("class") || "")) break;
      if (el.querySelector?.("h1, h2, h3, h4, h5, h6")) break;
      if (!isTocLikeElement(el) && el.tagName !== "TABLE") break;
      skip.add(el);
      el = el.nextElementSibling;
    }
  }

  return { roots, skip, tocHeading };
}

/** First real chapter/body marker after the title + contents. */
function findBodyStart(doc, tocEntries, tocHeading) {
  const targets = new Set((tocEntries || []).map((e) => e.targetId.toLowerCase()));

  for (const h of doc.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (isContentsHeading(h.textContent) || isIllustrationsHeading(h.textContent)) continue;
    const id = headingId(h);
    if (id && targets.has(id.toLowerCase())) return h;
  }

  const chapter = doc.querySelector(".chapter");
  if (chapter) {
    return chapter.querySelector("h1, h2, h3, h4, h5, h6") || chapter;
  }

  if (tocHeading) {
    let el = tocHeading.nextElementSibling;
    while (el) {
      if (/^H[1-6]$/.test(el.tagName) && !isContentsHeading(el.textContent) && !isIllustrationsHeading(el.textContent)) {
        return el;
      }
      const nested = el.querySelector?.("h1, h2, h3, h4, h5, h6");
      if (
        nested &&
        !isContentsHeading(nested.textContent) &&
        !isIllustrationsHeading(nested.textContent)
      ) {
        return nested;
      }
      el = el.nextElementSibling;
    }
  }

  // No TOC: body starts at first id-bearing heading after the first title-ish block.
  const headings = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  for (let i = 1; i < headings.length; i++) {
    if (headingId(headings[i])) return headings[i];
  }
  return null;
}

function isAtOrAfter(el, start) {
  if (!start) return true;
  if (el === start || start.contains(el)) return true;
  const pos = start.compareDocumentPosition(el);
  return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING);
}

function entryFromLink(a, titleOverride) {
  const targetId = anchorTarget(a);
  if (!targetId || isPageTargetId(targetId)) return null;
  const title = normSpace(titleOverride || a.textContent);
  if (!title || isPageRefText(title)) return null;
  return { title, targetId };
}

/** Pull {title, targetId} list from a TOC region. */
function extractTocEntries(roots) {
  const entries = [];
  const seen = new Set();

  const push = (entry) => {
    if (!entry || seen.has(entry.targetId)) return;
    seen.add(entry.targetId);
    entries.push(entry);
  };

  for (const root of roots) {
    const rows = root.tagName === "TR" ? [root] : [...root.querySelectorAll("tr")];
    if (rows.length) {
      for (const tr of rows) {
        const links = [...tr.querySelectorAll('a[href^="#"]')].filter((a) => {
          const id = anchorTarget(a);
          return id && !isPageTargetId(id) && !isPageRefText(a.textContent);
        });
        if (!links.length) continue;
        // Prefer cell texts so Alice-style "CHAPTER I." + "Down the Rabbit-Hole" join cleanly.
        const cells = [...tr.querySelectorAll("td, th")]
          .map((td) => normSpace(td.textContent))
          .filter((t) => t && !isPageRefText(t));
        let title = cells.join(" ").replace(/\s+/g, " ").trim();
        if (!title) title = normSpace(links[0].textContent);
        push(entryFromLink(links[0], title));
      }
      continue;
    }

    for (const a of root.querySelectorAll('a[href^="#"]')) {
      push(entryFromLink(a));
    }
  }

  return entries;
}

/**
 * Clean Gutenberg HTML → { title, frontBlocks, bodyBlocks, tocEntries }.
 * Front matter (title/author/publisher) then CONTENTS then body on a fresh page.
 */
export function prepareBookFromHtml(htmlString, fallbackName = "book") {
  const parser = new DOMParser();
  const titleDoc = parser.parseFromString(htmlString, "text/html");
  const title = guessTitle(titleDoc, fallbackName);

  const doc = parser.parseFromString(clipToGutenbergBook(htmlString), "text/html");

  doc.querySelectorAll("#pg-header, #pg-footer, script, style, link, noscript").forEach((el) => el.remove());
  doc.querySelectorAll("img, svg, picture, source, object, embed, video, audio, iframe").forEach((el) => el.remove());

  const { roots, skip, tocHeading } = findTocRegion(doc);
  const tocEntries = extractTocEntries(roots);
  const bodyStart = findBodyStart(doc, tocEntries, tocHeading);

  // Capture ids before unwrapping anchors.
  const idByElement = new WeakMap();
  for (const el of doc.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const id = headingId(el);
    if (id) idByElement.set(el, id);
  }

  for (const a of [...doc.querySelectorAll("a")]) {
    a.replaceWith(doc.createTextNode(a.textContent || ""));
  }

  doc.querySelectorAll("figure").forEach((fig) => {
    if (!normSpace(fig.textContent)) fig.remove();
  });

  const frontBlocks = [];
  const bodyBlocks = [];
  const root = doc.body || doc;

  const inSkip = (el) => {
    for (const s of skip) {
      if (s === el || s.contains(el)) return true;
    }
    return false;
  };

  const pushText = (type, el) => {
    if (inSkip(el)) return;
    const text = normSpace(el.textContent);
    if (!text || isBoilerplateLine(text) || isPgEditionPicker(text)) return;
    // Skip orphan edition-table rows / filenumber lines near the picker.
    if (/^\d+\s*\(.*illustrations?/i.test(text)) return;
    if (/^\[\d+\]$/.test(text)) return;

    const block = { type, text };
    const id = idByElement.get(el);
    if (id) block.id = id;

    if (bodyStart && isAtOrAfter(el, bodyStart)) bodyBlocks.push(block);
    else frontBlocks.push(block);
  };

  const nodes = root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, blockquote, li, pre, tr");
  if (nodes.length) {
    nodes.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag !== "tr" && el.closest("table")) return;
      if (/^h[1-6]$/.test(tag)) pushText("heading", el);
      else pushText("para", el);
    });
  } else {
    const text = normSpace(root.textContent);
    if (text && !isBoilerplateLine(text)) bodyBlocks.push({ type: "para", text });
  }

  // If split failed, keep prior behaviour: everything is body.
  if (!bodyBlocks.length && frontBlocks.length) {
    return { title, frontBlocks: [], bodyBlocks: frontBlocks, tocEntries };
  }

  return { title, frontBlocks, bodyBlocks, tocEntries };
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
