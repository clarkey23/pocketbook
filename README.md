# PocketBook

Mac app that turns [Project Gutenberg](https://www.gutenberg.org/) books into pocket-sized, foldable A4 booklets.

Paste a Gutenberg link → get a PDF in Downloads → print single-sided → fold.

<img src="site/pocketbook.jpg" width=50%>

---

## About this fork

This is a **maintained fork** of [sieste/pocketbook](https://github.com/sieste/pocketbook).

The original project is a Python CLI. This fork adds:

- A standalone **Mac app** (no Terminal, no Homebrew for end users)
- In-window progress checklist
- Gutenberg ebook page URLs (not only zip links)
- Faster text-only conversion (images skipped)
- Source Sans 3 as the default font
- Saves to Downloads

Upstream credit: [@sieste](https://github.com/sieste).

---

## Download (Mac)

1. Grab the latest **PocketBook-macOS.zip** from [Releases](https://github.com/clarkey23/pocketbook/releases)
2. Unzip and drag **PocketBook.app** to Applications
3. Open it (right-click → Open the first time if macOS warns about an unidentified developer)
4. Optional: keep it in the Dock

Paste a Gutenberg ebook link (example: `https://www.gutenberg.org/ebooks/36`). The PDF lands in **Downloads**.

Print **single-sided A4 at 100%**, then fold using the zine fold below.

---

## Sample books

Ready-to-print PDFs in [books/](books/):

- [Lewis Carroll: Alice's Adventures in Wonderland](books/Alice_s_Adventures_in_Wonderland-booklet.pdf)
- [HG Wells: The War of the Worlds](books/The_War_of_the_Worlds-booklet.pdf)
- [Marcus Aurelius: Meditations](books/Meditations-booklet.pdf)
- [Fyodor Dostoyevsky: Notes from the Underground](books/Notes_from_the_Underground-booklet.pdf)

---

## Develop / build from source

```bash
git clone https://github.com/clarkey23/pocketbook.git
cd pocketbook
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
brew install pango   # build machine only
```

### Run the GUI from source

```bash
source venv/bin/activate
python mac/gui.py
```

### Run the CLI

```bash
./pocketbook.py https://www.gutenberg.org/ebooks/36
```

### Build the standalone Mac app

On an Apple Silicon Mac with Homebrew + pango installed:

```bash
./build-standalone-app.sh
open dist/PocketBook.app
```

That produces `dist/PocketBook.app` and `dist/PocketBook-macOS.zip` for GitHub Releases.

---

## Print & fold

Print on regular A4 (single-sided, margins as small as possible). Cut & fold each sheet with the zine fold:

<img src="site/booklet-fold.png" width=50%>

(Two-sided printing is possible but you re-fold after every 8 pages.)

### Sleeve

Recycled cardboard + string works well as a sleeve:

<img src="site/sleeve.png" width=70%>

---

## License

- [MIT License](LICENSE)
- Based on [sieste/pocketbook](https://github.com/sieste/pocketbook) (MIT)
- [Source Sans 3](fonts/README.md) (SIL OFL 1.1)
- [Gutenberg Project permissions](https://www.gutenberg.org/policy/permission.html)
