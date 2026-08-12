#!/usr/bin/env venv/bin/python

"""Local web UI: paste a Gutenberg link, download a pocket booklet PDF."""

import os
import sys
import tempfile

# WeasyPrint needs Homebrew Pango/GLib on macOS; make libs discoverable before import.
_homebrew_lib = "/opt/homebrew/lib"
if sys.platform == "darwin" and os.path.isdir(_homebrew_lib):
    _fallback = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
    if _homebrew_lib not in _fallback.split(":"):
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
            f"{_homebrew_lib}:{_fallback}" if _fallback else _homebrew_lib
        )

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.background import BackgroundTask

from pocketbook import PocketbookError, make_booklet

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")

app = FastAPI(title="PocketBook")
app.mount("/static", StaticFiles(directory=os.path.join(WEB, "static")), name="static")
app.mount("/site", StaticFiles(directory=os.path.join(ROOT, "site")), name="site")
templates = Jinja2Templates(directory=os.path.join(WEB, "templates"))


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/convert")
def convert(url: str = Form(...)):
    url = (url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Paste a Project Gutenberg link.")

    out_dir = tempfile.mkdtemp(prefix="pocketbook-web-")
    try:
        pdf_path = make_booklet(url, output_dir=out_dir)
    except PocketbookError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {e}") from e

    filename = os.path.basename(pdf_path)

    def cleanup():
        try:
            if os.path.exists(pdf_path):
                os.remove(pdf_path)
            os.rmdir(out_dir)
        except OSError:
            pass

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=filename,
        background=BackgroundTask(cleanup),
    )


def main():
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8765, reload=False)


if __name__ == "__main__":
    main()
