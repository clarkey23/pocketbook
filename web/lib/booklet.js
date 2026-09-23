const MM = 72 / 25.4;
const MINI_W = 75 * MM;
const MINI_H = 105 * MM;
const A4_W = 595.28;
const A4_H = 841.89;
const SHEET_MARGIN = 5 * MM; // blank edge — printers clip here; no text
const FONT_SIZE = 6;
const HEADING_SIZE = 6.5;
const LINE_HEIGHT = 7.2;
const INNER_MARGIN = 2.5 * MM;
const PAGE_NUM_SIZE = 5;
const FOOTER_H = 7; // reserve for bottom-center page number (inside mini page)

function wrapLine(font, text, size, maxWidth) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function reorderIndices(total) {
  const order = [];
  for (let i = 0; i < total; i += 8) {
    order.push(i + 1, i, i + 2, i + 7, i + 3, i + 6, i + 4, i + 5);
  }
  return order.filter((idx) => idx < total);
}

function formatTocLine(font, title, pageStr, maxWidth) {
  const pageW = font.widthOfTextAtSize(pageStr, FONT_SIZE);
  const dotW = font.widthOfTextAtSize(".", FONT_SIZE) || 1;
  const spaceW = font.widthOfTextAtSize(" ", FONT_SIZE);
  let titlePart = String(title || "").replace(/\s+/g, " ").trim();
  let titleW = font.widthOfTextAtSize(titlePart, FONT_SIZE);
  const reserved = pageW + spaceW * 2 + dotW * 3;
  while (titlePart.length > 8 && titleW + reserved > maxWidth) {
    titlePart = `${titlePart.slice(0, -2).trim()}…`;
    titleW = font.widthOfTextAtSize(titlePart, FONT_SIZE);
  }
  const dots = Math.max(3, Math.floor((maxWidth - titleW - pageW - spaceW * 2) / dotW));
  return `${titlePart} ${".".repeat(dots)} ${pageStr}`;
}

/**
 * Place a page rotated 90° or 270° into a target cell (pdf-lib coords, origin bottom-left).
 */
function drawRotatedPage(page, embedded, cell, rotation, degrees) {
  const { x, y, w, h } = cell;
  const scale = Math.min(w / embedded.height, h / embedded.width);
  const drawnW = embedded.height * scale;
  const drawnH = embedded.width * scale;
  const ox = x + (w - drawnW) / 2;
  const oy = y + (h - drawnH) / 2;

  if (rotation === 90) {
    page.drawPage(embedded, {
      x: ox + drawnW,
      y: oy,
      xScale: scale,
      yScale: scale,
      rotate: degrees(90),
    });
  } else {
    page.drawPage(embedded, {
      x: ox,
      y: oy + drawnH,
      xScale: scale,
      yScale: scale,
      rotate: degrees(270),
    });
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error("Cancelled.");
    err.name = "AbortError";
    throw err;
  }
}

/**
 * Layout blocks onto mini pages. Returns id→bodyPage (1-based) for targets.
 */
