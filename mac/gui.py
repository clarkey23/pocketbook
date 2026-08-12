#!/usr/bin/env python3
"""PocketBook Mac GUI — paste a Gutenberg link, watch in-window progress, get a PDF."""

import os
import sys
import threading
import tkinter as tk
from tkinter import ttk, messagebox

# Ensure app-local modules resolve when launched from the .app bundle.
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)
# Repo layout: mac/gui.py → parent is project root
REPO_ROOT = os.path.dirname(APP_ROOT)
if os.path.isdir(os.path.join(REPO_ROOT, "css")) and REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from pocketbook import (  # noqa: E402
    STAGES,
    PocketbookError,
    make_booklet,
    open_file,
    set_progress_callback,
)


INK = "#15261c"
PAPER = "#e6e4df"
MOSS = "#3d6b4f"
MUTED = "#5c6f63"
ERROR = "#a84832"


class PocketBookApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PocketBook")
        self.configure(bg=PAPER)
        self.resizable(False, False)
        self.busy = False

        # Keep window responsive / above beach-ball feel
        self.update_idletasks()

        pad = {"padx": 22, "pady": 0}
        outer = tk.Frame(self, bg=PAPER)
        outer.pack(fill="both", expand=True, padx=0, pady=0)

        tk.Label(
            outer,
            text="PocketBook",
            font=("Helvetica Neue", 28, "bold"),
            fg=INK,
            bg=PAPER,
            anchor="w",
        ).pack(fill="x", padx=22, pady=(20, 4))

        tk.Label(
            outer,
            text="Paste a Project Gutenberg link. Get a foldable pocket PDF.",
            font=("Helvetica Neue", 13),
            fg=MUTED,
            bg=PAPER,
            anchor="w",
            wraplength=420,
            justify="left",
        ).pack(fill="x", padx=22, pady=(0, 16))

        tk.Label(
            outer,
            text="Gutenberg link",
            font=("Helvetica Neue", 12, "bold"),
            fg=INK,
            bg=PAPER,
            anchor="w",
        ).pack(fill="x", **pad)

        self.url_var = tk.StringVar()
        self.url_entry = tk.Entry(
            outer,
            textvariable=self.url_var,
            font=("Helvetica Neue", 14),
            bg="white",
            fg=INK,
            relief="solid",
            bd=1,
            highlightthickness=1,
            highlightbackground="#c9c5bc",
            highlightcolor=MOSS,
        )
        self.url_entry.pack(fill="x", padx=22, pady=(6, 4), ipady=8)
        self.url_entry.focus_set()

        tk.Label(
            outer,
            text="Ebook page or HTML zip URL works.",
            font=("Helvetica Neue", 11),
            fg=MUTED,
            bg=PAPER,
            anchor="w",
        ).pack(fill="x", padx=22, pady=(0, 14))

        self.button = tk.Button(
            outer,
            text="Make booklet",
            font=("Helvetica Neue", 14, "bold"),
            fg="#f4f7f4",
            bg=MOSS,
            activebackground="#2f5440",
            activeforeground="#f4f7f4",
            relief="flat",
            padx=16,
            pady=10,
            cursor="hand2",
            command=self.on_make,
        )
        self.button.pack(anchor="w", padx=22, pady=(0, 18))

        # Checklist
        check_frame = tk.Frame(outer, bg=PAPER)
        check_frame.pack(fill="x", padx=22, pady=(0, 8))
        tk.Label(
            check_frame,
            text="Progress",
            font=("Helvetica Neue", 12, "bold"),
            fg=INK,
            bg=PAPER,
            anchor="w",
        ).pack(fill="x", pady=(0, 8))

        self.stage_vars = {}
        self.stage_labels = {}
        for num, label in STAGES:
            row = tk.Frame(check_frame, bg=PAPER)
            row.pack(fill="x", pady=3)
            mark = tk.Label(
                row,
                text="○",
                font=("Helvetica Neue", 14),
                fg=MUTED,
                bg=PAPER,
                width=2,
                anchor="w",
            )
            mark.pack(side="left")
            text = tk.Label(
                row,
                text=label,
                font=("Helvetica Neue", 13),
                fg=MUTED,
                bg=PAPER,
                anchor="w",
            )
            text.pack(side="left", fill="x", expand=True)
            self.stage_vars[num] = mark
            self.stage_labels[num] = text

        self.detail_var = tk.StringVar(value="Waiting for a link…")
        self.detail = tk.Label(
            outer,
            textvariable=self.detail_var,
            font=("Helvetica Neue", 12),
            fg=MUTED,
            bg=PAPER,
            anchor="w",
            wraplength=420,
            justify="left",
        )
        self.detail.pack(fill="x", padx=22, pady=(12, 22))

        self.bind("<Return>", lambda _e: self.on_make())
        self.protocol("WM_DELETE_WINDOW", self.on_close)

        # Size for a compact tool window
        self.geometry("460x520")
        self.minsize(420, 480)

    def reset_checklist(self):
        for num, _ in STAGES:
            self.stage_vars[num].configure(text="○", fg=MUTED)
            self.stage_labels[num].configure(fg=MUTED)

    def set_stage(self, stage: int, message: str):
        # Completed stages
        for num, _ in STAGES:
            if 0 < num < stage:
                self.stage_vars[num].configure(text="✓", fg=MOSS)
                self.stage_labels[num].configure(fg=INK)
            elif num == stage and stage > 0:
                self.stage_vars[num].configure(text="●", fg=MOSS)
                self.stage_labels[num].configure(fg=INK)
            elif stage == 0:
                pass
            else:
                self.stage_vars[num].configure(text="○", fg=MUTED)
                self.stage_labels[num].configure(fg=MUTED)
        if stage >= 6:
            for num, _ in STAGES:
                self.stage_vars[num].configure(text="✓", fg=MOSS)
                self.stage_labels[num].configure(fg=INK)
        self.detail_var.set(message)
        self.detail.configure(fg=INK if stage > 0 else MUTED)

    def on_progress(self, stage: int, message: str):
        # Marshal UI updates onto the Tk thread
        self.after(0, lambda: self.set_stage(stage, message))

    def on_make(self):
        if self.busy:
            return
        url = self.url_var.get().strip()
        if not url:
            self.detail_var.set("Paste a Project Gutenberg link first.")
            self.detail.configure(fg=ERROR)
            self.url_entry.focus_set()
            return

        self.busy = True
        self.button.configure(state="disabled", text="Working…")
        self.url_entry.configure(state="disabled")
        self.reset_checklist()
        self.detail_var.set("Starting…")
        self.detail.configure(fg=INK)

        def worker():
            set_progress_callback(self.on_progress)
            try:
                path = make_booklet(url)
                self.after(0, lambda: self.on_success(path))
            except PocketbookError as e:
                self.after(0, lambda: self.on_failure(str(e)))
            except Exception as e:
                self.after(0, lambda: self.on_failure(f"Conversion failed: {e}"))
            finally:
                set_progress_callback(None)

        threading.Thread(target=worker, daemon=True).start()

    def on_success(self, path: str):
        self.busy = False
        self.button.configure(state="normal", text="Make booklet")
        self.url_entry.configure(state="normal")
        self.set_stage(6, f"Done — saved to Downloads\n{os.path.basename(path)}")
        try:
            open_file(path)
        except Exception:
            pass

    def on_failure(self, message: str):
        self.busy = False
        self.button.configure(state="normal", text="Make booklet")
        self.url_entry.configure(state="normal")
        self.detail_var.set(message)
        self.detail.configure(fg=ERROR)
        messagebox.showerror("PocketBook", message)

    def on_close(self):
        if self.busy:
            if not messagebox.askokcancel(
                "PocketBook",
                "A booklet is still being made. Quit anyway?",
            ):
                return
        self.destroy()


def main():
    app = PocketBookApp()
    app.mainloop()


if __name__ == "__main__":
    main()
