#!/usr/bin/env venv/bin/python

import sys
import os

# WeasyPrint needs Homebrew Pango/GLib on macOS; make libs discoverable before import.
_homebrew_lib = "/opt/homebrew/lib"
if sys.platform == "darwin" and os.path.isdir(_homebrew_lib):
    _fallback = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
    if _homebrew_lib not in _fallback.split(":"):
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
            f"{_homebrew_lib}:{_fallback}" if _fallback else _homebrew_lib
        )

import tempfile
import urllib.request
import zipfile
import subprocess
import time
from weasyprint import HTML, CSS
from PyPDF2 import PdfReader, PdfWriter
import fitz  # PyMuPDF
import shutil
import math
from bs4 import BeautifulSoup
import re
from urllib.parse import urlparse
from typing import Optional


class PocketbookError(Exception):
    """Raised when booklet conversion fails."""


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSS = os.path.join(ROOT_DIR, "css", "pocketbook.css")
STATUS_PATH = os.path.join(
    os.path.expanduser("~"),
    "Library",
    "Application Support",
    "PocketBook",
    "status.txt",
)

# stage_num, total_stages, message
_TOTAL_STAGES = 6


def write_status(stage: int, message: str) -> None:
    """Publish progress for the Mac app progress window + stdout."""
    line = f"{stage}/{_TOTAL_STAGES}|{message}"
    print(message, flush=True)
    try:
        os.makedirs(os.path.dirname(STATUS_PATH), exist_ok=True)
        with open(STATUS_PATH, "w", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    if sys.platform == "darwin":
        # Lightweight notification so Dock-app users see movement.
        safe = message.replace('"', '\\"')
        subprocess.Popen(
            [
                "osascript",
                "-e",
                f'display notification "{safe}" with title "PocketBook" subtitle "Step {stage} of {_TOTAL_STAGES}"',
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def clear_status() -> None:
    try:
        if os.path.exists(STATUS_PATH):
            os.remove(STATUS_PATH)
    except OSError:
        pass


def is_url(path):
    return path.startswith(("http://", "https://"))


def normalize_gutenberg_source(source: str) -> str:
    """Accept a HTML-zip URL, local zip, or Gutenberg ebook page URL."""
    source = source.strip()
    if not is_url(source):
        return source

    parsed = urlparse(source)
    host = (parsed.netloc or "").lower()
    path = parsed.path or ""

    if not host.endswith("gutenberg.org"):
        return source

    # Already a zip download
    if path.lower().endswith(".zip"):
        return source

    # https://www.gutenberg.org/ebooks/36
    m = re.search(r"/ebooks/(\d+)/?$", path)
    if m:
        book_id = m.group(1)
        return f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}-h.zip"

    # https://www.gutenberg.org/files/36/36-h.zip already covered by .zip
    # https://www.gutenberg.org/cache/epub/36/pg36-images.html → zip sibling
    m = re.search(r"/cache/epub/(\d+)/", path)
    if m:
        book_id = m.group(1)
        return f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}-h.zip"

    return source


def download_zip(url, dest_dir):
    try:
        basename = os.path.basename(urlparse(url).path) or "book.zip"
        if not basename.lower().endswith(".zip"):
            basename = "book.zip"
        local_path = os.path.join(dest_dir, basename)
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "PocketBook/1.0 (+local converter)"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp, open(local_path, "wb") as out:
            shutil.copyfileobj(resp, out)
        return local_path
    except Exception as e:
        raise PocketbookError(f"Download failed: {e}") from e


def unzip_file(zip_path, dest_dir):
    try:
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(dest_dir)
        print(f"Extracted to: {dest_dir}")
    except Exception as e:
        raise PocketbookError(f"Unzip failed: {e}") from e


def guess_title(html_file):
    if not os.path.isfile(html_file):
        raise PocketbookError(f"{html_file} not found.")
    with open(html_file, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f, "html.parser")
    title = None
    try:
        meta_tag = soup.find("meta", attrs={"name": "dc.title"})
        if meta_tag and "content" in meta_tag.attrs:
            title = meta_tag["content"]
    except Exception:
        title = None
    html_name = os.path.splitext(os.path.basename(html_file))[0]
    if not title:
        title = html_name
    # Keep filenames short so Downloads / Finder stay sane.
    safe_title = re.sub(r"[^0-9a-zA-Z]+", "_", title).strip("_")
    if len(safe_title) > 40:
        safe_title = safe_title[:40].rstrip("_")
    return safe_title or "pocketbook"


def find_html_file(dir):
    html_files = [f for f in os.listdir(dir) if f.lower().endswith(".html")]
    if not html_files:
        # Sometimes nested in a subfolder
        for root, _, files in os.walk(dir):
            for f in files:
                if f.lower().endswith(".html"):
                    return os.path.join(root, f)
        raise PocketbookError(f"No HTML file found in {dir}.")
    return os.path.join(dir, html_files[0])


def prepare_html_for_fast_print(html_file):
    """Strip images and Gutenberg chrome so WeasyPrint stays fast and small."""
    with open(html_file, "r", encoding="utf-8", errors="ignore") as f:
        soup = BeautifulSoup(f, "html.parser")

    for selector in ("#pg-header", "#pg-footer", "script", "style", "link", "noscript"):
        for tag in soup.select(selector):
            tag.decompose()

    for tag in soup.find_all(["img", "svg", "picture", "source", "object", "embed", "video", "audio", "iframe"]):
        tag.decompose()

    # Drop empty figures left behind after image removal.
    for tag in soup.find_all("figure"):
        if not tag.get_text(strip=True):
            tag.decompose()

    cleaned = os.path.splitext(html_file)[0] + ".pocket.html"
    with open(cleaned, "w", encoding="utf-8") as f:
        f.write(str(soup))
    return cleaned


def convert_html_to_pdf(html_file, css_file=DEFAULT_CSS):
    if not os.path.isfile(html_file):
        raise PocketbookError(f"{html_file} not found.")
    if not os.path.isfile(css_file):
        raise PocketbookError(f"{css_file} not found.")
    write_status(3, "Preparing text (skipping images)…")
    fast_html = prepare_html_for_fast_print(html_file)
    output_pdf = os.path.splitext(html_file)[0] + ".pdf"
    # Size hint: long books spend most time here.
    try:
        kb = max(1, os.path.getsize(fast_html) // 1024)
        write_status(4, f"Creating PDF from {kb} KB of text… (slow step)")
    except OSError:
        write_status(4, "Creating PDF… (slow step)")
    HTML(fast_html).write_pdf(output_pdf, stylesheets=[CSS(css_file)])
    write_status(4, "PDF text layout done")
    return output_pdf


def pad_pdf_to_multiple_of_8(input_pdf, output_pdf):
    reader = PdfReader(input_pdf)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    total_pages = len(reader.pages)
    remainder = total_pages % 8
    if remainder != 0:
        blank_pages_needed = 8 - remainder
        width = reader.pages[0].mediabox.width
        height = reader.pages[0].mediabox.height
        for _ in range(blank_pages_needed):
            writer.add_blank_page(width=width, height=height)
    with open(output_pdf, "wb") as f:
        writer.write(f)


def reorder_pages_for_booklet(input_pdf, output_pdf):
    doc = fitz.open(input_pdf)
    total_pages = len(doc)
    out = fitz.open()
    for i in range(0, total_pages, 8):
        indices = [
            i + 1, i, i + 2, i + 7,
            i + 3, i + 6, i + 4, i + 5,
        ]
        for idx in indices:
            if idx < total_pages:
                out.insert_pdf(doc, from_page=idx, to_page=idx)
    out.save(output_pdf)
    doc.close()
    out.close()


def nup_2x4(input_pdf, output_pdf, title=""):
    src = fitz.open(input_pdf)
    out = fitz.open()
    pw, ph = fitz.paper_size("a4")
    cols, rows = 2, 4
    cell_w, cell_h = pw / cols, ph / rows
    npages = len(src)
    nsheets = math.ceil(npages / 8) if npages else 0
    trunc_width = 30
    trunc_title = f"{title[:trunc_width-3] + '...' if len(title) > trunc_width else title:<{trunc_width}}"
    for i in range(0, len(src), 8):
        page = out.new_page(width=pw, height=ph)
        for j in range(8):
            idx = i + j
            if idx >= len(src):
                break
            x = (j % 2) * cell_w
            y = (j // 2) * cell_h
            rect = fitz.Rect(x, y, x + cell_w, y + cell_h)
            rotation = [270, 90][j % 2]
            page.show_pdf_page(
                rect, src, idx,
                rotate=rotation,
                keep_proportion=True,
                clip=None,
            )
            page.draw_rect(rect, color=(0, 0, 0), width=0.5)
            if j == 0:
                page.insert_text(
                    (pw - 3, 20), f"{int(i / 8) + 1}/{nsheets}",
                    rotate=90, fontsize=5,
                    color=(0.4, 0.4, 0.4), fontname="helv",
                )
                page.insert_text(
                    (pw - 3, cell_h - 3), f"{trunc_title}",
                    rotate=90, fontsize=5,
                    color=(0.4, 0.4, 0.4), fontname="helv",
                )
    # Save to a temp file first so Downloads overwrite permission issues don't crash MuPDF.
    fd, tmp_out = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    try:
        out.save(tmp_out, garbage=3, deflate=True)
    finally:
        out.close()
        src.close()
    try:
        shutil.copyfile(tmp_out, output_pdf)
    finally:
        if os.path.exists(tmp_out):
            os.remove(tmp_out)


def unique_booklet_path(output_dir: str, title: str) -> str:
    base = os.path.join(output_dir, f"{title}-booklet.pdf")
    if not os.path.exists(base):
        return base
    n = 2
    while True:
        candidate = os.path.join(output_dir, f"{title}-booklet-{n}.pdf")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def process_booklet_pdf(input_pdf, output_pdf, title=""):
    write_status(5, "Imposing pages into pocket booklet…")
    tmp1 = tempfile.mktemp(suffix=".pdf")
    tmp2 = tempfile.mktemp(suffix=".pdf")
    try:
        pad_pdf_to_multiple_of_8(input_pdf, tmp1)
        reorder_pages_for_booklet(tmp1, tmp2)
        nup_2x4(tmp2, output_pdf, title)
    finally:
        for path in (tmp1, tmp2):
            if os.path.exists(path):
                os.remove(path)
    write_status(6, f"Saved booklet")


def make_booklet(source: str, output_dir: Optional[str] = None, css_file: str = DEFAULT_CSS) -> str:
    """
    Convert a Gutenberg HTML zip (URL or local path) into a pocket booklet PDF.

    Returns the absolute path to the generated booklet PDF.
    """
    started = time.time()
    source = normalize_gutenberg_source(source)
    output_dir = output_dir or os.path.join(os.path.expanduser("~"), "Downloads")
    os.makedirs(output_dir, exist_ok=True)

    temp_dir = tempfile.mkdtemp()
    unzip_dir = tempfile.mkdtemp()
    try:
        if is_url(source):
            write_status(1, "Downloading from Project Gutenberg…")
            zip_path = download_zip(source, temp_dir)
        elif os.path.isfile(source) and source.lower().endswith(".zip"):
            write_status(1, "Using local zip file…")
            zip_path = source
        else:
            raise PocketbookError(
                "Provide a Gutenberg HTML zip URL, ebook page URL, or local .zip file."
            )

        write_status(2, "Extracting book…")
        unzip_file(zip_path, unzip_dir)
        html_file = find_html_file(unzip_dir)
        pdf_filename = convert_html_to_pdf(html_file, css_file)
        title = guess_title(html_file)
        booklet_filename = unique_booklet_path(output_dir, title)
        process_booklet_pdf(pdf_filename, booklet_filename, title)
        elapsed = int(time.time() - started)
        write_status(6, f"Done in {elapsed}s → Downloads")
        return os.path.abspath(booklet_filename)
    except Exception:
        write_status(0, "Failed")
        raise
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        shutil.rmtree(unzip_dir, ignore_errors=True)


def open_file(path: str) -> None:
    if sys.platform == "darwin":
        os.system(f'open "{path}"')
    elif sys.platform.startswith("linux"):
        os.system(f'xdg-open "{path}" >/dev/null 2>&1 &')
    elif sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]


def main():
    if len(sys.argv) > 2:
        print("Usage: ./pocketbook.py [gutenberg_url_or_zip]")
        sys.exit(1)

    if len(sys.argv) == 2:
        source = sys.argv[1].strip()
    else:
        try:
            source = input("Paste Gutenberg link: ").strip()
        except EOFError:
            source = ""
        if not source:
            print("No link provided.")
            sys.exit(1)

    try:
        path = make_booklet(source)
        print(f"Booklet ready: {path}")
        open_file(path)
    except PocketbookError as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