async function layoutMiniPages(PDFDocument, fontkit, fontBytes, boldBytes, blocks, signal) {
  throwIfAborted(signal);
  const content = await PDFDocument.create();
  content.registerFontkit(fontkit);
  const font = await content.embedFont(fontBytes, { subset: true });
  const bold = await content.embedFont(boldBytes, { subset: true });

  const maxWidth = MINI_W - INNER_MARGIN * 2;
  const textBottom = INNER_MARGIN + FOOTER_H;
  const stampPage = (p) => {
    p.drawText(" ", { x: 1, y: 1, size: 1, font });
  };

  let page = content.addPage([MINI_W, MINI_H]);
  let y = MINI_H - INNER_MARGIN - FONT_SIZE;
  stampPage(page);

  const idToPage = new Map();
  const headingPages = [];

  const newPage = () => {
    page = content.addPage([MINI_W, MINI_H]);
    stampPage(page);
    y = MINI_H - INNER_MARGIN - FONT_SIZE;
  };
  const ensureSpace = (needed) => {
    if (y - needed < textBottom) newPage();
  };
  const markBlock = (block) => {
    const pageNo = content.getPageCount();
    if (block.id && !idToPage.has(block.id)) idToPage.set(block.id, pageNo);
    if (block.type === "heading") {
      headingPages.push({ text: block.text, page: pageNo, id: block.id || "" });
    }
  };

  let i = 0;
  for (const block of blocks) {
    if ((i++ & 31) === 0) throwIfAborted(signal);
    const size = block.type === "heading" ? HEADING_SIZE : FONT_SIZE;
    const useFont = block.type === "heading" ? bold : font;
    const lines = wrapLine(useFont, block.text, size, maxWidth);
    if (!lines.length) continue;
    if (block.type === "heading") {
      ensureSpace(LINE_HEIGHT * 1.2);
      y -= LINE_HEIGHT * 0.15;
    }
    let marked = false;
    for (const line of lines) {
      ensureSpace(LINE_HEIGHT);
      if (!marked) {
        markBlock(block);
        marked = true;
      }
      const safe = line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
      if (!safe) continue;
      page.drawText(safe, { x: INNER_MARGIN, y, size, font: useFont });
      y -= LINE_HEIGHT;
    }
    y -= LINE_HEIGHT * 0.2;
  }

  return { content, font, bold, idToPage, headingPages, maxWidth };
}

