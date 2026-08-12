(() => {
  const form = document.getElementById("convert-form");
  const input = document.getElementById("url");
  const button = document.getElementById("submit");
  const error = document.getElementById("error");
  const label = button.querySelector(".btn-label");
  const busy = button.querySelector(".btn-busy");

  function setBusy(on) {
    button.disabled = on;
    label.hidden = on;
    busy.hidden = !on;
  }

  function showError(message) {
    error.hidden = !message;
    error.textContent = message || "";
  }

  function filenameFromDisposition(header, fallback) {
    if (!header) return fallback;
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header);
    if (!match) return fallback;
    try {
      return decodeURIComponent(match[1].replace(/"/g, "").trim());
    } catch {
      return match[1].replace(/"/g, "").trim() || fallback;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");

    const url = input.value.trim();
    if (!url) {
      showError("Paste a Project Gutenberg link.");
      input.focus();
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.set("url", url);
      const response = await fetch("/convert", { method: "POST", body });

      if (!response.ok) {
        let detail = "Conversion failed.";
        try {
          const data = await response.json();
          detail = data.detail || detail;
        } catch {
          /* ignore */
        }
        throw new Error(typeof detail === "string" ? detail : "Conversion failed.");
      }

      const blob = await response.blob();
      const filename = filenameFromDisposition(
        response.headers.get("content-disposition"),
        "pocketbook-booklet.pdf"
      );
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      showError(err.message || "Conversion failed.");
    } finally {
      setBusy(false);
    }
  });
})();
