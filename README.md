# PocketBook

Paste a [Project Gutenberg](https://www.gutenberg.org/) URL → get a pocket-sized, foldable A4 booklet PDF.

<img src="site/pocketbook.jpg" width=50%>

---

## About this fork

Maintained fork of [sieste/pocketbook](https://github.com/sieste/pocketbook).

This fork adds:

- **Web app** (runs in the browser on the user’s device)
- Standalone **Mac app**
- Gutenberg ebook page URLs
- Text-only conversion (images skipped), TOC page-numbers stripped
- 5mm print margins, Work Sans / Source Sans options

Upstream credit: [@sieste](https://github.com/sieste).

---

## Web app (paste URL in the browser)

The PDF is built **on the user’s device**. A tiny proxy only fetches the Gutenberg zip (browsers can’t download it directly because of CORS).

### Run locally

```bash
# terminal 1 — Gutenberg proxy
node workers/gutenberg-proxy/local-proxy.mjs

# terminal 2 — static site
cd web && python3 -m http.server 8080
```

Open http://127.0.0.1:8080

Or one process (same as production):

```bash
node server.mjs
# → http://127.0.0.1:3000
```

### Deploy with Coolify (GitHub)

One Docker service: static site + `/proxy` for Gutenberg.

1. Push `main` to GitHub (already on `clarkey23/pocketbook`).
2. In Coolify → **New Resource** → **Public/Private Repository**.
3. Pick this repo, branch `main`.
4. Build pack: **Dockerfile** (repo root `Dockerfile`).
5. Port: **3000**.
6. Add your domain / Let’s Encrypt as usual.
7. Deploy.

Health check path (optional): `/health`

After deploy, open the domain — no Cloudflare Worker needed. The app calls `/proxy` on the same origin.

**Local override** (only if you ever need a different proxy):

```js
localStorage.setItem("pocketbook_proxy", "https://YOUR-PROXY")
```

### Deploy (Cloudflare Worker + static host)

Alternative if you prefer Pages + Workers instead of Coolify:

```bash
cd workers/gutenberg-proxy
npx wrangler login
npx wrangler deploy
```

Host `web/` on Pages/Netlify/etc., then either use same-origin only via Coolify/`server.mjs`, or set `localStorage.pocketbook_proxy` to the `*.workers.dev` URL.

---

## Mac app

1. Grab **PocketBook-macOS.zip** from [Releases](https://github.com/clarkey23/pocketbook/releases)
2. Unzip → drag **PocketBook.app** to Applications
3. First open: right-click → Open if Gatekeeper warns

---

## Sample books

Ready-to-print PDFs in [books/](books/):

- [Alice's Adventures in Wonderland](books/Alice_s_Adventures_in_Wonderland-booklet.pdf)
- [The War of the Worlds](books/The_War_of_the_Worlds-booklet.pdf)
- [Meditations](books/Meditations-booklet.pdf)
- [Notes from the Underground](books/Notes_from_the_Underground-booklet.pdf)

---

## CLI / Mac from source

```bash
git clone https://github.com/clarkey23/pocketbook.git
cd pocketbook
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
brew install pango   # macOS build machine only

./pocketbook.py https://www.gutenberg.org/ebooks/36
# or
python mac/gui.py
# or
./build-standalone-app.sh
```

---

## Print & fold

Print A4, **single-sided**, **100% / actual size**.

Then cut & fold with the zine fold:

<img src="site/booklet-fold.png" width=50%>

### Sleeve

<img src="site/sleeve.png" width=70%>

---

## License

- [MIT License](LICENSE)
- Based on [sieste/pocketbook](https://github.com/sieste/pocketbook) (MIT)
- [Source Sans 3](fonts/README.md) / Work Sans (SIL OFL 1.1)
- [Gutenberg Project permissions](https://www.gutenberg.org/policy/permission.html)
