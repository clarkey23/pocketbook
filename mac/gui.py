#!/usr/bin/env python3
"""PocketBook Mac GUI — paste a Gutenberg link, watch in-window progress, get a PDF."""

import os
import sys
import threading
import tkinter as tk
from tkinter import messagebox

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
PAPER = "#f2f0ea"
MOSS = "#2f5440"
MOSS_HOVER = "#3d6b4f"
MUTED = "#4a5c52"
ERROR = "#a84832"
BUTTON_TEXT = "#ffffff"


class PocketBookApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PocketBook")
        self.configure(bg=PAPER)
        self.resizable(True, True)
        self.busy = False

        outer = tk.Frame(self, bg=PAPER)
        outer.pack(fill="both", expand=True, padx=24, pady=20)

        tk.Label(
            outer,
            text="PocketBook",
            font=("Helvetica Neue", 26, "bold"),
            fg=INK,
            bg=PAPER,
            anchor="w",
        ).pack(fill="x", pady=(0, 4))

        tk.Label(
            outer,
            text="Paste a Project Gutenberg link. Get a foldable pocket PDF.",
            font=("Helvetica Neue", 13),
            fg=MUTED,
            bg=PAPER,
            anchor="w",
            wraplength=400,
            justify="left",
        ).pack(fill="x", pady=(0, 16))

        tk.Label(
            outer,
            text="Gutenberg link",
            font=("Helvetica Neue", 12, "bold"),
            fg=INK,
            bg=PAPER,
            anchor="w",
        ).pack(fill="x")

        self.url_var = tk.StringVar()
        self.url_entry = tk.Entry(
            outer,
            textvariable=self.url_var,
            font=("Helvetica Neue", 14),
            bg="#ffffff",
            fg=INK,
            insertbackground=INK,
            relief="solid",
            bd=1,
            highlightthickness=2,
            highlightbackground="#c9c5bc",
            highlightcolor=MOSS,
        )
        self.url_entry.pack(fill="x", pady=(6, 4), ipady=9)
        self.url_entry.focus_set()

        tk.Label(
            outer,
            text="Ebook page or HTML zip URL works.",
            font=("Helvetica Neue", 11),
            fg=MUTED,
            bg=PAPER,
            anchor="w",
        ).pack(fill="x", pady=(0, 14))

        # macOS tk.Button ignores bg/fg — use a Label "button" instead.
        self.button = tk.Label(
            outer,
            text="  Make booklet  ",
            font=("Helvetica Neue", 14, "bold"),
            fg=BUTTON_TEXT,
            bg=MOSS,
            padx=18,
            pady=12,
            cursor="hand2",
        )
        self.button.pack(anchor="w", pady=(0, 18))
        self.button.bind("<Button-1>", self._on_button_press)
        self.button.bind("<Enter>", self._on_button_enter)
        self.button.bind("<Leave>", self._on_button_leave)

        check_frame = tk.Frame(outer, bg=PAPER)
        check_frame.pack(fill="x", pady=(0, 8))
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
            wraplength=400,
            justify="left",
        )
        self.detail.pack(fill="x", pady=(14, 8))

        self.bind("<Return>", lambda _e: self.on_make())
        self.protocol("WM_DELETE_WINDOW", self.on_close)

        # Size to content so the bottom status line is never clipped.
        self.update_idletasks()
        req_w = max(460, outer.winfo_reqwidth() + 48)
        req_h = outer.winfo_reqheight() + 48
        self.geometry(f"{req_w}x{req_h}")
        self.minsize(440, req_h)

    def _on_button_enter(self, _event=None):
        if not self.busy:
            self.button.configure(bg=MOSS_HOVER)

    def _on_button_leave(self, _event=None):
        if not self.busy:
            self.button.configure(bg=MOSS)

    def _on_button_press(self, _event=None):
        self.on_make()

    def set_button_busy(self, busy: bool):
        self.busy = busy
        if busy:
            self.button.configure(text="  Working…  ", bg="#7a8f82", fg="#ffffff", cursor="watch")
        else:
            self.button.configure(text="  Make booklet  ", bg=MOSS, fg=BUTTON_TEXT, cursor="hand2")

    def reset_checklist(self):
        for num, _ in STAGES:
            self.stage_vars[num].configure(text="○", fg=MUTED)
            self.stage_labels[num].configure(fg=MUTED)

    def set_stage(self, stage: int, message: str):
        for num, _ in STAGES:
            if 0 < num < stage:
                self.stage_vars[num].configure(text="✓", fg=MOSS)
                self.stage_labels[num].configure(fg=INK)
            elif num == stage and stage > 0:
                self.stage_vars[num].configure(text="●", fg=MOSS)
                self.stage_labels[num].configure(fg=INK)
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

        self.set_button_busy(True)
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
        self.set_button_busy(False)
        self.url_entry.configure(state="normal")
        self.set_stage(6, f"Done - saved to Downloads\n{os.path.basename(path)}")
        try:
            open_file(path)
        except Exception:
            pass

    def on_failure(self, message: str):
        self.set_button_busy(False)
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
