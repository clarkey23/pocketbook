#!/usr/bin/env venv/bin/python

import sys
import os
from pathlib import Path
import tempfile
import urllib.request
import zipfile
from weasyprint import HTML, CSS
from PyPDF2 import PdfReader, PdfWriter
import fitz  # PyMuPDF
import shutil
import math
from bs4 import BeautifulSoup, Tag
import re
from ebooklib import epub, ITEM_DOCUMENT


def guess_title(html_file):
  if not os.path.isfile(html_file):
    print(f"Error: {html_file} not found.")
    sys.exit(1)
  title = os.path.splitext(os.path.basename(html_file))[0]
  safe_title = re.sub(r'[^0-9a-zA-Z]+', '_', title)
  return safe_title


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


def is_epub(path):
  if not zipfile.is_zipfile(path):
    return False
  with zipfile.ZipFile(path) as z:
    if "mimetype" not in z.namelist():
      return False
    return z.read("mimetype") == b"application/epub+zip"


def epub_to_single_html(epub_path, output_html):
  book = epub.read_epub(epub_path)
  combined_body = []
  for item in book.get_items_of_type(ITEM_DOCUMENT):
    soup = BeautifulSoup(item.get_content(), "html.parser")
    # remove images
    for img in soup.find_all("img"):
      img.decompose()
    # remove empty paragraphs
    for p in soup.find_all("p"):
      if not p.get_text(strip=True):
        p.decompose()
    # change all headings to h2
    for level in range(1, 7):
      for h in soup.find_all(f"h{level}"):
        h.name = "h2"
    # merge consecutive h2s
    for hh in soup.find_all("h2"):
      nxt = hh.find_next_sibling()
      while isinstance(nxt, Tag) and nxt.name == "h2":
        hh.append(" ")
        for child in list(nxt.contents):
          hh.append(child)
        to_remove = nxt
        nxt = nxt.find_next_sibling()
        to_remove.decompose()
    body = soup.body
    if body:
      combined_body.append(body.decode_contents())
    else:
      combined_body.append(str(soup))
  html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Combined EPUB</title></head><body>{''.join(combined_body)}</body></html>"""
  with open(output_html, "w", encoding="utf-8") as f:
    f.write(html)


def epub_path_to_tmp_html(epub_path):
  epub_path = Path(epub_path)
  return Path("/tmp") / (epub_path.stem + ".html")


def main():
  if len(sys.argv) != 2:
    print("Usage: python pocketbook-epub.py <epub-file>")
    sys.exit(1)
  arg = sys.argv[1]
  if not is_epub(arg):
    print("Error: Argument must be an epub file.")
    sys.exit(1)
  html_file = epub_path_to_tmp_html(arg)
  epub_to_single_html(arg, html_file)
  pdf_filename = convert_html_to_pdf(html_file, 'css/pocketbook-epub.css')
  title = guess_title(html_file)
  booklet_filename = title + '-booklet.pdf'
  process_booklet_pdf(pdf_filename, booklet_filename, title)

if __name__ == "__main__":
    main()


