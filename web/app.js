import { normalizeGutenbergSource, fetchBookZip } from "./lib/gutenberg.js";
import { extractHtmlFromZip } from "./lib/clean.js";
import { buildBookletPdf } from "./lib/booklet.js";

const form = document.getElementById("form");
const input = document.getElementById("url");
const button = document.getElementById("submit");
const errorEl = document.getElementById("error");
const detailEl = document.getElementById("detail");
const steps = [...document.querySelectorAll("#steps li")];

function setBusy(on) {
  button.disabled = on;
  button.textContent = on ? "Working…" : "Make booklet";
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const raw = input.value.trim();
  if (!raw) {
    showError("Paste a Project Gutenberg link.");
    input.focus();
    return;
  }

  setBusy(true);
  resetSteps();

  try {
    const zipUrl = normalizeGutenbergSource(raw);
    const buffer = await fetchBookZip(zipUrl, setProgress);
    const { title, blocks, tocEntries } = await extractHtmlFromZip(buffer, setProgress);
    if (!blocks.length) throw new Error("No readable text found in that book.");
    const { bytes, filename } = await buildBookletPdf(blocks, title, setProgress, tocEntries);
    setProgress(6, `Done - downloading ${filename}`);
    downloadBytes(bytes, filename);
  } catch (err) {
    console.error(err);
    showError(err?.message || "Something went wrong.");
    detailEl.textContent = "Failed.";
  } finally {
    setBusy(false);
  }
});
