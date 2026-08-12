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
from weasyprint import HTML, CSS
from PyPDF2 import PdfReader, PdfWriter
import fitz  # PyMuPDF
import shutil
import math
from bs4 import BeautifulSoup
import re

def is_url(path):
    return path.startswith(('http://', 'https://'))

def download_zip(url, dest_dir):
    try:
        local_path = os.path.join(dest_dir, os.path.basename(url))
        urllib.request.urlretrieve(url, local_path)
        return local_path
    except Exception as e:
        print(f"Download failed: {e}")
        sys.exit(1)

def unzip_file(zip_path, dest_dir):
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(dest_dir)
        print(f"Extracted to: {dest_dir}")
    except Exception as e:
        print(f"Unzip failed: {e}")
        sys.exit(1)


def guess_title(html_file):
    if not os.path.isfile(html_file):
        print(f"Error: {html_file} not found.")
        sys.exit(1)
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
    safe_title = re.sub(r'[^0-9a-zA-Z]+', '_', title)
    return safe_title


def find_html_file(dir):
    html_files = [f for f in os.listdir(dir) if f.lower().endswith('.html')]
    if not html_files:
        print(f"Error: No HTML file found in {dir}.")
        sys.exit(1)
    html_path = os.path.join(dir, html_files[0])
    return html_path


def convert_html_to_pdf(html_file, css_file = 'css/pocketbook.css'):
    if not os.path.isfile(html_file):
        print(f"Error: {html_file} not found.")
        sys.exit(1)
    if not os.path.isfile(css_file):
        print(f"Error: {css_path} not found.")
        sys.exit(1)
    output_pdf = os.path.splitext(html_file)[0] + ".pdf"
    print(f"Creating pdf {output_pdf}")
    HTML(html_file).write_pdf(output_pdf, stylesheets=[CSS(css_file)])
    print("Done.")
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
            i + 3, i + 6, i + 4, i + 5
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
    marksize = 5
    npages = len(src)
    nsheets = math.ceil(npages // 8)
    trunc_width = 30
    trunc_title = f"{title[:trunc_width-3] + '...' if len(title) > trunc_width else title:<{trunc_width}}"
    for i in range(0, len(src), 8):
      page = out.new_page(width=pw, height=ph)
      for j in range(8):
        idx = i + j
        if idx >= len(src):
            break
        src_page = src[idx]
        x = (j % 2) * cell_w
        y = (j // 2) * cell_h
        rect = fitz.Rect(x, y, x + cell_w, y + cell_h)
        rotation = [270, 90][j % 2]
        page.show_pdf_page(
          rect, src, idx,
          rotate=rotation,
          keep_proportion=True,
          clip=None
        )
        page.draw_rect(rect, color=(0, 0, 0), width=0.5)
        if j == 0:
          page.insert_text((pw-3, 20), f"{int(i/8) + 1}/{nsheets}", 
                           rotate=90, fontsize=5, 
                           color=(.4,.4,.4), fontname='helv')
          page.insert_text((pw-3, cell_h-3), f"{trunc_title}", 
                           rotate=90, fontsize=5, 
                           color=(.4,.4,.4), fontname='helv')
    out.save(output_pdf)
    out.close()
    src.close()

def process_booklet_pdf(input_pdf, output_pdf, title=""):
    print("Creating booklet ...")
    tmp1 = tempfile.mktemp(suffix=".pdf")
    tmp2 = tempfile.mktemp(suffix=".pdf")
    pad_pdf_to_multiple_of_8(input_pdf, tmp1)
    reorder_pages_for_booklet(tmp1, tmp2)
    nup_2x4(tmp2, output_pdf, title)
    os.remove(tmp1)
    os.remove(tmp2)
    print(f"Booklet PDF created: {output_pdf}")


def main():
    if len(sys.argv) != 2:
        print("Usage: ./pocketbook.py <zip_path_or_url>")
        sys.exit(1)
    arg = sys.argv[1]
    temp_dir = tempfile.mkdtemp()
    if is_url(arg):
        zip_path = download_zip(arg, temp_dir)
    elif os.path.isfile(arg) and arg.lower().endswith('.zip'):
        zip_path = arg
    else:
        print("Error: Argument must be a local .zip file or a URL to a .zip file.")
        sys.exit(1)
    unzip_dir = tempfile.mkdtemp()
    unzip_file(zip_path, unzip_dir)
    html_file = find_html_file(unzip_dir)
    pdf_filename = convert_html_to_pdf(html_file, 'css/pocketbook.css')
    title = guess_title(html_file)
    booklet_filename = title + '-booklet.pdf'
    process_booklet_pdf(pdf_filename, booklet_filename, title)
    shutil.rmtree(temp_dir)
    shutil.rmtree(unzip_dir)


if __name__ == "__main__":
    main()