function lookupPage(idToPage, targetId) {
  if (!targetId) return null;
  if (idToPage.has(targetId)) return idToPage.get(targetId);
  const lower = targetId.toLowerCase();
  for (const [k, v] of idToPage) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function resolveTocEntries(tocEntries, idToPage, headingPages) {
  const resolved = [];
  const seen = new Set();

  if (tocEntries?.length) {
    for (const entry of tocEntries) {
      const bodyPage = lookupPage(idToPage, entry.targetId);
      if (bodyPage == null) continue;
      if (seen.has(entry.targetId)) continue;
      seen.add(entry.targetId);
      resolved.push({ title: entry.title, bodyPage });
    }
  }

  // Fallback when the HTML had no usable CONTENTS links: chapter-like headings with ids.
  if (!resolved.length) {
    for (const h of headingPages) {
      if (!h.id) continue;
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      resolved.push({ title: h.text, bodyPage: h.page });
    }
  }

  return resolved;
}

function buildTocBlocks(font, entries, maxWidth) {
  const blocks = [{ type: "heading", text: "CONTENTS" }];
  for (const entry of entries) {
    blocks.push({
      type: "para",
      text: formatTocLine(font, entry.title, String(entry.page), maxWidth),
    });
  }
  return blocks;
}

async function mergeDocs(PDFDocument, fontkit, docs) {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  for (const doc of docs) {
    const n = doc.getPageCount();
    if (!n) continue;
    const indices = Array.from({ length: n }, (_, i) => i);
    const pages = await out.copyPages(doc, indices);
    pages.forEach((p) => out.addPage(p));
  }
  return out;
}

/**
 * @param {Array} bodyBlocks
 * @param {string} title
 * @param {Function} [onStatus]
 * @param {Array<{title:string,targetId:string}>} [tocEntries]
 * @param {Array} [frontBlocks] title/author/publisher matter before CONTENTS
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ bytes: Uint8Array, filename: string }>}
 */
export async function buildBookletPdf(
  bodyBlocks,
  title,
  onStatus,
  tocEntries = [],
  frontBlocks = [],
  signal
) {
  onStatus?.(4, "Creating PDF…");
  throwIfAborted(signal);

  const pdfLib = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const fontkitMod = await import("https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm");
  const { PDFDocument, degrees, rgb } = pdfLib;
  const fontkit = fontkitMod.default || fontkitMod;

  const [regularBytes, boldBytes] = await Promise.all([
    fetch(new URL("../fonts/WorkSans-Regular.ttf", import.meta.url), { signal }).then((r) =>
      r.arrayBuffer()
    ),
    fetch(new URL("../fonts/WorkSans-Bold.ttf", import.meta.url), { signal }).then((r) =>
      r.arrayBuffer()
    ),
  ]);

  // Pass 1: layout body alone (starts on its own page later) and map anchors.
  const body = await layoutMiniPages(
    PDFDocument,
    fontkit,
    regularBytes,
    boldBytes,
    bodyBlocks,
    signal
  );
  throwIfAborted(signal);
  const resolved = resolveTocEntries(tocEntries, body.idToPage, body.headingPages);

  // Pass 2: title/front matter + CONTENTS in one flow; page nums include that preamble.
  let preamblePages = 0;
  let preambleDoc = null;
  const hasPreamble = frontBlocks.length > 0 || resolved.length > 0;

  if (hasPreamble) {
    for (let pass = 0; pass < 4; pass++) {
      throwIfAborted(signal);
      const tocBlocks = resolved.length
        ? buildTocBlocks(
            body.font,
            resolved.map((e) => ({
              title: e.title,
              page: e.bodyPage + preamblePages,
            })),
            body.maxWidth
          )
        : [];
      const preamble = await layoutMiniPages(
        PDFDocument,
        fontkit,
        regularBytes,
        boldBytes,
        [...frontBlocks, ...tocBlocks],
        signal
      );
      const next = preamble.content.getPageCount();
      preambleDoc = preamble.content;
      if (next === preamblePages) break;
      preamblePages = next;
    }
  }

  throwIfAborted(signal);
  const parts = [];
  if (preambleDoc) parts.push(preambleDoc);
  parts.push(body.content);

  const content = await mergeDocs(PDFDocument, fontkit, parts);
  const font = await content.embedFont(regularBytes, { subset: true });
  const stampPage = (p) => {
    p.drawText(" ", { x: 1, y: 1, size: 1, font });
  };

  while (content.getPageCount() % 8 !== 0) {
    const blank = content.addPage([MINI_W, MINI_H]);
    stampPage(blank);
  }

  throwIfAborted(signal);

  // Page numbers sit bottom-center inside each mini page.
  const pages = content.getPages();
  for (let i = 0; i < pages.length; i++) {
    if ((i & 63) === 0) throwIfAborted(signal);
    const label = String(i + 1);
    const tw = font.widthOfTextAtSize(label, PAGE_NUM_SIZE);
    pages[i].drawText(label, {
      x: (MINI_W - tw) / 2,
      y: (FOOTER_H - PAGE_NUM_SIZE) / 2 + 1,
      size: PAGE_NUM_SIZE,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
  }

  onStatus?.(5, "Imposing pages into pocket booklet…");
  throwIfAborted(signal);

  const total = content.getPageCount();
  const order = reorderIndices(total);
  const out = await PDFDocument.create();

  const usableW = A4_W - 2 * SHEET_MARGIN;
  const usableH = A4_H - 2 * SHEET_MARGIN;
  const cellW = usableW / 2;
  const cellH = usableH / 4;
  const nsheets = Math.ceil(order.length / 8);

  for (let sheet = 0; sheet < nsheets; sheet++) {
    throwIfAborted(signal);
    const sheetPage = out.addPage([A4_W, A4_H]);
    const slice = order.slice(sheet * 8, sheet * 8 + 8);
    const copied = await out.copyPages(content, slice);
    const embeds = await out.embedPages(copied);

    for (let j = 0; j < embeds.length; j++) {
      const col = j % 2;
      const row = Math.floor(j / 2);
      const x = SHEET_MARGIN + col * cellW;
      const y = A4_H - SHEET_MARGIN - cellH - row * cellH;
      const rotation = col === 0 ? 270 : 90;

      drawRotatedPage(
        sheetPage,
        embeds[j],
        { x, y, w: cellW, h: cellH },
        rotation,
        degrees
      );

      sheetPage.drawRectangle({
        x,
        y,
        width: cellW,
        height: cellH,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.4,
      });
    }
  }

  onStatus?.(6, "Saving PDF…");
  throwIfAborted(signal);
  const bytes = await out.save();
  return {
    bytes,
    filename: `${title || "pocketbook"}-booklet.pdf`,
  };
}
