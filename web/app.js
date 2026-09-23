import { normalizeGutenbergSource, fetchBookZip } from "./lib/gutenberg.js";
import { extractHtmlFromZip } from "./lib/clean.js";
import { buildBookletPdf } from "./lib/booklet.js";

const form = document.getElementById("form");
const input = document.getElementById("url");
const button = document.getElementById("submit");
const cancelBtn = document.getElementById("cancel");
const errorEl = document.getElementById("error");
const detailEl = document.getElementById("detail");
const estimateEl = document.getElementById("estimate");
const steps = [...document.querySelectorAll("#steps li")];

let activeAbort = null;

function setBusy(on) {
  button.disabled = on;
  button.textContent = on ? "Working…" : "Make booklet";
  cancelBtn.hidden = !on;
  input.disabled = on;
}

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function resetSteps() {
  steps.forEach((li) => {
    li.querySelector(".mark").textContent = "○";
  });
  detailEl.textContent = "Starting…";
  estimateEl.hidden = true;
  estimateEl.textContent = "";
}

function setProgress(stage, message) {
  steps.forEach((li) => {
    const n = Number(li.dataset.step);
    const mark = li.querySelector(".mark");
    if (n < stage || stage >= 6) mark.textContent = "✓";
    else if (n === stage) mark.textContent = "●";
    else mark.textContent = "○";
  });
  if (stage >= 6) {
    steps.forEach((li) => {
      li.querySelector(".mark").textContent = "✓";
    });
  }
  detailEl.textContent = message;
}

/** Rough mini-page + time guess from extracted text volume. */
function estimateBook(frontBlocks, bodyBlocks) {
  const all = [...(frontBlocks || []), ...(bodyBlocks || [])];
  const chars = all.reduce((n, b) => n + (b.text?.length || 0), 0);
  const blocks = all.length;
  // ~500 chars / mini page at 6pt with margins; pad to booklet multiple of 8.
  const rawPages = Math.max(8, Math.ceil(chars / 500) + 2);
  const pages = Math.ceil(rawPages / 8) * 8;
  const sheets = pages / 8;
  // Layout is the slow bit — ~25–40 blocks/sec in-browser is typical.
  const seconds = Math.max(8, Math.round(blocks / 35 + pages / 15));
  return { chars, blocks, pages, sheets, seconds };
}

function formatEstimate(est) {
  const mins = Math.floor(est.seconds / 60);
  const secs = est.seconds % 60;
  const time =
    mins > 0 ? `~${mins} min ${secs ? `${secs}s` : ""}`.trim() : `~${est.seconds}s`;
  return `About ${est.pages} mini-pages (~${est.sheets} A4 sheet${est.sheets === 1 ? "" : "s"}). PDF build ${time} on this device.`;
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

cancelBtn.addEventListener("click", () => {
  activeAbort?.abort();
  detailEl.textContent = "Cancelling…";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const raw = input.value.trim();
  if (!raw) {
    showError("Paste a Project Gutenberg link.");
    input.focus();
    return;
  }

  activeAbort?.abort();
  const ac = new AbortController();
  activeAbort = ac;

  setBusy(true);
  resetSteps();

  try {
    const zipUrl = normalizeGutenbergSource(raw);
    const buffer = await fetchBookZip(zipUrl, setProgress, ac.signal);
    const { title, frontBlocks, bodyBlocks, tocEntries } = await extractHtmlFromZip(
      buffer,
      setProgress
    );
    if (ac.signal.aborted) throw Object.assign(new Error("Cancelled."), { name: "AbortError" });
    if (!bodyBlocks.length && !frontBlocks.length) {
      throw new Error("No readable text found in that book.");
    }

    const est = estimateBook(frontBlocks, bodyBlocks);
    estimateEl.hidden = false;
    estimateEl.textContent = formatEstimate(est);
    setProgress(4, `Creating PDF… ${formatEstimate(est)}`);

    const { bytes, filename } = await buildBookletPdf(
      bodyBlocks,
      title,
      setProgress,
      tocEntries,
      frontBlocks,
      ac.signal
    );
    setProgress(6, `Done - downloading ${filename}`);
    downloadBytes(bytes, filename);
  } catch (err) {
    if (err?.name === "AbortError") {
      showError("");
      detailEl.textContent = "Cancelled.";
      estimateEl.hidden = true;
    } else {
      console.error(err);
      showError(err?.message || "Something went wrong.");
      detailEl.textContent = "Failed.";
    }
  } finally {
    if (activeAbort === ac) activeAbort = null;
    setBusy(false);
  }
});
