"""
Senha Baixa — Console de operações Telegram.
UI reformulada: paleta grafite + âmbar, sidebar vertical, lista de grupos com foto.
"""

import asyncio
import hashlib
import json
import os
import tempfile
import threading
import time
import tkinter as tk
from datetime import datetime, timezone, timedelta
from tkinter import messagebox, scrolledtext, ttk
from typing import Dict, Any, Optional, List, Tuple

try:
    from PIL import Image, ImageTk, ImageDraw
except ImportError:
    Image = None
    ImageTk = None
    ImageDraw = None

try:
    from telethon import TelegramClient
    from telethon.errors import SessionPasswordNeededError
    from telethon.sessions import StringSession
    from telethon.tl.types import Channel, Chat
    from telethon import events as tg_events
    try:
        from telethon.tl.types import ChannelParticipantsAdmins
    except Exception:
        ChannelParticipantsAdmins = None
except ImportError:
    TelegramClient = None
    StringSession = None
    SessionPasswordNeededError = Exception
    Channel = object
    Chat = object
    tg_events = None
    ChannelParticipantsAdmins = None

try:
    from zoneinfo import ZoneInfo
    BRASILIA_TZ = ZoneInfo("America/Sao_Paulo")
except Exception:
    BRASILIA_TZ = None

CONFIG_FILE = "config.json"
APP_NAME = "Senha Baixa"

# limite do painel multi
MULTI_MAX_ACCOUNTS = 20

# offset do relógio de Brasília, sincronizado por HTTP (segundos)
_BR_OFFSET_LOCK = threading.Lock()
_BR_OFFSET_SECONDS: float = 0.0
_BR_SYNCED: bool = False


def _sync_brasilia_offset() -> None:
    """Sincroniza offset local vs Brasília via HTTP. Retenta em background."""
    global _BR_OFFSET_SECONDS, _BR_SYNCED
    try:
        import urllib.request as _u
        req = _u.Request(
            "https://worldtimeapi.org/api/timezone/America/Sao_Paulo",
            headers={"User-Agent": "SenhaBaixa/1.0"},
        )
        with _u.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        iso = data.get("datetime")
        if iso:
            # ex: '2026-07-11T18:07:20.123456-03:00'
            # normaliza truncando ms para 6 dígitos
            if "." in iso and "+" in iso.split(".", 1)[1] or "-" in iso.split(".", 1)[1] if "." in iso else False:
                pass
            try:
                server = datetime.fromisoformat(iso)
            except Exception:
                iso2 = iso.split(".")[0] + iso[-6:] if "." in iso else iso
                server = datetime.fromisoformat(iso2)
            local_utc = datetime.now(timezone.utc)
            with _BR_OFFSET_LOCK:
                _BR_OFFSET_SECONDS = (server - local_utc.astimezone(server.tzinfo)).total_seconds()
                _BR_SYNCED = True
            return
    except Exception:
        pass


def _start_brasilia_sync_thread() -> None:
    def _loop():
        while True:
            _sync_brasilia_offset()
            time.sleep(300 if _BR_SYNCED else 15)
    t = threading.Thread(target=_loop, daemon=True)
    t.start()


def _brasilia_now() -> datetime:
    """Retorna 'agora' em Brasília usando offset sincronizado. Fallback: UTC-3."""
    with _BR_OFFSET_LOCK:
        off = _BR_OFFSET_SECONDS
        synced = _BR_SYNCED
    base = datetime.now(timezone.utc) + timedelta(seconds=off)
    if synced:
        return base.astimezone(timezone(timedelta(hours=-3)))
    return datetime.now(timezone(timedelta(hours=-3)))

# my.telegram.org (opcional — só precisa se o usuário clicar em "Obter API automaticamente")
try:
    import re as _re_mt
    import requests as _requests_mt
    _HAS_REQUESTS = True
except ImportError:
    _HAS_REQUESTS = False

METHOD_LABELS = {
    "abertura":  "Grupo fechado",
    "mensagem":  "Grupo aberto",
    "abertura2": "Grupo aberto 2",
}
METHOD_KEYS = list(METHOD_LABELS.keys())
METHOD_HELP = {
    "abertura":  "Envia a mensagem assim que o admin ou dono abrir o grupo.",
    "mensagem":  "Envia a mensagem assim que o admin ou dono postar alguma mensagem.",
    "abertura2": "Envia a mensagem assim que bater o horário programado.",
}

# limite de tentativas do modo 'Grupo fechado' (a cada 0.01s)
CLOSED_MAX_ATTEMPTS = 2000

# ============================================================================
# Paleta Grafite + Âmbar
# ============================================================================
THEME = {
    "bg_primary":   "#141414",  # fundo geral
    "bg_secondary": "#1E1E1E",  # cards / painéis
    "bg_tertiary":  "#2A2A2A",  # inputs, hover leve
    "bg_hover":     "#333333",  # hover forte
    "bg_active":    "#242424",  # item selecionado
    "border":       "#3A3A3A",
    "border_soft":  "#2E2E2E",
    "text_primary":   "#ECEAE3",
    "text_secondary": "#9A968C",
    "text_muted":     "#6B6963",
    "accent":       "#D97757",
    "accent_hover": "#E88A6A",
    "accent_soft":  "#3A2820",
    "success": "#7A9F7E",
    "warning": "#C79A55",
    "error":   "#B4534B",
    "info":    "#8A9AA8",
}

FONT_UI    = "Segoe UI"
FONT_TITLE = "Georgia"
FONT_MONO  = "Consolas"


# ============================================================================
# Utilitários de imagem
# ============================================================================
_PHOTO_CACHE: Dict[str, Any] = {}

def _make_round_photo(path: Optional[str], size: int = 40):
    """Retorna PhotoImage circular com fundo do tema. None se PIL indisponível ou path inválido."""
    if not path or not os.path.exists(path) or Image is None or ImageTk is None:
        return None
    key = f"{path}:{size}"
    if key in _PHOTO_CACHE:
        return _PHOTO_CACHE[key]
    try:
        try:
            resample = Image.Resampling.LANCZOS  # Pillow >= 10
        except AttributeError:
            resample = getattr(Image, "LANCZOS", getattr(Image, "ANTIALIAS", 1))
        img = Image.open(path).convert("RGBA").resize((size, size), resample)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        photo = ImageTk.PhotoImage(out)
        _PHOTO_CACHE[key] = photo
        return photo
    except Exception:
        return None

def _make_initial_photo(name: str, size: int = 40):
    """Círculo com a inicial do nome (fallback quando não há foto)."""
    if Image is None or ImageTk is None:
        return None
    key = f"initial:{name}:{size}"
    if key in _PHOTO_CACHE:
        return _PHOTO_CACHE[key]
    try:
        # cor derivada do hash do nome pra variar avatar
        h = int(hashlib.md5(name.encode("utf-8")).hexdigest()[:6], 16)
        r = 80 + (h & 0x3F)
        g = 60 + ((h >> 6) & 0x3F)
        b = 50 + ((h >> 12) & 0x3F)
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse((0, 0, size, size), fill=(r, g, b, 255))
        letter = (name.strip()[:1] or "?").upper()
        try:
            from PIL import ImageFont
            font = ImageFont.truetype("segoeui.ttf", int(size * 0.5))
        except Exception:
            font = None
        bbox = d.textbbox((0, 0), letter, font=font) if font else (0, 0, size*0.4, size*0.6)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text(((size - tw)/2 - bbox[0], (size - th)/2 - bbox[1]), letter, fill=(236, 234, 227, 255), font=font)
        photo = ImageTk.PhotoImage(img)
        _PHOTO_CACHE[key] = photo
        return photo
    except Exception:
        return None


# ============================================================================
# Widgets base
# ============================================================================

class ScrollFrame(ttk.Frame):
    def __init__(self, parent, bg=None, **kwargs):
        # nota: rolagem sem barra visual (wheel-only)
        super().__init__(parent, **kwargs)
        bg = bg or THEME["bg_primary"]
        self.canvas = tk.Canvas(self, bg=bg, highlightthickness=0, borderwidth=0)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.inner = ttk.Frame(self, style="App.TFrame")
        self._window = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        # scrollbar invisível — mantém funcional via wheel
        # scrollbar.pack(side="right", fill="y")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfig(self._window, width=e.width))
        for w in (self.canvas, self.inner):
            w.bind("<MouseWheel>", self._wheel)
            w.bind("<Button-4>", self._wheel)
            w.bind("<Button-5>", self._wheel)

    def _wheel(self, event):
        if event.num == 5 or getattr(event, "delta", 0) < 0:
            self.canvas.yview_scroll(3, "units")
        elif event.num == 4 or getattr(event, "delta", 0) > 0:
            self.canvas.yview_scroll(-3, "units")
        return "break"


class Pill(tk.Frame):
    """Pílula de status: dot colorido + texto."""
    def __init__(self, parent, text="", tone="muted"):
        super().__init__(parent, bg=THEME["bg_secondary"], highlightthickness=1,
                         highlightbackground=THEME["border"], highlightcolor=THEME["border"])
        self._dot = tk.Label(self, text="●", bg=THEME["bg_secondary"], fg=THEME["text_muted"],
                             font=(FONT_UI, 9))
        self._dot.pack(side=tk.LEFT, padx=(10, 6), pady=4)
        self._label = tk.Label(self, text=text, bg=THEME["bg_secondary"],
                               fg=THEME["text_secondary"], font=(FONT_UI, 9))
        self._label.pack(side=tk.LEFT, padx=(0, 12), pady=4)
        self.set(text, tone)

    def set(self, text, tone="muted"):
        color = {
            "muted":   THEME["text_muted"],
            "info":    THEME["info"],
            "success": THEME["success"],
            "warning": THEME["warning"],
            "error":   THEME["error"],
            "accent":  THEME["accent"],
        }.get(tone, THEME["text_muted"])
        self._dot.configure(fg=color)
        self._label.configure(text=text, fg=THEME["text_primary"] if tone != "muted" else THEME["text_secondary"])


class LogViewer(scrolledtext.ScrolledText):
    def __init__(self, parent, **kwargs):
        super().__init__(
            parent, bg="#0A0A0A", fg=THEME["text_primary"],
            font=(FONT_MONO, 10), relief="flat", borderwidth=0,
            highlightthickness=1, highlightbackground=THEME["border"],
            highlightcolor=THEME["border"], insertbackground=THEME["accent"],
            selectbackground="#2A2A2A", selectforeground=THEME["text_primary"],
            padx=14, pady=12, wrap="word", state="disabled", **kwargs
        )
        # esconde a scrollbar embutida do ScrolledText — fica invisível mas rola via wheel
        try:
            self.vbar.pack_forget()
        except Exception:
            pass
        self.tag_configure("success",   foreground="#8FBF93")
        self.tag_configure("error",     foreground="#E88A6A")
        self.tag_configure("warning",   foreground="#D9B171")
        self.tag_configure("info",      foreground="#9FB5C2")
        self.tag_configure("debug",     foreground="#8A8580")
        self.tag_configure("timestamp", foreground="#6B6963")
        # mousewheel próprio (não deixa o pai roubar o scroll)
        def _wheel(event):
            if event.num == 5 or getattr(event, "delta", 0) < 0:
                self.yview_scroll(2, "units")
            elif event.num == 4 or getattr(event, "delta", 0) > 0:
                self.yview_scroll(-2, "units")
            return "break"
        self.bind("<MouseWheel>", _wheel)
        self.bind("<Button-4>",  _wheel)
        self.bind("<Button-5>",  _wheel)

    def add_log(self, msg: str, tag: str = "info"):
        ts = datetime.now().strftime("%H:%M:%S")
        self.config(state="normal")
        self.insert(tk.END, f"  {ts}  ", "timestamp")
        self.insert(tk.END, f"{msg}\n", tag)
        self.see(tk.END)
        self.config(state="disabled")
        self.update_idletasks()


# ---------------------------------------------------------------------------
# Tooltip simples (para o ícone de ajuda "?")
# ---------------------------------------------------------------------------
class Tooltip:
    def __init__(self, widget, text, delay=250):
        self.widget = widget
        self.text = text
        self.delay = delay
        self._tip = None
        self._after = None
        widget.bind("<Enter>", self._schedule)
        widget.bind("<Leave>", self._hide)
        widget.bind("<ButtonPress>", self._hide)
    def _schedule(self, _=None):
        self._cancel()
        self._after = self.widget.after(self.delay, self._show)
    def _cancel(self):
        if self._after:
            try: self.widget.after_cancel(self._after)
            except Exception: pass
            self._after = None
    def _show(self):
        if self._tip or not self.widget.winfo_exists():
            return
        self._tip = tk.Toplevel(self.widget)
        self._tip.wm_overrideredirect(True)
        self._tip.configure(bg=THEME["border"])
        inner = tk.Label(self._tip, text=self.text, justify="left",
                         bg="#1A1A1A", fg=THEME["text_primary"],
                         font=(FONT_UI, 9), padx=10, pady=8,
                         wraplength=280, bd=0)
        inner.pack(padx=1, pady=1)
        # posiciona depois de medir, ajustando para caber na tela
        self._tip.update_idletasks()
        w = self._tip.winfo_reqwidth()
        h = self._tip.winfo_reqheight()
        sw = self.widget.winfo_screenwidth()
        sh = self.widget.winfo_screenheight()
        x = self.widget.winfo_rootx() + self.widget.winfo_width() + 8
        y = self.widget.winfo_rooty()
        if x + w > sw - 4:
            x = self.widget.winfo_rootx() - w - 8
        if x < 4:
            x = 4
        if y + h > sh - 4:
            y = sh - h - 4
        if y < 4:
            y = 4
        self._tip.wm_geometry(f"+{x}+{y}")
    def _hide(self, _=None):
        self._cancel()
        if self._tip:
            try: self._tip.destroy()
            except Exception: pass
            self._tip = None

def add_help_icon(parent, text, bg=None):
    """Coloca um pequeno '?' clicável/hover ao lado de um label."""
    bg = bg or THEME["bg_secondary"]
    lbl = tk.Label(parent, text="?", bg=bg, fg=THEME["text_muted"],
                   font=(FONT_UI, 8, "bold"), cursor="question_arrow",
                   width=2, relief="flat",
                   highlightthickness=1, highlightbackground=THEME["border"])
    Tooltip(lbl, text)
    return lbl


# ---------------------------------------------------------------------------
# Botão arredondado (Canvas) — bordas suaves
# ---------------------------------------------------------------------------
class RoundedButton(tk.Canvas):
    def __init__(self, parent, text="", command=None, variant="accent",
                 width=None, height=36, radius=10, pad_x=18, font=None):
        self._parent_bg = self._get_parent_bg(parent)
        super().__init__(parent, height=height, highlightthickness=0,
                         borderwidth=0, bg=self._parent_bg)
        self.text = text
        self.command = command
        self.variant = variant
        self.radius = radius
        self.pad_x = pad_x
        self._enabled = True
        self._font = font or (FONT_UI, 10, "bold" if variant == "accent" else "normal")
        self._colors = self._palette(variant)
        self._state_bg = self._colors["bg"]
        # medir texto pra calcular largura
        tmp = self.create_text(0, 0, text=text, font=self._font, anchor="nw")
        b = self.bbox(tmp)
        if tmp:
            self.delete(tmp)
        if b:
            tw = b[2] - b[0]
            w = width if width is not None else max(int(tw + pad_x * 2), 60)
        else:
            w = width if width is not None else 100
        self.configure(width=w, height=height)
        self._canvas_w, self._canvas_h = w, height
        self.bind("<Configure>", lambda e: self.after(10, self._redraw))
        self.bind("<Enter>",   lambda e: self._set_state(self._colors["hover"]))
        self.bind("<Leave>",   lambda e: self._set_state(self._colors["bg"]))
        self.bind("<Button-1>",       lambda e: self._set_state(self._colors["active"]))
        self.bind("<ButtonRelease-1>", self._on_release)
        self.after(10, self._redraw)
    def _get_parent_bg(self, parent):
        try:  return parent.cget("bg")
        except Exception:
            try: return parent.cget("background")
            except Exception: return THEME["bg_primary"]
    def _palette(self, variant):
        if variant == "accent":
            return {"bg": THEME["accent"], "hover": THEME["accent_hover"],
                    "active": "#B8624A", "fg": "#FFFFFF", "border": THEME["accent"]}
        if variant == "danger":
            return {"bg": THEME["bg_secondary"], "hover": THEME["error"],
                    "active": "#8C3F3A", "fg": THEME["error"], "border": THEME["error"]}
        if variant == "ghost":
            return {"bg": THEME["bg_primary"], "hover": THEME["bg_secondary"],
                    "active": THEME["bg_tertiary"], "fg": THEME["text_secondary"], "border": THEME["bg_primary"]}
        # secondary
        return {"bg": THEME["bg_secondary"], "hover": THEME["bg_hover"],
                "active": THEME["bg_tertiary"], "fg": THEME["text_primary"], "border": THEME["border"]}
    def _set_state(self, color):
        if not self._enabled: return
        self._state_bg = color
        self._redraw()
    def _on_release(self, _e):
        if not self._enabled: return
        self._set_state(self._colors["hover"])
        if self.command:
            try: self.command()
            except Exception as e: print("btn err:", e)
    def _redraw(self):
        self.delete("all")
        w, h = self.winfo_width() or self._canvas_w, self.winfo_height() or self._canvas_h
        r = min(self.radius, h // 2)
        bg = self._state_bg if self._enabled else THEME["bg_secondary"]
        fg = self._colors["fg"] if self._enabled else THEME["text_muted"]
        border = self._colors["border"] if self._enabled else THEME["border"]
        # corpo arredondado
        self.create_oval(0, 0, 2*r, 2*r, fill=bg, outline=border)
        self.create_oval(w-2*r, 0, w, 2*r, fill=bg, outline=border)
        self.create_oval(0, h-2*r, 2*r, h, fill=bg, outline=border)
        self.create_oval(w-2*r, h-2*r, w, h, fill=bg, outline=border)
        self.create_rectangle(r, 0, w-r, h, fill=bg, outline=bg)
        self.create_rectangle(0, r, w, h-r, fill=bg, outline=bg)
        # bordas retas
        self.create_line(r, 0, w-r, 0, fill=border)
        self.create_line(r, h-1, w-r, h-1, fill=border)
        self.create_line(0, r, 0, h-r, fill=border)
        self.create_line(w-1, r, w-1, h-r, fill=border)
        self.create_text(w//2, h//2, text=self.text, fill=fg, font=self._font)
    def set_text(self, text):
        self.text = text; self._redraw()
    def set_command(self, command):
        self.command = command
    def set_enabled(self, enabled):
        self._enabled = enabled; self._redraw()


# ---------------------------------------------------------------------------
# Entry arredondado (frame + Entry sem borda)
# ---------------------------------------------------------------------------
class RoundedEntry(tk.Frame):
    def __init__(self, parent, textvariable=None, show=None, width=None, **kwargs):
        bg_parent = kwargs.pop("bg", None)
        super().__init__(parent, bg=bg_parent or THEME["bg_secondary"])
        self._wrap = tk.Frame(self, bg=THEME["bg_tertiary"],
                              highlightthickness=1,
                              highlightbackground=THEME["border"],
                              highlightcolor=THEME["accent"])
        self._wrap.pack(fill=tk.X)
        self.entry = tk.Entry(self._wrap, textvariable=textvariable, show=show,
                              bg=THEME["bg_tertiary"], fg=THEME["text_primary"],
                              insertbackground=THEME["accent"], relief="flat",
                              borderwidth=0, font=(FONT_UI, 10))
        self.entry.pack(fill=tk.X, padx=12, pady=8, ipady=2)
        if width: self.entry.configure(width=width)
    def get(self): return self.entry.get()
    def delete(self, *a, **kw): return self.entry.delete(*a, **kw)
    def insert(self, *a, **kw): return self.entry.insert(*a, **kw)
    def focus_set(self): return self.entry.focus_set()


class GroupListPanel(tk.Frame):
    """Lista rolável de grupos com foto + nome. modo 'single' ou 'multi'."""
    def __init__(self, parent, mode="single", on_select=None, on_toggle=None,
                 height=280, width=None):
        super().__init__(parent, bg=THEME["bg_secondary"], highlightthickness=1,
                         highlightbackground=THEME["border"])
        self.mode = mode
        self.on_select = on_select
        self.on_toggle = on_toggle
        self._items: List[Dict] = []
        self._selected_id: Optional[str] = None
        self._checked: set = set()

        # header
        header = tk.Frame(self, bg=THEME["bg_secondary"])
        header.pack(fill=tk.X, padx=12, pady=(10, 4))
        tk.Label(header, text="GRUPOS", bg=THEME["bg_secondary"],
                 fg=THEME["text_muted"], font=(FONT_UI, 9, "bold")).pack(side=tk.LEFT)
        self.count_label = tk.Label(header, text="", bg=THEME["bg_secondary"],
                                    fg=THEME["text_muted"], font=(FONT_UI, 9))
        self.count_label.pack(side=tk.RIGHT)

        # canvas scrollável
        wrap = tk.Frame(self, bg=THEME["bg_secondary"])
        wrap.pack(fill=tk.BOTH, expand=True, padx=6, pady=(0, 8))
        self.canvas = tk.Canvas(wrap, bg=THEME["bg_secondary"], highlightthickness=0,
                                borderwidth=0, height=height)
        vsb = ttk.Scrollbar(wrap, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=vsb.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        # scrollbar invisível
        # vsb.pack(side="right", fill="y")
        self.inner = tk.Frame(self.canvas, bg=THEME["bg_secondary"])
        self._win = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfig(self._win, width=e.width))
        for w in (self.canvas, self.inner):
            w.bind("<MouseWheel>", self._wheel)
            w.bind("<Button-4>", self._wheel)
            w.bind("<Button-5>", self._wheel)

        self._empty = tk.Label(self.inner, text="Nenhum grupo carregado", bg=THEME["bg_secondary"],
                               fg=THEME["text_muted"], font=(FONT_UI, 10), pady=24)
        self._empty.pack(fill=tk.X)

    def _wheel(self, event):
        # bloqueia overshoot pra evitar bug visual de "lista descendo" no topo
        y0, y1 = self.canvas.yview()
        if event.num == 5 or getattr(event, "delta", 0) < 0:
            if y1 >= 1.0:
                return "break"
            self.canvas.yview_scroll(2, "units")
        elif event.num == 4 or getattr(event, "delta", 0) > 0:
            if y0 <= 0.0:
                return "break"
            self.canvas.yview_scroll(-2, "units")
        return "break"

    def set_items(self, items: List[Tuple[str, str, Optional[str]]]):
        """items = lista de (id, nome, photo_path_or_None)."""
        for w in self.inner.winfo_children():
            w.destroy()
        self._items = []
        self.count_label.configure(text=f"{len(items)}")
        if not items:
            self._empty = tk.Label(self.inner, text="Nenhum grupo carregado",
                                   bg=THEME["bg_secondary"], fg=THEME["text_muted"],
                                   font=(FONT_UI, 10), pady=24)
            self._empty.pack(fill=tk.X)
            return
        for gid, name, photo_path in items:
            self._add_row(gid, name, photo_path)

    def _add_row(self, gid: str, name: str, photo_path: Optional[str]):
        row = tk.Frame(self.inner, bg=THEME["bg_secondary"], cursor="hand2")
        row.pack(fill=tk.X, padx=2, pady=1)
        row._gid = gid
        row._selected = False

        # barra âmbar à esquerda (invisível até selecionar)
        bar = tk.Frame(row, bg=THEME["bg_secondary"], width=3)
        bar.pack(side=tk.LEFT, fill=tk.Y)

        # checkbox (só multi)
        check = None
        if self.mode == "multi":
            check = tk.Label(row, text="☐", bg=THEME["bg_secondary"],
                             fg=THEME["text_muted"], font=(FONT_UI, 13))
            check.pack(side=tk.LEFT, padx=(8, 4))

        photo = _make_round_photo(photo_path, 40) if photo_path else None
        if photo is None:
            photo = _make_initial_photo(name, 40)
        if photo is not None:
            av = tk.Label(row, image=photo, bg=THEME["bg_secondary"])
            av.image = photo
            av.pack(side=tk.LEFT, padx=(8, 10), pady=8)
        else:
            av = tk.Label(row, text=(name[:1] or "?").upper(), width=3,
                          bg=THEME["bg_tertiary"], fg=THEME["accent"],
                          font=(FONT_UI, 12, "bold"))
            av.pack(side=tk.LEFT, padx=(8, 10), pady=8)

        nl = tk.Label(row, text=name, bg=THEME["bg_secondary"],
                      fg=THEME["text_primary"], font=(FONT_UI, 10), anchor="w")
        nl.pack(side=tk.LEFT, fill=tk.X, expand=True, pady=8)

        widgets = [row, av, nl] + ([check] if check else [])
        entry = {"row": row, "bar": bar, "name_label": nl, "avatar": av,
                 "check": check, "id": gid, "name": name}
        self._items.append(entry)

        def enter(_e, r=entry): self._hover(r, True)
        def leave(_e, r=entry): self._hover(r, False)
        def click(_e, r=entry): self._clicked(r)
        for w in widgets:
            w.bind("<Enter>", enter)
            w.bind("<Leave>", leave)
            w.bind("<Button-1>", click)
            w.bind("<MouseWheel>", self._wheel)
            w.bind("<Button-4>", self._wheel)
            w.bind("<Button-5>", self._wheel)

    def _hover(self, entry, on):
        gid = entry["id"]
        is_selected = (self.mode == "single" and gid == self._selected_id) or \
                      (self.mode == "multi" and gid in self._checked)
        bg = THEME["bg_hover"] if on else (THEME["bg_active"] if is_selected else THEME["bg_secondary"])
        entry["row"].configure(bg=bg)
        entry["name_label"].configure(bg=bg)
        entry["avatar"].configure(bg=bg)
        if entry["check"]:
            entry["check"].configure(bg=bg)

    def _clicked(self, entry):
        gid = entry["id"]
        if self.mode == "single":
            self.select(gid)
            if self.on_select:
                self.on_select(gid, entry["name"])
        else:
            if gid in self._checked:
                self._checked.discard(gid)
            else:
                self._checked.add(gid)
            self._render_state()
            if self.on_toggle:
                self.on_toggle(gid, gid in self._checked)

    def select(self, gid: Optional[str]):
        self._selected_id = gid
        self._render_state()

    def get_selected(self) -> Optional[str]:
        return self._selected_id

    def get_checked(self) -> List[str]:
        return list(self._checked)

    def set_checked(self, ids: List[str]):
        self._checked = set(ids)
        self._render_state()

    def _render_state(self):
        for e in self._items:
            gid = e["id"]
            is_sel = (self.mode == "single" and gid == self._selected_id) or \
                     (self.mode == "multi" and gid in self._checked)
            bg = THEME["bg_active"] if is_sel else THEME["bg_secondary"]
            e["row"].configure(bg=bg)
            e["name_label"].configure(bg=bg,
                fg=THEME["text_primary"] if is_sel else THEME["text_primary"])
            e["avatar"].configure(bg=bg)
            e["bar"].configure(bg=THEME["accent"] if is_sel else bg)
            if e["check"]:
                e["check"].configure(bg=bg,
                    text="☑" if gid in self._checked else "☐",
                    fg=THEME["accent"] if gid in self._checked else THEME["text_muted"])


# ---------------------------------------------------------------------------
# Country codes (DDI) + máscara de telefone
# ---------------------------------------------------------------------------
COUNTRIES: List[Tuple[str, str, str, str]] = [
    # (flag, name, dial, mask)  -- mask: 'D' = dígito
    ("🇧🇷", "Brasil",         "+55", "(DD) DDDDD-DDDD"),
    ("🇺🇸", "Estados Unidos", "+1",  "(DDD) DDD-DDDD"),
    ("🇨🇦", "Canadá",         "+1",  "(DDD) DDD-DDDD"),
    ("🇲🇽", "México",         "+52", "(DD) DDDD-DDDD"),
    ("🇦🇷", "Argentina",      "+54", "(DDD) DDDD-DDDD"),
    ("🇨🇱", "Chile",          "+56", "D DDDD DDDD"),
    ("🇨🇴", "Colômbia",       "+57", "DDD DDD DDDD"),
    ("🇵🇪", "Peru",           "+51", "DDD DDD DDD"),
    ("🇺🇾", "Uruguai",        "+598", "DD DDD DDD"),
    ("🇵🇾", "Paraguai",       "+595", "DDD DDD DDD"),
    ("🇧🇴", "Bolívia",        "+591", "D DDD DDDD"),
    ("🇻🇪", "Venezuela",      "+58", "DDD DDD DDDD"),
    ("🇬🇧", "Reino Unido",    "+44", "DDDD DDD DDDD"),
    ("🇫🇷", "França",         "+33", "D DD DD DD DD"),
    ("🇪🇸", "Espanha",        "+34", "DDD DDD DDD"),
    ("🇩🇪", "Alemanha",       "+49", "(DDD) DDDDD-DDD"),
    ("🇮🇹", "Itália",         "+39", "(DD) DDDD DDDD"),
    ("🇵🇹", "Portugal",       "+351", "DDD DDD DDD"),
    ("🇳🇱", "Holanda",        "+31", "D DDDD DDDD"),
    ("🇧🇪", "Bélgica",        "+32", "DDD DD DD DD"),
    ("🇨🇭", "Suíça",          "+41", "DD DDD DD DD"),
    ("🇦🇹", "Áustria",        "+43", "DDD DDD DDDD"),
    ("🇸🇪", "Suécia",         "+46", "DD DDD DDDD"),
    ("🇳🇴", "Noruega",        "+47", "DDD DD DDD"),
    ("🇩🇰", "Dinamarca",      "+45", "DD DD DD DD"),
    ("🇫🇮", "Finlândia",      "+358", "DD DDD DDDD"),
    ("🇮🇪", "Irlanda",        "+353", "DD DDD DDDD"),
    ("🇵🇱", "Polônia",        "+48", "DDD DDD DDD"),
    ("🇨🇿", "República Tcheca", "+420", "DDD DDD DDD"),
    ("🇷🇺", "Rússia",         "+7", "(DDD) DDD-DD-DD"),
    ("🇺🇦", "Ucrânia",        "+380", "DD DDD DDDD"),
    ("🇹🇷", "Turquia",        "+90", "(DDD) DDD DD DD"),
    ("🇬🇷", "Grécia",         "+30", "DDD DDD DDDD"),
    ("🇦🇺", "Austrália",      "+61", "(D) DDDD DDDD"),
    ("🇳🇿", "Nova Zelândia",  "+64", "DD DDD DDDD"),
    ("🇯🇵", "Japão",          "+81", "(D) DDDD-DDDD"),
    ("🇰🇷", "Coreia do Sul",  "+82", "DD DDDD DDDD"),
    ("🇨🇳", "China",          "+86", "DDD DDDD DDDD"),
    ("🇮🇳", "Índia",          "+91", "DDDDD DDDDD"),
    ("🇮🇩", "Indonésia",      "+62", "DDD DDDD DDDD"),
    ("🇵🇭", "Filipinas",      "+63", "DDD DDD DDDD"),
    ("🇹🇭", "Tailândia",      "+66", "D DDDD DDDD"),
    ("🇻🇳", "Vietnã",         "+84", "DDD DDD DDD"),
    ("🇲🇾", "Malásia",        "+60", "DD DDDD DDDD"),
    ("🇸🇬", "Singapura",      "+65", "DDDD DDDD"),
    ("🇭🇰", "Hong Kong",      "+852", "DDDD DDDD"),
    ("🇦🇪", "E. Árabes Unidos", "+971", "DD DDD DDDD"),
    ("🇸🇦", "Arábia Saudita", "+966", "DD DDD DDDD"),
    ("🇮🇱", "Israel",         "+972", "DD DDD DDDD"),
    ("🇪🇬", "Egito",          "+20", "DDD DDD DDDD"),
    ("🇿🇦", "África do Sul",  "+27", "(DD) DDD DDDD"),
    ("🇳🇬", "Nigéria",        "+234", "DDD DDD DDDD"),
    ("🇰🇪", "Quênia",         "+254", "DDD DDD DDD"),
    ("🇲🇦", "Marrocos",       "+212", "DDD DDD DDD"),
    ("🇩🇿", "Argélia",        "+213", "DDD DDD DDD"),
    ("🇦🇴", "Angola",         "+244", "DDD DDD DDD"),
    ("🇲🇿", "Moçambique",     "+258", "DD DDD DDDD"),
]

_COUNTRY_BY_DIAL: Dict[str, Tuple[str, str, str, str]] = {}
for _c in COUNTRIES:
    _COUNTRY_BY_DIAL.setdefault(_c[2], _c)


def _apply_mask(digits: str, mask: str) -> str:
    out = []
    di = 0
    for ch in mask:
        if ch == "D":
            if di >= len(digits):
                break
            out.append(digits[di]); di += 1
        else:
            if di >= len(digits):
                break
            out.append(ch)
    # sobra
    if di < len(digits):
        out.append(digits[di:])
    return "".join(out)


def _detect_country(digits: str) -> Optional[Tuple[str, str, str, str]]:
    """Se o número começar com um DDI conhecido, retorna a tupla do país."""
    if not digits:
        return None
    for L in (4, 3, 2, 1):
        if len(digits) >= L:
            key = "+" + digits[:L]
            c = _COUNTRY_BY_DIAL.get(key)
            if c:
                return c
    return None


class PhoneEntry(tk.Frame):
    """DDI dropdown + telefone com máscara automática."""
    def __init__(self, parent, bg=None):
        bg = bg or THEME["bg_secondary"]
        super().__init__(parent, bg=bg)
        self._bg = bg
        self._country = COUNTRIES[0]  # Brasil default
        self._digits = ""
        self._updating = False

        # dropdown
        self._btn = tk.Label(self, bg=THEME["bg_tertiary"], fg=THEME["text_primary"],
                             font=(FONT_UI, 10), cursor="hand2",
                             padx=12, pady=8, bd=0,
                             highlightthickness=1, highlightbackground=THEME["border"])
        self._btn.pack(side=tk.LEFT, padx=(0, 6))
        self._btn.bind("<Button-1>", self._open_menu)
        self._render_btn()

        # entry
        wrap = tk.Frame(self, bg=THEME["bg_tertiary"],
                        highlightthickness=1,
                        highlightbackground=THEME["border"],
                        highlightcolor=THEME["accent"])
        wrap.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.entry = tk.Entry(wrap, bg=THEME["bg_tertiary"], fg=THEME["text_primary"],
                              insertbackground=THEME["accent"], relief="flat",
                              borderwidth=0, font=(FONT_UI, 10))
        self.entry.pack(fill=tk.X, padx=12, pady=8, ipady=2)
        self.entry.bind("<KeyRelease>", self._on_key)

    def _max_digits(self) -> int:
        # limite = quantidade de 'D' na máscara do país (ou 15 fallback E.164)
        mask = self._country[3] or ""
        n = mask.count("D")
        return n if n > 0 else 15

    def _render_btn(self):
        flag, name, dial, _mask = self._country
        self._btn.configure(text=f"{flag} {dial}  ▾")

    def _open_menu(self, _e=None):
        top = tk.Toplevel(self)
        top.wm_overrideredirect(True)
        x = self._btn.winfo_rootx()
        y = self._btn.winfo_rooty() + self._btn.winfo_height()
        top.wm_geometry(f"320x360+{x}+{y}")
        top.configure(bg=THEME["bg_secondary"])
        top.attributes("-topmost", True)

        search_var = tk.StringVar()
        ent = tk.Entry(top, textvariable=search_var, bg=THEME["bg_tertiary"],
                       fg=THEME["text_primary"], insertbackground=THEME["accent"],
                       relief="flat", font=(FONT_UI, 10))
        ent.pack(fill=tk.X, padx=8, pady=8, ipady=4)
        ent.focus_set()

        list_wrap = tk.Frame(top, bg=THEME["bg_secondary"])
        list_wrap.pack(fill=tk.BOTH, expand=True, padx=6, pady=(0, 6))
        cvs = tk.Canvas(list_wrap, bg=THEME["bg_secondary"], highlightthickness=0)
        cvs.pack(side="left", fill="both", expand=True)
        inner = tk.Frame(cvs, bg=THEME["bg_secondary"])
        cvs.create_window((0, 0), window=inner, anchor="nw", width=300)
        inner.bind("<Configure>", lambda e: cvs.configure(scrollregion=cvs.bbox("all")))
        def _mw(event):
            cvs.yview_scroll(-1 if getattr(event, "delta", 0) > 0 or event.num == 4 else 1, "units")
            return "break"
        cvs.bind("<MouseWheel>", _mw); cvs.bind("<Button-4>", _mw); cvs.bind("<Button-5>", _mw)

        def close():
            try: top.destroy()
            except Exception: pass

        def render(filt: str = ""):
            for w in inner.winfo_children():
                w.destroy()
            q = filt.strip().lower()
            for c in COUNTRIES:
                flag, name, dial, _m = c
                if q and q not in name.lower() and q not in dial:
                    continue
                row = tk.Frame(inner, bg=THEME["bg_secondary"], cursor="hand2")
                row.pack(fill=tk.X)
                lbl = tk.Label(row, text=f"{flag}  {name}  {dial}",
                               bg=THEME["bg_secondary"], fg=THEME["text_primary"],
                               font=(FONT_UI, 10), anchor="w", padx=10, pady=6)
                lbl.pack(fill=tk.X)
                def pick(_e=None, cc=c):
                    self._country = cc
                    self._render_btn()
                    self._reformat()
                    close()
                for w in (row, lbl):
                    w.bind("<Button-1>", pick)
                    w.bind("<Enter>", lambda _e=None, r=row, l=lbl: (r.configure(bg=THEME["bg_hover"]), l.configure(bg=THEME["bg_hover"])))
                    w.bind("<Leave>", lambda _e=None, r=row, l=lbl: (r.configure(bg=THEME["bg_secondary"]), l.configure(bg=THEME["bg_secondary"])))
                    w.bind("<MouseWheel>", _mw); w.bind("<Button-4>", _mw); w.bind("<Button-5>", _mw)

        render()
        search_var.trace_add("write", lambda *_: render(search_var.get()))
        top.bind("<Escape>", lambda _e: close())
        top.bind("<FocusOut>", lambda _e: top.after(150, close))

    def _on_key(self, _e=None):
        if self._updating:
            return
        raw = self.entry.get()
        # se colou com '+', tenta detectar país
        digits = "".join(ch for ch in raw if ch.isdigit())
        det = _detect_country(digits) if raw.strip().startswith("+") else None
        if det:
            self._country = det
            self._render_btn()
            dial_digits = det[2][1:]
            if digits.startswith(dial_digits):
                digits = digits[len(dial_digits):]
        # trunca no máximo permitido para o país
        self._digits = digits[: self._max_digits()]
        self._reformat()

    def _reformat(self):
        self._updating = True
        try:
            mask = self._country[3]
            formatted = _apply_mask(self._digits, mask)
            self.entry.delete(0, tk.END)
            self.entry.insert(0, formatted)
        finally:
            self._updating = False

    def get_e164(self) -> str:
        """Retorna telefone no formato +<ddi><digits>."""
        if not self._digits:
            return ""
        return f"{self._country[2]}{self._digits}"

    def set_e164(self, value: str):
        digits = "".join(ch for ch in (value or "") if ch.isdigit())
        det = _detect_country(digits)
        if det:
            self._country = det
            self._render_btn()
            dial_digits = det[2][1:]
            if digits.startswith(dial_digits):
                digits = digits[len(dial_digits):]
        self._digits = digits[: self._max_digits()]
        self._reformat()


# ---------------------------------------------------------------------------
# Método de envio — dropdown com tooltip por item (?)
# ---------------------------------------------------------------------------
class MethodPicker(tk.Frame):
    def __init__(self, parent, textvariable: tk.StringVar):
        super().__init__(parent, bg=THEME["bg_secondary"])
        self.var = textvariable
        self._btn_wrap = tk.Frame(self, bg=THEME["bg_tertiary"],
                                  highlightthickness=1,
                                  highlightbackground=THEME["border"])
        self._btn_wrap.pack(fill=tk.X)
        self._lbl = tk.Label(self._btn_wrap, textvariable=self.var,
                             bg=THEME["bg_tertiary"], fg=THEME["text_primary"],
                             font=(FONT_UI, 10), anchor="w", padx=12, pady=8)
        self._lbl.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self._arrow = tk.Label(self._btn_wrap, text="▾",
                               bg=THEME["bg_tertiary"], fg=THEME["text_muted"],
                               font=(FONT_UI, 10), padx=10)
        self._arrow.pack(side=tk.RIGHT)
        for w in (self._btn_wrap, self._lbl, self._arrow):
            w.configure(cursor="hand2")
            w.bind("<Button-1>", self._open)

    def _open(self, _e=None):
        # se já aberto, fecha (toggle)
        if getattr(self, "_popup", None) is not None:
            self._close_popup()
            return
        top = tk.Toplevel(self)
        top.wm_overrideredirect(True)
        top.attributes("-topmost", True)
        x = self._btn_wrap.winfo_rootx()
        y = self._btn_wrap.winfo_rooty() + self._btn_wrap.winfo_height() + 2
        w = self._btn_wrap.winfo_width()
        top.wm_geometry(f"{w}x{3 * 40}+{x}+{y}")
        top.configure(bg=THEME["bg_secondary"],
                      highlightthickness=1, highlightbackground=THEME["border"])
        self._popup = top

        def _on_global_click(e):
            # se clique fora do popup e fora do trigger, fecha
            try:
                wx, wy = top.winfo_rootx(), top.winfo_rooty()
                ww, wh = top.winfo_width(), top.winfo_height()
                if wx <= e.x_root <= wx + ww and wy <= e.y_root <= wy + wh:
                    return
                bx, by = self._btn_wrap.winfo_rootx(), self._btn_wrap.winfo_rooty()
                bw, bh = self._btn_wrap.winfo_width(), self._btn_wrap.winfo_height()
                if bx <= e.x_root <= bx + bw and by <= e.y_root <= by + bh:
                    return
            except Exception:
                pass
            self._close_popup()

        self._global_bind = self.winfo_toplevel().bind("<Button-1>", _on_global_click, add="+")

        for key in METHOD_KEYS:
            label = METHOD_LABELS[key]
            help_text = METHOD_HELP[key]
            row = tk.Frame(top, bg=THEME["bg_secondary"], cursor="hand2")
            row.pack(fill=tk.X)
            lbl = tk.Label(row, text=label, bg=THEME["bg_secondary"],
                           fg=THEME["text_primary"], font=(FONT_UI, 10),
                           anchor="w", padx=12, pady=8)
            lbl.pack(side=tk.LEFT, fill=tk.X, expand=True)
            q = tk.Label(row, text="?", bg=THEME["bg_secondary"],
                         fg=THEME["text_muted"], font=(FONT_UI, 9, "bold"),
                         padx=10, cursor="question_arrow",
                         highlightthickness=1, highlightbackground=THEME["border"],
                         width=2)
            q.pack(side=tk.RIGHT, padx=(0, 8), pady=4)
            Tooltip(q, help_text)
            def hover_in(_e=None, r=row, l=lbl): (r.configure(bg=THEME["bg_hover"]),
                                                   l.configure(bg=THEME["bg_hover"]))
            def hover_out(_e=None, r=row, l=lbl): (r.configure(bg=THEME["bg_secondary"]),
                                                    l.configure(bg=THEME["bg_secondary"]))
            def pick(_e=None, lb=label):
                self.var.set(lb)
                self._close_popup()
                return "break"
            for wid in (row, lbl):
                wid.bind("<Button-1>", pick)
                wid.bind("<Enter>", hover_in)
                wid.bind("<Leave>", hover_out)

        top.bind("<Escape>", lambda _e: self._close_popup())

    def _close_popup(self):
        top = getattr(self, "_popup", None)
        if top is None:
            return
        try:
            self.winfo_toplevel().unbind("<Button-1>", self._global_bind)
        except Exception:
            pass
        try:
            top.destroy()
        except Exception:
            pass
        self._popup = None


# ============================================================================
# Aplicação
# ============================================================================
class SenhaBaixaApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title(APP_NAME)
        self.root.geometry("1500x900")
        self.root.minsize(1200, 720)
        self.root.configure(bg=THEME["bg_primary"])

        self.clients: Dict[str, "TelegramClient"] = {}
        self.account_info: Dict[str, Dict] = {}
        self.current_client_id: Optional[str] = None
        self.monitoring_active = False
        self.multi_monitoring_active = False
        self.loop = None
        self.thread_loop = None
        self.group_map: Dict[str, str] = {}     # id -> name (para cliente atual)
        self._group_photos: Dict[str, str] = {} # id -> path
        self.multi_cards: List[Dict] = []

        self._setup_styles()
        self._setup_layout()
        self._start_event_loop()
        self._auto_reconnect()
        _start_brasilia_sync_thread()
        # tenta setar o ícone da janela (não a pena default do Tk)
        try:
            self._apply_window_icon()
        except Exception:
            pass

    def _apply_window_icon(self):
        """Usa um PNG local (se existir) ou um ícone gerado (bolinha âmbar)."""
        if Image is None or ImageTk is None:
            return
        # tenta arquivo na mesma pasta do script
        here = os.path.dirname(os.path.abspath(__file__))
        for name in ("senha-baixa-logo.png", "logo.png", "senhabaixa.png"):
            p = os.path.join(here, name)
            if os.path.exists(p):
                try:
                    img = Image.open(p).convert("RGBA").resize((64, 64))
                    self._icon_photo = ImageTk.PhotoImage(img)
                    self.root.iconphoto(True, self._icon_photo)
                    return
                except Exception:
                    pass
        # fallback: gera um ícone circular âmbar com 'S'
        try:
            size = 64
            img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            d = ImageDraw.Draw(img)
            d.ellipse((0, 0, size, size), fill=(20, 20, 20, 255))
            d.ellipse((6, 6, size - 6, size - 6), fill=(217, 119, 87, 255))
            try:
                from PIL import ImageFont
                font = ImageFont.truetype("segoeui.ttf", 34)
            except Exception:
                font = None
            letter = "S"
            if font:
                bbox = d.textbbox((0, 0), letter, font=font)
                tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
                d.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]),
                       letter, fill=(20, 20, 20, 255), font=font)
            self._icon_photo = ImageTk.PhotoImage(img)
            self.root.iconphoto(True, self._icon_photo)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Styles
    # ------------------------------------------------------------------
    def _setup_styles(self):
        s = ttk.Style()
        s.theme_use("clam")

        BG   = THEME["bg_primary"]
        CARD = THEME["bg_secondary"]
        FIELD= THEME["bg_tertiary"]
        BRD  = THEME["border"]
        TXT  = THEME["text_primary"]
        MUT  = THEME["text_secondary"]
        ACC  = THEME["accent"]

        s.configure("App.TFrame", background=BG)
        s.configure("Card.TFrame", background=CARD, relief="flat",
                    bordercolor=BRD, lightcolor=BRD, darkcolor=BRD, borderwidth=1)
        s.configure("Sidebar.TFrame", background=CARD, borderwidth=0)
        s.configure("Header.TFrame", background=BG, borderwidth=0)

        # Botões
        s.configure("Accent.TButton", background=ACC, foreground="#FFFFFF",
                    bordercolor=ACC, lightcolor=ACC, darkcolor=ACC,
                    borderwidth=0, focuscolor="none",
                    padding=(18, 11), font=(FONT_UI, 10, "bold"))
        s.map("Accent.TButton",
              background=[("active", THEME["accent_hover"]), ("pressed", THEME["accent_hover"])],
              foreground=[("disabled", THEME["text_muted"])])

        s.configure("Secondary.TButton", background=CARD, foreground=TXT,
                    bordercolor=BRD, lightcolor=BRD, darkcolor=BRD,
                    borderwidth=1, focuscolor="none",
                    padding=(14, 8), font=(FONT_UI, 9))
        s.map("Secondary.TButton",
              background=[("active", THEME["bg_hover"])],
              bordercolor=[("active", MUT)])

        s.configure("Ghost.TButton", background=BG, foreground=MUT,
                    bordercolor=BG, lightcolor=BG, darkcolor=BG,
                    borderwidth=0, focuscolor="none",
                    padding=(12, 8), font=(FONT_UI, 10))
        s.map("Ghost.TButton",
              background=[("active", CARD)], foreground=[("active", TXT)])

        s.configure("Nav.TButton", background=CARD, foreground=MUT,
                    bordercolor=CARD, lightcolor=CARD, darkcolor=CARD,
                    borderwidth=0, focuscolor="none",
                    padding=(16, 12), font=(FONT_UI, 10),
                    anchor="w")
        s.map("Nav.TButton",
              background=[("active", THEME["bg_tertiary"])],
              foreground=[("active", TXT)])
        s.configure("NavActive.TButton", background=THEME["bg_tertiary"], foreground=TXT,
                    bordercolor=THEME["bg_tertiary"], lightcolor=THEME["bg_tertiary"],
                    darkcolor=THEME["bg_tertiary"], borderwidth=0, focuscolor="none",
                    padding=(16, 12), font=(FONT_UI, 10, "bold"), anchor="w")
        s.map("NavActive.TButton", background=[("active", THEME["bg_tertiary"])])

        s.configure("Danger.TButton", background=CARD, foreground=THEME["error"],
                    bordercolor=THEME["error"], lightcolor=THEME["error"],
                    darkcolor=THEME["error"], borderwidth=1, focuscolor="none",
                    padding=(14, 8), font=(FONT_UI, 9, "bold"))
        s.map("Danger.TButton",
              background=[("active", THEME["error"])],
              foreground=[("active", "#FFFFFF")])

        # Labels
        for name, opts in {
            "H1":    {"bg": BG,   "fg": TXT, "font": (FONT_TITLE, 22)},
            "H2":    {"bg": CARD, "fg": TXT, "font": (FONT_TITLE, 15)},
            "Body":  {"bg": CARD, "fg": TXT, "font": (FONT_UI, 10)},
            "Small": {"bg": CARD, "fg": MUT, "font": (FONT_UI, 9)},
            "Muted": {"bg": BG,   "fg": MUT, "font": (FONT_UI, 9)},
            "AppSmall": {"bg": BG, "fg": MUT, "font": (FONT_UI, 9)},
        }.items():
            s.configure(f"{name}.TLabel", background=opts["bg"], foreground=opts["fg"], font=opts["font"])

        # Entradas
        s.configure("TEntry", fieldbackground=FIELD, foreground=TXT,
                    bordercolor=BRD, lightcolor=BRD, darkcolor=BRD,
                    insertcolor=TXT, borderwidth=1, padding=8,
                    font=(FONT_UI, 10))
        s.map("TEntry", bordercolor=[("focus", ACC)], lightcolor=[("focus", ACC)])

        s.configure("Dark.TCombobox", fieldbackground=FIELD, foreground=TXT,
                    background=FIELD, bordercolor=BRD, arrowcolor=TXT,
                    borderwidth=1, padding=6)
        s.map("Dark.TCombobox",
              fieldbackground=[("readonly", FIELD)],
              foreground=[("readonly", TXT)],
              bordercolor=[("focus", ACC)])

        s.configure("TCheckbutton", background=CARD, foreground=TXT,
                    focuscolor="none", font=(FONT_UI, 10))
        s.map("TCheckbutton",
              background=[("active", CARD)],
              indicatorcolor=[("selected", ACC), ("!selected", FIELD)])

        s.configure("TSeparator", background=BRD)

        s.configure("Vertical.TScrollbar", background=BG, troughcolor=BG,
                    bordercolor=BG, arrowcolor=MUT, gripcount=0, borderwidth=0)
        s.map("Vertical.TScrollbar", background=[("active", THEME["bg_hover"])])

        s.configure("Treeview", background=CARD, foreground=TXT,
                    fieldbackground=CARD, bordercolor=BRD, lightcolor=BRD,
                    borderwidth=0, font=(FONT_UI, 10), rowheight=36)
        s.map("Treeview",
              background=[("selected", THEME["bg_active"])],
              foreground=[("selected", TXT)])
        s.configure("Treeview.Heading", background=BG, foreground=MUT,
                    relief="flat", bordercolor=BRD, padding=(10, 8),
                    font=(FONT_UI, 9, "bold"))
        s.map("Treeview.Heading", background=[("active", THEME["bg_tertiary"])])

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------
    def _setup_layout(self):
        self._setup_header()

        content = tk.Frame(self.root, bg=THEME["bg_primary"])
        content.pack(fill=tk.BOTH, expand=True, padx=18, pady=(4, 18))

        self._setup_sidebar(content)

        self.main_area = tk.Frame(content, bg=THEME["bg_primary"])
        self.main_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(18, 0))

        self.views = {}
        self._setup_unique_view()
        self._setup_multi_view()
        self._setup_register_view()
        self.show_view("unique")

    def _setup_header(self):
        header = tk.Frame(self.root, bg=THEME["bg_primary"])
        header.pack(fill=tk.X, padx=18, pady=(14, 6))

        left = tk.Frame(header, bg=THEME["bg_primary"])
        left.pack(side=tk.LEFT)
        tk.Label(left, text="●", bg=THEME["bg_primary"], fg=THEME["accent"],
                 font=(FONT_UI, 14)).pack(side=tk.LEFT, padx=(0, 8))
        tk.Label(left, text=APP_NAME, bg=THEME["bg_primary"],
                 fg=THEME["text_primary"], font=(FONT_TITLE, 20)).pack(side=tk.LEFT)

        self.status_pill = Pill(header, text="Desconectado", tone="error")
        self.status_pill.pack(side=tk.RIGHT)

        sep = tk.Frame(self.root, bg=THEME["border_soft"], height=1)
        sep.pack(fill=tk.X, padx=0)

    def _setup_sidebar(self, parent):
        sidebar = tk.Frame(parent, bg=THEME["bg_secondary"], width=200,
                           highlightthickness=1, highlightbackground=THEME["border"])
        sidebar.pack(side=tk.LEFT, fill=tk.Y)
        sidebar.pack_propagate(False)

        tk.Label(sidebar, text="NAVEGAÇÃO", bg=THEME["bg_secondary"],
                 fg=THEME["text_muted"], font=(FONT_UI, 9, "bold")).pack(anchor=tk.W, padx=16, pady=(16, 8))

        nav_items = [
            ("Atendimento único", "unique",  "◐"),
            ("Atendimento multi", "multi",   "◍"),
            ("Novo cliente",       "register","＋"),
        ]
        self.nav_buttons: Dict[str, tk.Frame] = {}
        for label, key, ic in nav_items:
            self._make_nav_item(sidebar, key, label, ic)

        tk.Frame(sidebar, bg=THEME["border_soft"], height=1).pack(fill=tk.X, padx=16, pady=14)

        tk.Label(sidebar, text="CONTAS ATIVAS", bg=THEME["bg_secondary"],
                 fg=THEME["text_muted"], font=(FONT_UI, 9, "bold")).pack(anchor=tk.W, padx=16, pady=(0, 8))
        self.accounts_frame = tk.Frame(sidebar, bg=THEME["bg_secondary"])
        self.accounts_frame.pack(fill=tk.X, padx=16)

    def _make_nav_item(self, parent, key, label, icon):
        row = tk.Frame(parent, bg=THEME["bg_secondary"], cursor="hand2")
        row.pack(fill=tk.X, padx=8, pady=2)
        bar = tk.Frame(row, bg=THEME["bg_secondary"], width=3)
        bar.pack(side=tk.LEFT, fill=tk.Y)
        icon_lbl = tk.Label(row, text=icon, bg=THEME["bg_secondary"],
                            fg=THEME["text_muted"], font=(FONT_UI, 12))
        icon_lbl.pack(side=tk.LEFT, padx=(10, 10), pady=10)
        name_lbl = tk.Label(row, text=label, bg=THEME["bg_secondary"],
                            fg=THEME["text_secondary"], font=(FONT_UI, 10), anchor="w")
        name_lbl.pack(side=tk.LEFT, fill=tk.X, expand=True, pady=10)
        widgets = [row, icon_lbl, name_lbl]
        def go(_e=None, k=key): self.show_view(k)
        def enter(_e=None):
            if self.views.get(key) is None or getattr(self, "_active_view", None) != key:
                for w in widgets: w.configure(bg=THEME["bg_tertiary"])
        def leave(_e=None):
            if getattr(self, "_active_view", None) != key:
                for w in widgets: w.configure(bg=THEME["bg_secondary"])
        for w in widgets:
            w.bind("<Button-1>", go)
            w.bind("<Enter>", enter)
            w.bind("<Leave>", leave)
        self.nav_buttons[key] = {"row": row, "bar": bar, "icon": icon_lbl, "name": name_lbl}

    def _refresh_nav(self, active_key):
        self._active_view = active_key
        for k, item in self.nav_buttons.items():
            is_active = (k == active_key)
            bg = THEME["bg_active"] if is_active else THEME["bg_secondary"]
            for w in ("row", "icon", "name"):
                item[w].configure(bg=bg)
            item["icon"].configure(fg=THEME["accent"] if is_active else THEME["text_muted"])
            item["name"].configure(fg=THEME["text_primary"] if is_active else THEME["text_secondary"],
                                   font=(FONT_UI, 10, "bold") if is_active else (FONT_UI, 10))
            item["bar"].configure(bg=THEME["accent"] if is_active else THEME["bg_secondary"])

    # ------------------------------------------------------------------
    # View: Atendimento Único
    # ------------------------------------------------------------------
    def _setup_unique_view(self):
        view = tk.Frame(self.main_area, bg=THEME["bg_primary"])
        self.views["unique"] = view

        # topo — título + status pill separado do botão
        top = tk.Frame(view, bg=THEME["bg_primary"])
        top.pack(fill=tk.X, pady=(4, 14))
        tk.Label(top, text="Atendimento único", bg=THEME["bg_primary"],
                 fg=THEME["text_primary"], font=(FONT_TITLE, 18)).pack(side=tk.LEFT)
        tk.Label(top, text="Selecione um cliente, escolha um grupo e monitore em tempo real",
                 bg=THEME["bg_primary"], fg=THEME["text_muted"],
                 font=(FONT_UI, 10)).pack(side=tk.LEFT, padx=(14, 0), pady=(4, 0))

        self.monitor_pill = Pill(top, "Parado", "muted")
        self.monitor_pill.pack(side=tk.RIGHT)
        self.unique_clock = tk.Label(top, text="⏱ --:--:--  Brasília",
                                     bg=THEME["bg_primary"], fg=THEME["text_muted"],
                                     font=(FONT_UI, 10))
        self.unique_clock.pack(side=tk.RIGHT, padx=(0, 14))
        self._start_brasilia_clock(self.unique_clock)

        # corpo em 3 colunas: clientes | grupos | painel
        body = tk.Frame(view, bg=THEME["bg_primary"])
        body.pack(fill=tk.BOTH, expand=True)

        # coluna 1 — clientes
        col_clients = tk.Frame(body, bg=THEME["bg_secondary"], width=280,
                               highlightthickness=1, highlightbackground=THEME["border"])
        col_clients.pack(side=tk.LEFT, fill=tk.Y, padx=(0, 12))
        col_clients.pack_propagate(False)
        tk.Label(col_clients, text="CLIENTES", bg=THEME["bg_secondary"],
                 fg=THEME["text_muted"], font=(FONT_UI, 9, "bold")).pack(anchor=tk.W, padx=14, pady=(12, 8))

        tree_wrap = tk.Frame(col_clients, bg=THEME["bg_secondary"])
        tree_wrap.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 12))
        self.client_tree = ttk.Treeview(tree_wrap,
                                        columns=("cliente",),
                                        show="headings", height=22)
        self.client_tree.heading("cliente", text="Cliente")
        self.client_tree.column("cliente", width=250, anchor="w")
        vsb = ttk.Scrollbar(tree_wrap, orient="vertical", command=self.client_tree.yview)
        self.client_tree.configure(yscrollcommand=vsb.set)
        self.client_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        # scrollbar invisível — mantém funcional via wheel
        # vsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.client_tree.bind("<<TreeviewSelect>>", self._on_client_select)

        # Botão remover cliente — agora fica na barra de clientes
        remove_row = tk.Frame(col_clients, bg=THEME["bg_secondary"])
        remove_row.pack(fill=tk.X, padx=12, pady=(0, 12))
        RoundedButton(remove_row, text="Remover cliente", variant="danger",
                      command=self._remove_client).pack(fill=tk.X)

        # coluna 2 — lista de grupos com foto
        self.group_list = GroupListPanel(body, mode="single",
                                         on_select=self._on_group_selected_from_list,
                                         height=520)
        self.group_list.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 12))

        # coluna 3 — painel
        col_panel = tk.Frame(body, bg=THEME["bg_secondary"], width=340,
                             highlightthickness=1, highlightbackground=THEME["border"])
        col_panel.pack(side=tk.LEFT, fill=tk.Y)
        col_panel.pack_propagate(False)
        self.panel_frame = col_panel

        # placeholder (nenhum cliente selecionado)
        self.panel_placeholder = tk.Frame(col_panel, bg=THEME["bg_secondary"])
        tk.Label(self.panel_placeholder, text="◐", bg=THEME["bg_secondary"],
                 fg=THEME["accent"], font=(FONT_UI, 40)).pack(pady=(80, 12))
        tk.Label(self.panel_placeholder, text="Painel de controle",
                 bg=THEME["bg_secondary"], fg=THEME["text_primary"],
                 font=(FONT_TITLE, 13)).pack()
        tk.Label(self.panel_placeholder,
                 text="Selecione um cliente à esquerda\npara configurar o envio.",
                 bg=THEME["bg_secondary"], fg=THEME["text_muted"],
                 font=(FONT_UI, 9), justify="center").pack(pady=(6, 0))
        self.panel_placeholder.pack(fill=tk.BOTH, expand=True)

        # conteúdo real (montado quando um cliente é selecionado)
        self.panel_content = tk.Frame(col_panel, bg=THEME["bg_secondary"])

        tk.Label(self.panel_content, text="PAINEL DE CONTROLE", bg=THEME["bg_secondary"],
                 fg=THEME["text_muted"], font=(FONT_UI, 9, "bold")).pack(anchor=tk.W, padx=16, pady=(14, 10))

        self.client_name_var = tk.StringVar(value="Nenhum selecionado")
        self._panel_field(self.panel_content, "Cliente", self.client_name_var)

        self.selected_group_var = tk.StringVar(value="—")
        self._panel_field(self.panel_content, "Grupo", self.selected_group_var)

        # método (label + '?')
        method_row = tk.Frame(self.panel_content, bg=THEME["bg_secondary"])
        method_row.pack(fill=tk.X, padx=16, pady=(10, 2))
        tk.Label(method_row, text="Método de envio", bg=THEME["bg_secondary"],
                 fg=THEME["text_secondary"], font=(FONT_UI, 9)).pack(side=tk.LEFT)

        self.method_var = tk.StringVar(value=METHOD_LABELS["abertura"])
        MethodPicker(self.panel_content, self.method_var).pack(fill=tk.X, padx=16, pady=(0, 8))

        # horário só é editado internamente quando o método é 'abertura2'
        self.schedule_var = tk.StringVar(value="00:00")

        tk.Label(self.panel_content, text="Mensagem", bg=THEME["bg_secondary"],
                 fg=THEME["text_secondary"], font=(FONT_UI, 9)).pack(anchor=tk.W, padx=16, pady=(6, 4))
        self.msg_var = tk.StringVar()
        RoundedEntry(self.panel_content, textvariable=self.msg_var,
                     bg=THEME["bg_secondary"]).pack(fill=tk.X, padx=16, pady=(0, 12))

        actions = tk.Frame(self.panel_content, bg=THEME["bg_secondary"])
        actions.pack(fill=tk.X, padx=16, pady=(4, 0))
        RoundedButton(actions, text="Salvar", variant="secondary",
                      command=self._save_client).pack(side=tk.LEFT, padx=(0, 8))
        # horário só aparece se método = Grupo aberto 2
        self.schedule_frame = tk.Frame(self.panel_content, bg=THEME["bg_secondary"])
        tk.Label(self.schedule_frame, text="Horário HH:MM",
                 bg=THEME["bg_secondary"], fg=THEME["text_secondary"],
                 font=(FONT_UI, 9)).pack(anchor=tk.W)
        RoundedEntry(self.schedule_frame, textvariable=self.schedule_var,
                     bg=THEME["bg_secondary"]).pack(fill=tk.X, pady=(4, 0))
        def _on_method_change(*_):
            if self.method_var.get() == METHOD_LABELS["abertura2"]:
                self.schedule_frame.pack(fill=tk.X, padx=16, pady=(6, 0),
                                         before=self.btn_monitor if hasattr(self, "btn_monitor") else None)
            else:
                self.schedule_frame.pack_forget()
        self.method_var.trace_add("write", _on_method_change)

        tk.Frame(self.panel_content, bg=THEME["border_soft"], height=1).pack(fill=tk.X, padx=16, pady=18)
        self.btn_monitor = RoundedButton(self.panel_content, text="▶  Iniciar monitoramento",
                                         variant="accent", height=42,
                                         command=self._start_monitoring)
        self.btn_monitor.pack(fill=tk.X, padx=16)
        
        # Monitorar mudanças na mensagem para desabilitar o botão se vazio
        def _on_msg_change(*_):
            msg = self.msg_var.get().strip()
            if msg:
                self.btn_monitor.set_enabled(True)
            else:
                self.btn_monitor.set_enabled(False)
        self.msg_var.trace_add("write", _on_msg_change)
        _on_msg_change()  # verificar estado inicial

        # LOG ÚNICO — ancorado no rodapé do painel com altura fixa, para que
        # NENHUM outro conteúdo (ex.: schedule_frame ao selecionar 'Grupo aberto 2')
        # possa empurrá-lo para fora da área visível.
        log_wrap = tk.Frame(self.panel_content, bg=THEME["bg_secondary"],
                            height=200)
        log_wrap.pack(side=tk.BOTTOM, fill=tk.X, padx=16, pady=(14, 12))
        log_wrap.pack_propagate(False)
        tk.Label(log_wrap, text="LOG ÚNICO", bg=THEME["bg_secondary"],
                 fg=THEME["text_muted"], font=(FONT_UI, 9, "bold")).pack(anchor=tk.W)
        self.log_text = LogViewer(log_wrap, height=8)
        self.log_text.pack(fill=tk.BOTH, expand=True, pady=(6, 0))

        self._load_clients()

    def _panel_field(self, parent, label, var):
        tk.Label(parent, text=label, bg=THEME["bg_secondary"],
                 fg=THEME["text_secondary"], font=(FONT_UI, 9)).pack(anchor=tk.W, padx=16, pady=(2, 2))
        val = tk.Label(parent, textvariable=var, bg=THEME["bg_tertiary"],
                       fg=THEME["text_primary"], font=(FONT_UI, 10),
                       anchor="w", padx=10, pady=8)
        val.pack(fill=tk.X, padx=16, pady=(0, 4))

    # ------------------------------------------------------------------
    # View: Atendimento Multi
    # ------------------------------------------------------------------
    def _setup_multi_view(self):
        view = tk.Frame(self.main_area, bg=THEME["bg_primary"])
        self.views["multi"] = view

        top = tk.Frame(view, bg=THEME["bg_primary"])
        top.pack(fill=tk.X, pady=(4, 14))
        tk.Label(top, text="Atendimento multi", bg=THEME["bg_primary"],
                 fg=THEME["text_primary"], font=(FONT_TITLE, 18)).pack(side=tk.LEFT)
        tk.Label(top, text="Escolha as contas, defina o método e monitore em lote",
                 bg=THEME["bg_primary"], fg=THEME["text_muted"],
                 font=(FONT_UI, 10)).pack(side=tk.LEFT, padx=(14, 0), pady=(4, 0))

        self.multi_pill = Pill(top, "Parado", "muted")
        self.multi_pill.pack(side=tk.RIGHT)
        self.multi_clock = tk.Label(top, text="⏱ --:--:--  Brasília",
                                    bg=THEME["bg_primary"], fg=THEME["text_muted"],
                                    font=(FONT_UI, 10))
        self.multi_clock.pack(side=tk.RIGHT, padx=(0, 14))
        self._start_brasilia_clock(self.multi_clock)
        self.btn_multi_monitor = RoundedButton(top, text="▶  Iniciar lote",
                                               variant="accent",
                                               command=self._start_multi_monitoring)
        self.btn_multi_monitor.pack(side=tk.RIGHT, padx=(0, 12))
        RoundedButton(top, text="Limpar logs", variant="secondary",
                      command=self._clear_multi_logs).pack(side=tk.RIGHT, padx=(0, 8))

        # toolbar de seleção
        tools = tk.Frame(view, bg=THEME["bg_primary"])
        tools.pack(fill=tk.X, pady=(0, 8))
        RoundedButton(tools, text="Selecionar todos", variant="ghost",
                      command=self._multi_select_all).pack(side=tk.LEFT, padx=(0, 6))
        RoundedButton(tools, text="Limpar seleção", variant="ghost",
                      command=self._multi_select_none).pack(side=tk.LEFT)
        self.multi_selected_count = tk.StringVar(value="0 selecionadas")
        tk.Label(tools, textvariable=self.multi_selected_count,
                 bg=THEME["bg_primary"], fg=THEME["text_muted"],
                 font=(FONT_UI, 9)).pack(side=tk.RIGHT)

        # cards de contas — rolável
        cards_wrap = tk.Frame(view, bg=THEME["bg_secondary"],
                              highlightthickness=1, highlightbackground=THEME["border"])
        cards_wrap.pack(fill=tk.BOTH, expand=True)
        tk.Label(cards_wrap, text="CONTAS DISPONÍVEIS", bg=THEME["bg_secondary"],
                 fg=THEME["text_muted"], font=(FONT_UI, 9, "bold")).pack(anchor=tk.W, padx=16, pady=(14, 8))

        scroll_holder = tk.Frame(cards_wrap, bg=THEME["bg_secondary"])
        scroll_holder.pack(fill=tk.BOTH, expand=True, padx=12, pady=(0, 12))
        self._multi_canvas = tk.Canvas(scroll_holder, bg=THEME["bg_secondary"],
                                       highlightthickness=0, borderwidth=0)
        vsb = ttk.Scrollbar(scroll_holder, orient="vertical", command=self._multi_canvas.yview)
        self._multi_canvas.configure(yscrollcommand=vsb.set)
        self._multi_canvas.pack(side="left", fill="both", expand=True)
        # scrollbar invisível
        # vsb.pack(side="right", fill="y")
        self.multi_cards_container = tk.Frame(self._multi_canvas, bg=THEME["bg_secondary"])
        self._multi_win = self._multi_canvas.create_window((0, 0), window=self.multi_cards_container, anchor="nw")
        self.multi_cards_container.bind(
            "<Configure>",
            lambda e: self._multi_canvas.configure(scrollregion=self._multi_canvas.bbox("all")))
        self._multi_canvas.bind(
            "<Configure>",
            lambda e: self._multi_canvas.itemconfig(self._multi_win, width=e.width))
        def _mw(event):
            if event.num == 5 or getattr(event, "delta", 0) < 0:
                self._multi_canvas.yview_scroll(2, "units")
            elif event.num == 4 or getattr(event, "delta", 0) > 0:
                self._multi_canvas.yview_scroll(-2, "units")
            return "break"
        for w in (self._multi_canvas, self.multi_cards_container):
            w.bind("<MouseWheel>", _mw)
            w.bind("<Button-4>", _mw)
            w.bind("<Button-5>", _mw)
        self._multi_wheel_bind = _mw

        self.multi_cards: List[Dict] = []
        self._multi_selected: set = set()   # client_ids marcados

        # log
        log_wrap = tk.Frame(view, bg=THEME["bg_primary"])
        log_wrap.pack(fill=tk.X, pady=(14, 0))
        tk.Label(log_wrap, text="LOG MULTI", bg=THEME["bg_primary"],
                 fg=THEME["text_muted"], font=(FONT_UI, 9, "bold")).pack(anchor=tk.W)
        self.multi_log = LogViewer(log_wrap, height=6)
        self.multi_log.pack(fill=tk.BOTH, expand=True, pady=(6, 0))

        self._update_multi_display()

    def _create_multi_card(self, parent, idx, client_id, account_id, info):
        card = tk.Frame(parent, bg=THEME["bg_tertiary"],
                        highlightthickness=1, highlightbackground=THEME["border_soft"])
        card.pack(fill=tk.X, padx=4, pady=6)

        row = tk.Frame(card, bg=THEME["bg_tertiary"])
        row.pack(fill=tk.X, padx=14, pady=12)

        # checkbox de seleção (custom, sem ttk pra combinar visual)
        check_var = tk.BooleanVar(value=(client_id in self._multi_selected))
        check_lbl = tk.Label(row, text=("☑" if check_var.get() else "☐"),
                             bg=THEME["bg_tertiary"],
                             fg=(THEME["accent"] if check_var.get() else THEME["text_muted"]),
                             font=(FONT_UI, 15), cursor="hand2")
        check_lbl.pack(side=tk.LEFT, padx=(0, 12))
        def toggle(_e=None):
            v = not check_var.get()
            check_var.set(v)
            if v: self._multi_selected.add(client_id)
            else: self._multi_selected.discard(client_id)
            check_lbl.configure(text=("☑" if v else "☐"),
                                fg=(THEME["accent"] if v else THEME["text_muted"]))
            self._refresh_selected_count()
        check_lbl.bind("<Button-1>", toggle)

        # info
        info_col = tk.Frame(row, bg=THEME["bg_tertiary"])
        info_col.pack(side=tk.LEFT, fill=tk.X, expand=True)
        tk.Label(info_col, text=info.get("nome", "Sem cliente"),
                 bg=THEME["bg_tertiary"], fg=THEME["text_primary"],
                 font=(FONT_UI, 11, "bold"), anchor="w").pack(fill=tk.X)
        group_var = tk.StringVar(value=info.get("group_name") or "Sem grupo definido")
        tk.Label(info_col, textvariable=group_var,
                 bg=THEME["bg_tertiary"], fg=THEME["text_secondary"],
                 font=(FONT_UI, 9), anchor="w").pack(fill=tk.X, pady=(2, 0))
        msg_preview = (info.get("mensagem") or "— sem rascunho —").strip()
        if len(msg_preview) > 90: msg_preview = msg_preview[:87] + "…"
        msg_var = tk.StringVar(value=f"Rascunho: {msg_preview}")
        tk.Label(info_col, textvariable=msg_var,
                 bg=THEME["bg_tertiary"], fg=THEME["text_muted"],
                 font=(FONT_UI, 9), anchor="w",
                 wraplength=520, justify="left").pack(fill=tk.X, pady=(2, 0))

        # coluna: método + ações
        right = tk.Frame(row, bg=THEME["bg_tertiary"])
        right.pack(side=tk.RIGHT, padx=(12, 0))

        method_row = tk.Frame(right, bg=THEME["bg_tertiary"])
        method_row.pack(anchor="e")
        tk.Label(method_row, text="Método", bg=THEME["bg_tertiary"],
                 fg=THEME["text_secondary"], font=(FONT_UI, 8)).pack(side=tk.LEFT)

        method_var = tk.StringVar(value=METHOD_LABELS.get(info.get("metodo", "abertura"),
                                                          METHOD_LABELS["abertura"]))
        picker = MethodPicker(right, method_var)
        picker.configure(bg=THEME["bg_tertiary"])
        picker._btn_wrap.configure(bg=THEME["bg_tertiary"])
        picker._lbl.configure(bg=THEME["bg_tertiary"])
        picker._arrow.configure(bg=THEME["bg_tertiary"])
        picker.pack(anchor="e", pady=(2, 6))
        def on_method_change(*_):
            cfg = self._load_config()
            row_info = cfg.get("grupos", {}).get(client_id)
            if row_info:
                label = method_var.get()
                row_info["metodo"] = next(
                    (k for k, v in METHOD_LABELS.items() if v == label), "abertura")
                self._save_config(cfg)
        method_var.trace_add("write", on_method_change)

        btns = tk.Frame(right, bg=THEME["bg_tertiary"])
        btns.pack(anchor="e")
        RoundedButton(btns, text="Rascunho", variant="secondary",
                      command=lambda: self._edit_multi_message(client_id)).pack(side=tk.LEFT, padx=(0, 6))
        RoundedButton(btns, text="Grupo", variant="secondary",
                      command=lambda: self._edit_multi_group(client_id)).pack(side=tk.LEFT)

        # pílula de status embaixo
        bar = tk.Frame(card, bg=THEME["bg_tertiary"])
        bar.pack(fill=tk.X, padx=14, pady=(0, 10))
        card_pill = Pill(bar, "Aguardando", "muted")
        card_pill.pack(side=tk.LEFT)
        # detalhe interno (usado no log/status) — sem label duplicada na UI
        detail_var = tk.StringVar(value="Aguardando")

        # propaga scroll dentro do card — recursivamente em TODOS os widgets filhos,
        # incluindo labels, botões, MethodPicker interno, checkbox, etc.
        self._bind_wheel_recursive(card)

        self.multi_cards.append({
            "card": card, "pill": card_pill,
            "client_id": client_id, "account_id": account_id,
            "group_var": group_var, "msg_var": msg_var,
            "method_var": method_var, "combo": picker,
            "detail_status": detail_var,
            "entity": None, "monitoring": False, "completed": False,
        })

    def _bind_wheel_recursive(self, widget):
        """Bind mousewheel handler em widget e em todos os descendentes."""
        try:
            widget.bind("<MouseWheel>", self._multi_wheel_bind, add="+")
            widget.bind("<Button-4>",   self._multi_wheel_bind, add="+")
            widget.bind("<Button-5>",   self._multi_wheel_bind, add="+")
        except Exception:
            pass
        for child in widget.winfo_children():
            self._bind_wheel_recursive(child)

    def _refresh_selected_count(self):
        n = len(self._multi_selected)
        self.multi_selected_count.set(f"{n} selecionada{'s' if n != 1 else ''}")

    def _multi_select_all(self):
        for c in self.multi_cards:
            self._multi_selected.add(c["client_id"])
        self._update_multi_display()

    def _multi_select_none(self):
        self._multi_selected.clear()
        self._update_multi_display()

    def _clear_multi_logs(self):
        # LogViewer é state='disabled' — habilita, apaga, desabilita.
        for attr in ("multi_log", "log_text"):
            w = getattr(self, attr, None)
            if w is not None and w.winfo_exists():
                try:
                    w.config(state="normal")
                    w.delete("1.0", tk.END)
                    w.config(state="disabled")
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # View: Novo Cliente
    # ------------------------------------------------------------------
    def _setup_register_view(self):
        outer = ScrollFrame(self.main_area, bg=THEME["bg_primary"])
        self.views["register"] = outer
        view = outer.inner
        view.configure(style="App.TFrame")

        tk.Label(view, text="Novo cliente", bg=THEME["bg_primary"],
                 fg=THEME["text_primary"], font=(FONT_TITLE, 18)).pack(anchor=tk.W, pady=(4, 0))
        tk.Label(view, text="Cadastre uma nova conta Telegram no console",
                 bg=THEME["bg_primary"], fg=THEME["text_muted"],
                 font=(FONT_UI, 10)).pack(anchor=tk.W, pady=(4, 16))

        card = tk.Frame(view, bg=THEME["bg_secondary"],
                        highlightthickness=1, highlightbackground=THEME["border"])
        card.pack(fill=tk.X, pady=(0, 12))

        form = tk.Frame(card, bg=THEME["bg_secondary"])
        form.pack(fill=tk.X, padx=22, pady=22)

        self.register_vars = {}
        # Nome
        tk.Label(form, text="Nome do cliente", bg=THEME["bg_secondary"],
                 fg=THEME["text_secondary"], font=(FONT_UI, 9)).pack(anchor=tk.W, pady=(10, 4))
        self.register_vars["name_var"] = tk.StringVar()
        self.name_entry = RoundedEntry(form, textvariable=self.register_vars["name_var"],
                     bg=THEME["bg_secondary"])
        self.name_entry.pack(fill=tk.X, pady=(0, 4))

        # Telefone
        tk.Label(form, text="Telefone (com DDI)", bg=THEME["bg_secondary"],
                 fg=THEME["text_secondary"], font=(FONT_UI, 9)).pack(anchor=tk.W, pady=(10, 4))
        self.register_vars["phone_var"] = tk.StringVar()  # legado — não usado
        self.phone_entry = PhoneEntry(form, bg=THEME["bg_secondary"])
        self.phone_entry.pack(fill=tk.X, pady=(0, 4))

        # Botão automação (estado A) — logo abaixo do telefone
        auto_row = tk.Frame(form, bg=THEME["bg_secondary"])
        auto_row.pack(fill=tk.X, pady=(10, 4))
        self.auto_row = auto_row
        self.auto_btn = RoundedButton(auto_row, text="⚡ Obter API automaticamente",
                                      variant="secondary", width=280,
                                      command=self._auto_fetch_api)
        self.auto_btn.pack(side=tk.LEFT)
        self.auto_hint = tk.Label(auto_row,
                                  text="Preencha o telefone acima e clique aqui",
                                  bg=THEME["bg_secondary"], fg=THEME["text_muted"],
                                  font=(FONT_UI, 8))
        self.auto_hint.pack(side=tk.LEFT, padx=(10, 0))

        # Estado B — input inline para o código do my.telegram.org
        # (mesmo pai da linha do botão automação; será packado imediatamente após,
        # e depois SUBSTITUÍDO pelo bloco do código de login do Telegram.)
        self.mt_code_frame = tk.Frame(form, bg=THEME["bg_secondary"])
        tk.Label(self.mt_code_frame,
                 text="Código recebido no Telegram (my.telegram.org)",
                 bg=THEME["bg_secondary"], fg=THEME["text_secondary"],
                 font=(FONT_UI, 9)).pack(anchor=tk.W, pady=(4, 4))
        self.mt_code_var = tk.StringVar()
        self.mt_code_entry = RoundedEntry(self.mt_code_frame,
                                          textvariable=self.mt_code_var,
                                          bg=THEME["bg_secondary"])
        self.mt_code_entry.pack(fill=tk.X, pady=(0, 8))
        self.mt_code_btn = RoundedButton(self.mt_code_frame,
                                         text="Confirmar código",
                                         variant="accent", width=200,
                                         command=self._mt_confirm_code_click)
        self.mt_code_btn.pack(anchor=tk.W)

        # Fallback manual (escondido por padrão) — API ID / API Hash
        self.manual_frame = tk.Frame(form, bg=THEME["bg_secondary"])
        tk.Label(self.manual_frame, text="API ID", bg=THEME["bg_secondary"],
                 fg=THEME["text_secondary"], font=(FONT_UI, 9)).pack(anchor=tk.W, pady=(10, 4))
        self.register_vars["api_id_var"] = tk.StringVar()
        RoundedEntry(self.manual_frame, textvariable=self.register_vars["api_id_var"],
                     bg=THEME["bg_secondary"]).pack(fill=tk.X, pady=(0, 4))
        tk.Label(self.manual_frame, text="API Hash", bg=THEME["bg_secondary"],
                 fg=THEME["text_secondary"], font=(FONT_UI, 9)).pack(anchor=tk.W, pady=(10, 4))
        self.register_vars["api_hash_var"] = tk.StringVar()
        RoundedEntry(self.manual_frame, textvariable=self.register_vars["api_hash_var"],
                     bg=THEME["bg_secondary"]).pack(fill=tk.X, pady=(0, 4))

        # legado — não exibidos na UI, mas mantidos para compat de config
        self.register_vars["opening_var"] = tk.StringVar(value="")
        self.weekday_vars = {d: tk.BooleanVar(value=True)
                             for d in ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"]}

        self.active_var = tk.BooleanVar(value=True)  # kept internally, sempre True

        self.register_error = tk.StringVar()
        tk.Label(form, textvariable=self.register_error, bg=THEME["bg_secondary"],
                 fg=THEME["error"], font=(FONT_UI, 9)).pack(anchor=tk.W, pady=(0, 6))

        # Botão "Cadastrar" — visível apenas no fluxo manual
        self.register_btn = RoundedButton(form, text="Cadastrar", variant="accent",
                                          height=42, width=180,
                                          command=self._register_client)
        # Toggle "Preencher manualmente"
        self.manual_toggle = tk.Label(form, text="Preencher API ID / Hash manualmente",
                                      bg=THEME["bg_secondary"], fg=THEME["accent"],
                                      font=(FONT_UI, 9, "underline"), cursor="hand2")
        self.manual_toggle.pack(anchor=tk.W, pady=(10, 2))
        self.manual_toggle.bind("<Button-1>", lambda _e: self._toggle_manual_mode())
        self._manual_mode = False

        # Estado E — código de login do Telegram (após enviar send_code_request)
        # É criado dentro do MESMO card (form) para SUBSTITUIR o bloco 'mt_code_frame'
        # no mesmo lugar (não jogar lá pra baixo depois dos dias de funcionamento).
        self.auth_frame = tk.Frame(form, bg=THEME["bg_secondary"])
        auth_inner = tk.Frame(self.auth_frame, bg=THEME["bg_secondary"])
        auth_inner.pack(fill=tk.X, pady=(4, 6))
        tk.Label(auth_inner,
                 text="Código de login enviado no seu Telegram (app)",
                 bg=THEME["bg_secondary"], fg=THEME["text_secondary"],
                 font=(FONT_UI, 9)).pack(anchor=tk.W, pady=(0, 4))
        self.auth_code = RoundedEntry(auth_inner, bg=THEME["bg_secondary"])
        self.auth_code.pack(fill=tk.X, pady=(0, 10))
        self.auth_btn = RoundedButton(auth_inner, text="Continuar",
                                      variant="accent", width=180,
                                      command=self._verify_auth)
        self.auth_btn.pack(anchor=tk.W)

        # o frame do form_form usado como âncora para os inputs inline
        self._register_form_parent = form

    def _toggle_manual_mode(self):
        self._manual_mode = not self._manual_mode
        if self._manual_mode:
            self.manual_frame.pack(fill=tk.X, pady=(4, 0), before=self.manual_toggle)
            self.register_btn.pack(anchor=tk.W, pady=(10, 0), before=self.manual_toggle)
            self.manual_toggle.configure(text="Voltar para automático")
        else:
            self.manual_frame.pack_forget()
            self.register_btn.pack_forget()
            self.manual_toggle.configure(text="Preencher API ID / Hash manualmente")

    # ------------------------------------------------------------------
    # Navegação
    # ------------------------------------------------------------------
    def show_view(self, name):
        for k, v in self.views.items():
            if k == name:
                v.pack(fill=tk.BOTH, expand=True)
                if k == "unique":
                    self._load_clients()
                elif k == "multi":
                    self._update_multi_display()
                elif k == "register":
                    # sempre entra num estado limpo — sem resíduo do cliente anterior
                    try:
                        self._clear_register_form()
                    except Exception:
                        pass
            else:
                v.pack_forget()
        self._refresh_nav(name)

    def _schedule_ui(self, callback, *args, **kwargs):
        if hasattr(self, "root") and self.root and self.root.winfo_exists():
            self.root.after(0, lambda: callback(*args, **kwargs))

    # ------------------------------------------------------------------
    # Relógio de Brasília (usado nos painéis Único e Multi)
    # ------------------------------------------------------------------
    def _brasilia_now_str(self) -> str:
        try:
            return _brasilia_now().strftime("%H:%M:%S")
        except Exception:
            return datetime.now().strftime("%H:%M:%S")

    def _start_brasilia_clock(self, label: tk.Label):
        def tick():
            try:
                if not label.winfo_exists():
                    return
                label.configure(text=f"⏱ {self._brasilia_now_str()}  Brasília")
                self.root.after(1000, tick)
            except Exception:
                pass
        tick()

    def _log(self, msg, tag="info"):
        if hasattr(self, "log_text"):
            self._schedule_ui(self._append_log, msg, tag, self.log_text)

    def _log_multi(self, msg, tag="info"):
        if hasattr(self, "multi_log"):
            self._schedule_ui(self._append_log, msg, tag, self.multi_log)

    def _append_log(self, msg, tag, target):
        if target and target.winfo_exists():
            target.add_log(msg, tag)

    # ------------------------------------------------------------------
    # Clientes / Grupos (Único)
    # ------------------------------------------------------------------
    def _load_clients(self):
        for it in self.client_tree.get_children():
            self.client_tree.delete(it)
        config = self._load_config()
        for cid, info in config.get("grupos", {}).items():
            self.client_tree.insert("", tk.END, iid=cid,
                                    values=(info.get("nome", ""),))

    def _on_client_select(self, event):
        sel = self.client_tree.selection()
        if not sel:
            return
        cid = sel[0]
        self.current_client_id = cid
        # mostra painel real
        self.panel_placeholder.pack_forget()
        self.panel_content.pack(fill=tk.BOTH, expand=True)
        config = self._load_config()
        info = config.get("grupos", {}).get(cid)
        if not info:
            return
        self.client_name_var.set(info.get("nome", ""))
        self.msg_var.set(info.get("mensagem", ""))
        self.schedule_var.set(info.get("horario", "00:00"))
        self.selected_group_var.set(info.get("group_name", "—"))
        metodo = info.get("metodo", "abertura")
        if metodo not in METHOD_LABELS:
            metodo = "abertura"
        self.method_var.set(METHOD_LABELS[metodo])

        account_id = info.get("account_id")
        if account_id and account_id in self.clients:
            self._log(f"Carregando grupos de {info.get('nome')}...", "info")
            self._run_async(self._list_groups_async(account_id, preselect_id=info.get("input")))
        else:
            self.group_list.set_items([])

    def _on_group_selected_from_list(self, gid: str, name: str):
        self.selected_group_var.set(name)

    def _save_client(self):
        if not self.current_client_id:
            self._log("Selecione um cliente", "warning")
            return
        config = self._load_config()
        info = config.get("grupos", {}).get(self.current_client_id)
        if not info:
            return
        info["mensagem"] = self.msg_var.get().strip()
        info["horario"] = self.schedule_var.get().strip() or "00:00"
        label = self.method_var.get()
        info["metodo"] = next((k for k, v in METHOD_LABELS.items() if v == label), "abertura")
        gid = self.group_list.get_selected()
        if gid:
            info["input"] = gid
            info["group_name"] = self.group_map.get(gid, self.selected_group_var.get())
        self._save_config(config)
        self._log(f"'{info.get('nome')}' salvo", "success")
        self._load_clients()
        self._update_multi_display()

    def _remove_client(self):
        if not self.current_client_id:
            return
        if messagebox.askyesno("Confirmar", "Remover este cliente?"):
            config = self._load_config()
            if self.current_client_id in config.get("grupos", {}):
                del config["grupos"][self.current_client_id]
                self._save_config(config)
                self._load_clients()
                self._log("Cliente removido", "warning")
                self.current_client_id = None
                self.panel_content.pack_forget()
                self.panel_placeholder.pack(fill=tk.BOTH, expand=True)

    async def _list_groups_async(self, account_id, preselect_id=None):
        try:
            client = self.clients[account_id]
            groups: List[Tuple[str, str, Optional[str]]] = []
            self.group_map = {}
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                is_group = hasattr(dialog, "is_group") and dialog.is_group
                is_channel_bcast = hasattr(entity, "broadcast") and getattr(entity, "broadcast", False)
                if not (is_group or is_channel_bcast):
                    continue
                gid = str(entity.id)
                title = dialog.name or getattr(entity, "title", None) or gid
                self.group_map[gid] = title
                photo_path = await self._download_group_photo(client, entity, gid)
                groups.append((gid, title, photo_path))
            def apply():
                self.group_list.set_items(groups)
                if preselect_id and preselect_id in {g[0] for g in groups}:
                    self.group_list.select(preselect_id)
                    self.selected_group_var.set(self.group_map.get(preselect_id, "—"))
            self._schedule_ui(apply)
            self._log(f"{len(groups)} grupos carregados", "success")
        except Exception as e:
            self._log(f"Erro ao listar grupos: {e}", "error")

    async def _download_group_photo(self, client, entity, gid: str) -> Optional[str]:
        """Baixa a foto do grupo/canal com cache em disco. Retorna caminho ou None."""
        cache_dir = os.path.join(tempfile.gettempdir(), "sb_photos")
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except Exception:
            pass
        # procura no cache existente qualquer arquivo sb_group_<gid>.*
        try:
            for fn in os.listdir(cache_dir):
                if fn.startswith(f"sb_group_{gid}.") and os.path.getsize(os.path.join(cache_dir, fn)) > 0:
                    return os.path.join(cache_dir, fn)
        except Exception:
            pass
        # sem foto? entity.photo == None geralmente
        if getattr(entity, "photo", None) is None:
            return None
        base = os.path.join(cache_dir, f"sb_group_{gid}")
        try:
            # deixa Telethon escolher extensão automaticamente
            saved = await client.download_profile_photo(entity, file=base)
            if saved and os.path.exists(saved) and os.path.getsize(saved) > 0:
                return saved
        except Exception:
            pass
        # segunda tentativa: sem file= (Telethon escolhe o path e nome)
        try:
            saved = await client.download_profile_photo(entity)
            if saved and os.path.exists(saved) and os.path.getsize(saved) > 0:
                # move pro cache com nome consistente
                ext = os.path.splitext(saved)[1] or ".jpg"
                dst = base + ext
                try:
                    import shutil
                    shutil.move(saved, dst)
                    return dst
                except Exception:
                    return saved
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    # Monitoramento Único
    # ------------------------------------------------------------------
    def _start_monitoring(self):
        if self.monitoring_active:
            self._stop_monitoring()
            return
        if not self.current_client_id:
            self._log("Selecione um cliente", "warning")
            return
        # Validar mensagem
        msg = self.msg_var.get().strip()
        if not msg:
            self._log("Preencha a mensagem a ser enviada", "warning")
            return
        config = self._load_config()
        info = config.get("grupos", {}).get(self.current_client_id)
        if not info:
            return
        account_id = info.get("account_id")
        if account_id not in self.clients:
            self._log("Conta não conectada", "warning")
            return
        # se selecionou novo grupo na lista sem salvar, usa o selecionado
        gid = self.group_list.get_selected()
        if gid:
            info["input"] = gid
            info["group_name"] = self.group_map.get(gid, info.get("group_name", ""))
        if not info.get("input"):
            self._log("Selecione um grupo", "warning")
            return

        self.monitoring_active = True
        self.btn_monitor.set_text("■  Parar monitoramento")
        self.btn_monitor.set_command(self._stop_monitoring)
        self.monitor_pill.set("Monitorando", "success")
        self._log(f"Monitorando '{info.get('nome')}'", "success")
        self._run_async(self._monitor_single_async(account_id, self.current_client_id))

    def _stop_monitoring(self):
        self.monitoring_active = False
        self.btn_monitor.set_text("▶  Iniciar monitoramento")
        self.btn_monitor.set_command(self._start_monitoring)
        self.monitor_pill.set("Parado", "muted")
        self._log("Monitoramento pausado", "warning")

    async def _monitor_single_async(self, account_id, client_id):
        client = self.clients[account_id]
        config = self._load_config()
        info = config.get("grupos", {}).get(client_id)
        if not info:
            self.monitoring_active = False
            return
        entity_id = info.get("input")
        try:
            entity = await client.get_entity(int(entity_id))
        except Exception as e:
            # Cache de diálogos pode estar frio no primeiro run — aquece e tenta de novo.
            try:
                await client.get_dialogs(limit=200)
                entity = await client.get_entity(int(entity_id))
            except Exception as e2:
                self._log(f"Erro: {e2}", "error")
                self.monitoring_active = False
                return

        metodo = info.get("metodo", "abertura")
        client_name = info.get("nome", "cliente")
        mensagem = info.get("mensagem", "Mensagem")

        def _set_pill(text, tone):
            self._schedule_ui(self.monitor_pill.set, text, tone)

        async def _do_send():
            t0 = time.perf_counter()
            try:
                await client.send_message(entity, mensagem)
            except Exception as e:
                err_str = str(e)
                # Ignorar erros de grupo fechado e plain message
                if "CHAT_SEND_PLAIN_FORBIDDEN" not in err_str and "cannot send plain" not in err_str.lower() and "plain results" not in err_str.lower():
                    self._log(f"Erro ao enviar: {e}", "error")
                return False
            dt = time.perf_counter() - t0
            self._log(f"{client_name}: enviado em {dt:.2f}s", "success")
            # sem status por cliente — só o LOG marca o sucesso
            info["ultimo_envio"] = datetime.now().strftime("%H:%M:%S")
            self._save_config(config)
            return True

        try:
            if metodo == "abertura":
                await self._run_abertura(entity, _do_send, _set_pill, lambda: self.monitoring_active)
            elif metodo == "mensagem":
                await self._run_mensagem(client, entity, _do_send, _set_pill, lambda: self.monitoring_active)
            elif metodo == "abertura2":
                await self._run_abertura2(info.get("horario", "00:00"), _do_send, _set_pill, lambda: self.monitoring_active)
            else:
                self._log(f"Método desconhecido: {metodo}", "warning")
        except Exception as e:
            self._log(f"Erro no monitor: {e}", "warning")
        self._schedule_ui(self._stop_monitoring)

    # ------------------------------------------------------------------
    # Monitoramento Multi
    # ------------------------------------------------------------------
    def _start_multi_monitoring(self):
        if self.multi_monitoring_active:
            self._stop_multi_monitoring()
            return
        # roda apenas as contas marcadas
        selected_cards = [c for c in self.multi_cards if c["client_id"] in self._multi_selected]
        if not selected_cards:
            self._log_multi("Selecione ao menos uma conta antes de iniciar.", "warning")
            return
        cfg = self._load_config()
        valid = []
        for card in selected_cards:
            info = cfg.get("grupos", {}).get(card["client_id"])
            if not info: continue
            # Validar se tem mensagem
            msg = info.get("mensagem", "").strip()
            if not msg:
                card["detail_status"].set("Mensagem não configurada")
                card["pill"].set("Mensagem pendente", "warning")
                self._log_multi(f"{info.get('nome')}: mensagem não configurada", "warning")
                continue
            if not info.get("input"):
                card["detail_status"].set("Grupo não configurado")
                card["pill"].set("Grupo pendente", "warning")
                self._log_multi(f"{info.get('nome')}: grupo não configurado", "warning")
                continue
            valid.append((card, info))
        if not valid:
            self._log_multi("Nenhuma conta selecionada tem grupo e mensagem configurados.", "warning")
            return

        self.multi_monitoring_active = True
        self.btn_multi_monitor.set_text("■  Parar lote")
        self.btn_multi_monitor.set_command(lambda: self._stop_multi_monitoring("manual"))
        self.multi_pill.set(f"Rodando ({len(valid)})", "success")
        self._log_multi(f"Iniciado com {len(valid)} conta(s).", "success")

        for card, info in valid:
            card["monitoring"] = True
            card["completed"] = False
            card["detail_status"].set("Monitorando...")
            card["pill"].set("Monitorando", "warning")
            self._run_async(self._monitor_multi_async(card["account_id"], card["client_id"], card))

    def _all_multi_cards_completed(self):
        active = [c for c in self.multi_cards if c.get("client_id") is not None]
        if not active:
            return False
        return all(c.get("completed", False) for c in active)

    def _stop_multi_monitoring(self, reason="manual"):
        self.multi_monitoring_active = False
        self.btn_multi_monitor.set_text("▶  Iniciar lote")
        self.btn_multi_monitor.set_command(self._start_multi_monitoring)
        self.multi_pill.set("Parado", "muted")
        for card in self.multi_cards:
            card["monitoring"] = False
            card["completed"] = False
            card["pill"].set("Aguardando", "muted")
            card["detail_status"].set("Parado")
        self._log_multi("Encerramento automático." if reason == "automatico" else "Encerramento manual.", "warning")

    async def _monitor_multi_async(self, account_id, client_id, card):
        client = self.clients[account_id]
        config = self._load_config()
        info = config.get("grupos", {}).get(client_id)
        if not info:
            return
        entity_id = info.get("input")
        if not entity_id:
            card["detail_status"].set("Grupo não configurado")
            card["pill"].set("Sem grupo", "warning")
            self._log_multi(f"{info.get('nome')}: sem grupo", "warning")
            return
        try:
            entity = await client.get_entity(int(entity_id))
            card["entity"] = entity
        except Exception as e:
            # Cache de diálogos frio (comum logo após iniciar o programa) —
            # aquece via get_dialogs e tenta de novo antes de desistir.
            try:
                await client.get_dialogs(limit=200)
                entity = await client.get_entity(int(entity_id))
                card["entity"] = entity
            except Exception as e2:
                msg = str(e2)
                if "Could not find" in msg or "Cannot find" in msg:
                    card["detail_status"].set("Grupo inválido")
                    card["pill"].set("Grupo inválido", "warning")
                    self._log_multi(f"{info.get('nome')}: grupo não encontrado", "warning")
                else:
                    self._log_multi(f"{info.get('nome')}: {e2}", "error")
                return

        metodo = info.get("metodo", "abertura")
        client_name = info.get("nome", "cliente")
        mensagem = info.get("mensagem", "Msg")

        def _set_pill(text, tone):
            self._schedule_ui(card["pill"].set, text, tone)
        def _set_detail(text):
            self._schedule_ui(lambda: card["detail_status"].set(text))

        async def _do_send():
            t0 = time.perf_counter()
            try:
                await client.send_message(entity, mensagem)
            except Exception as e:
                err_str = str(e)
                # Ignorar erros de grupo fechado e plain message
                if "CHAT_SEND_PLAIN_FORBIDDEN" not in err_str and "cannot send plain" not in err_str.lower() and "plain results" not in err_str.lower():
                    self._log_multi(f"{client_name}: {e}", "error")
                return False
            dt = time.perf_counter() - t0
            self._log_multi(f"{client_name}: enviado em {dt:.2f}s", "success")
            _set_detail("Enviado")
            # pill fica em "Monitorando" (não muda pra "Enviado")
            card["monitoring"] = False
            card["completed"] = True
            if self._all_multi_cards_completed():
                self._schedule_ui(self._stop_multi_monitoring, "automatico")
            return True

        active = lambda: self.multi_monitoring_active and card.get("monitoring", False)
        try:
            if metodo == "abertura":
                _set_detail("Aguardando abertura...")
                await self._run_abertura(entity, _do_send, _set_pill, active, detail_setter=_set_detail)
            elif metodo == "mensagem":
                _set_detail("Aguardando mensagem de admin...")
                await self._run_mensagem(client, entity, _do_send, _set_pill, active, detail_setter=_set_detail)
            elif metodo == "abertura2":
                _set_detail(f"Aguardando horário {info.get('horario', '00:00')}...")
                await self._run_abertura2(info.get("horario", "00:00"), _do_send, _set_pill, active, detail_setter=_set_detail)
            else:
                self._log_multi(f"{client_name}: método desconhecido {metodo}", "warning")
        except Exception as e:
            self._log_multi(f"{client_name}: {e}", "warning")

    def _edit_multi_message(self, client_id):
        config = self._load_config()
        info = config.get("grupos", {}).get(client_id)
        if not info:
            return
        dlg = tk.Toplevel(self.root)
        dlg.title(f"Editar mensagem — {info.get('nome')}")
        dlg.geometry("460x180")
        dlg.configure(bg=THEME["bg_primary"])
        tk.Label(dlg, text="Mensagem", bg=THEME["bg_primary"], fg=THEME["text_secondary"],
                 font=(FONT_UI, 9)).pack(pady=(16, 4), padx=16, anchor=tk.W)
        mv = tk.StringVar(value=info.get("mensagem", ""))
        RoundedEntry(dlg, textvariable=mv, bg=THEME["bg_primary"]).pack(fill=tk.X, padx=16, pady=(0, 12))
        def save():
            new = mv.get().strip()
            if new:
                info["mensagem"] = new
                self._save_config(config)
                self._log_multi("Mensagem atualizada", "success")
                self._update_multi_display()
                dlg.destroy()
        RoundedButton(dlg, text="Salvar", variant="accent", command=save).pack(padx=16, pady=12, anchor=tk.W)

    def _edit_multi_group(self, client_id):
        config = self._load_config()
        info = config.get("grupos", {}).get(client_id)
        if not info:
            return
        account_id = info.get("account_id")
        if account_id not in self.clients:
            self._log_multi(f"{info.get('nome')}: conta não conectada", "warning")
            return
        self._log_multi("Carregando grupos...", "info")
        self._run_async(self._open_group_picker(account_id, info, client_id, config))

    async def _open_group_picker(self, account_id, info, client_id, config):
        try:
            client = self.clients[account_id]
            groups: List[Tuple[str, str, Optional[str]]] = []
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                if not (getattr(dialog, "is_group", False) or getattr(entity, "broadcast", False)):
                    continue
                gid = str(entity.id)
                title = dialog.name or getattr(entity, "title", None) or gid
                photo_path = await self._download_group_photo(client, entity, gid)
                groups.append((gid, title, photo_path))
            if not groups:
                self._log_multi("Nenhum grupo", "warning")
                return

            def show_picker():
                dlg = tk.Toplevel(self.root)
                dlg.title(f"Escolher grupo — {info.get('nome')}")
                dlg.geometry("460x520")
                dlg.configure(bg=THEME["bg_primary"])
                tk.Label(dlg, text="Escolha um grupo", bg=THEME["bg_primary"],
                         fg=THEME["text_primary"], font=(FONT_TITLE, 14)).pack(anchor=tk.W, padx=16, pady=(14, 8))
                gl = GroupListPanel(dlg, mode="single", height=380)
                gl.pack(fill=tk.BOTH, expand=True, padx=16, pady=(0, 12))
                gl.set_items(groups)
                cur = info.get("input")
                if cur:
                    gl.select(cur)
                def save():
                    sel = gl.get_selected()
                    if sel:
                        title = next((n for i, n, _ in groups if i == sel), sel)
                        info["input"] = sel
                        info["group_name"] = title
                        self._save_config(config)
                        self._log_multi("Grupo atualizado", "success")
                        self._update_multi_display()
                        dlg.destroy()
                RoundedButton(dlg, text="Salvar", variant="accent",
                              command=save).pack(anchor=tk.W, padx=16, pady=(0, 16))
            self._schedule_ui(show_picker)
        except Exception as e:
            self._log_multi(f"Erro: {e}", "error")

    def _get_connected_multi_clients(self):
        config = self._load_config()
        out = []
        for cid, info in config.get("grupos", {}).items():
            aid = info.get("account_id")
            if aid in self.clients:
                out.append((cid, info, aid))
        return out

    def _update_multi_display(self):
        """Recria os cards multi a partir da config atual."""
        if not hasattr(self, "multi_cards_container"):
            return
        for w in self.multi_cards_container.winfo_children():
            w.destroy()
        self.multi_cards = []
        connected = self._get_connected_multi_clients()
        if not connected:
            empty = tk.Label(self.multi_cards_container,
                             text="Nenhuma conta conectada.\nCadastre um cliente em 'Novo cliente'.",
                             bg=THEME["bg_secondary"], fg=THEME["text_muted"],
                             font=(FONT_UI, 10), pady=40, justify="center")
            empty.pack(fill=tk.X)
            self._refresh_selected_count()
            return
        # limpa seleções órfãs
        valid_ids = {cid for cid, _, _ in connected}
        self._multi_selected &= valid_ids
        limited = connected[:MULTI_MAX_ACCOUNTS]
        for i, (cid, info, aid) in enumerate(limited):
            self._create_multi_card(self.multi_cards_container, i, cid, aid, info)
        if len(connected) > MULTI_MAX_ACCOUNTS:
            tk.Label(self.multi_cards_container,
                     text=f"(exibindo {MULTI_MAX_ACCOUNTS} de {len(connected)} — limite do painel multi)",
                     bg=THEME["bg_secondary"], fg=THEME["text_muted"],
                     font=(FONT_UI, 9)).pack(pady=8)
        self._refresh_selected_count()

    # ------------------------------------------------------------------
    # Cadastro
    # ------------------------------------------------------------------
    def _register_client(self, auto: bool = False):
        name = self.register_vars["name_var"].get().strip()
        phone = self.phone_entry.get_e164().strip() if hasattr(self, "phone_entry") else ""
        api_id = self.register_vars["api_id_var"].get().strip()
        api_hash = self.register_vars["api_hash_var"].get().strip()
        opening = ""  # removido da UI
        if not all([name, phone, api_id, api_hash]):
            self.register_error.set("Preencha todos os campos")
            return
        if TelegramClient is None:
            self.register_error.set("Telethon não instalado")
            return
        self.register_data = {
            "name": name, "phone": phone,
            "api_id": int(api_id), "api_hash": api_hash,
            "opening": opening,
            "weekdays": [d for d, v in self.weekday_vars.items() if v.get()],
            "active": self.active_var.get()
        }
        self.register_error.set("")
        # desabilita o botão manual "Cadastrar" enquanto envia
        try:
            if not auto:
                self.register_btn.set_text("Enviando código...")
                self.register_btn.set_enabled(False)
        except Exception:
            pass
        self._log("Iniciando cadastro...", "info")
        self._run_async(self._register_auth_async())

    async def _register_auth_async(self):
        try:
            client = TelegramClient(StringSession(),
                                    self.register_data["api_id"],
                                    self.register_data["api_hash"])
            await client.connect()
            sent = await client.send_code_request(self.register_data["phone"])
            self.register_data["phone_code_hash"] = sent.phone_code_hash
            self.register_client_temp = client
            self._log(f"Código enviado para {self.register_data['phone']}", "success")
            self.root.after(0, self._show_auth_frame)
        except Exception as e:
            self._schedule_ui(self._register_reset_after_error, f"Erro: {e}")
            self._log(f"Erro: {e}", "error")

    def _show_auth_frame(self):
        """Estado E — mostra o input do código de login do Telegram."""
        try:
            # esconde o bloco do código do my.telegram.org e mostra o de login,
            # abaixo do input do nome do cliente.
            try:
                self.mt_code_frame.pack_forget()
            except Exception:
                pass
            self.auth_frame.pack(fill=tk.X, pady=(4, 12),
                                 after=self.name_entry
                                       if hasattr(self, "name_entry") and self.name_entry.winfo_exists()
                                       else None)
            # Limpa QUALQUER resíduo de código do cadastro anterior — mesmo se
            # _clear_register_form não foi chamado (cancelamento, erro, etc.).
            try:
                self.auth_code.entry.configure(state="normal")
                self.auth_code.delete(0, tk.END)
                # força um segundo delete via after — evita corridas com autofill/IME
                self.root.after(50, lambda: (
                    self.auth_code.winfo_exists()
                    and self.auth_code.delete(0, tk.END)
                ))
            except Exception:
                pass
            self.auth_code.entry.configure(state="normal")
            self.auth_btn.set_text("Continuar")
            self.auth_btn.set_enabled(True)
            self.auth_code.focus_set()
        except Exception:
            pass

    def _register_reset_after_error(self, msg: str):
        self.register_error.set(msg)
        try:
            self.register_btn.set_text("Cadastrar")
            self.register_btn.set_enabled(True)
        except Exception:
            pass

    def _verify_auth(self):
        code = self.auth_code.get().strip()
        if not code:
            self.register_error.set("Digite o código de login.")
            return
        self.register_error.set("")
        # Estado F — "Verificando..."
        try:
            self.auth_btn.set_text("Verificando...")
            self.auth_btn.set_enabled(False)
            self.auth_code.entry.configure(state="disabled")
        except Exception:
            pass
        self._run_async(self._verify_auth_async(code))

    async def _verify_auth_async(self, code):
        try:
            client = self.register_client_temp
            await client.sign_in(phone=self.register_data["phone"], code=code,
                                 phone_code_hash=self.register_data.get("phone_code_hash"))
            me = await client.get_me()
            account_id = str(int(time.time() * 1000))
            self.clients[account_id] = client
            self.account_info[account_id] = {
                "first_name": me.first_name or "User",
                "username": me.username or ""
            }
            config = self._load_config()
            if "accounts" not in config:
                config["accounts"] = {}
            config["accounts"][account_id] = {
                "string_session": client.session.save(),
                "api_id": self.register_data["api_id"],
                "api_hash": self.register_data["api_hash"]
            }
            if "grupos" not in config:
                config["grupos"] = {}
            client_id = str(len(config["grupos"]) + 1)
            config["grupos"][client_id] = {
                "nome": self.register_data["name"],
                "telefone": self.register_data["phone"],
                "ativo": self.register_data["active"],
                "horario_abertura": self.register_data["opening"],
                "dias_funcionamento": self.register_data["weekdays"],
                "api_id": self.register_data["api_id"],
                "api_hash": self.register_data["api_hash"],
                "account_id": account_id,
                "horario": self.register_data.get("opening", "") or "00:00",
                "metodo": "abertura",
                "input": "", "mensagem": "", "group_name": ""
            }
            self._save_config(config)
            self._log(f"Cliente '{self.register_data['name']}' cadastrado", "success")
            messagebox.showinfo("Sucesso", "Cliente cadastrado com sucesso!")
            self.root.after(0, self._clear_register_form)
            self.root.after(0, self._load_clients)
            self.root.after(0, self._update_accounts_display)
            self.root.after(0, self._update_multi_display)
        except Exception as e:
            self._schedule_ui(self._verify_reset_after_error, f"Erro: {e}")
            self._log(f"Erro: {e}", "error")

    def _verify_reset_after_error(self, msg: str):
        self.register_error.set(msg)
        try:
            self.auth_btn.set_text("Continuar")
            self.auth_btn.set_enabled(True)
            self.auth_code.entry.configure(state="normal")
        except Exception:
            pass

    def _clear_register_form(self):
        for v in self.register_vars.values():
            v.set("")
        try:
            self.phone_entry.set_e164("")
        except Exception:
            pass
        self.auth_code.delete(0, tk.END)
        self.auth_frame.pack_forget()
        self.register_error.set("")
        # restaura estado A do fluxo automático
        try:
            self.mt_code_frame.pack_forget()
            self.mt_code_var.set("")
            self.manual_frame.pack_forget()
            self.register_btn.pack_forget()
            self._manual_mode = False
            self.manual_toggle.configure(text="Preencher API ID / Hash manualmente")
            self.manual_toggle.pack(anchor=tk.W, pady=(10, 2))
            self.auto_btn.set_text("⚡ Obter API automaticamente")
            self.auto_btn.set_enabled(True)
            self.auto_hint.configure(text="Preencha o telefone acima e clique aqui")
            self.auto_btn.pack(side=tk.LEFT)
            self.auto_hint.pack(side=tk.LEFT, padx=(10, 0))
            # re-exibe a linha inteira (auto_row) caso tenha sido escondida
            # ao mostrar o input de código do my.telegram.org
            try:
                self.auto_row.pack_forget()
                self.auto_row.pack(fill=tk.X, pady=(10, 4),
                                   before=self.manual_toggle)
            except Exception:
                pass
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Métodos de envio (inalterados)
    # ------------------------------------------------------------------
    def _is_open_for_sending(self, entity):
        if isinstance(entity, Channel):
            rights = getattr(entity, "default_banned_rights", None)
            if rights is None:
                return True
            return not getattr(rights, "send_messages", False)
        return True

    async def _run_abertura(self, entity, do_send, set_status, is_active, detail_setter=None):
        """Grupo fechado — quando abrir, dispara envio a cada 0.01s até enviar."""
        last_state = None
        while is_active():
            try:
                if self._is_open_for_sending(entity):
                    if last_state != "sending":
                        # pill fica "Monitorando" (não muda) — só o detalhe muda
                        if detail_setter: detail_setter("Grupo aberto — disparando...")
                        last_state = "sending"
                    # loop agressivo: tenta a cada 0.01s até conseguir
                    for _ in range(CLOSED_MAX_ATTEMPTS):
                        if not is_active():
                            return
                        if await do_send():
                            return
                        await asyncio.sleep(0.01)
                    # esgotou tentativas
                    # não muda pill; só o detalhe informa
                    if detail_setter: detail_setter("Não foi possível enviar após várias tentativas.")
                    return
                else:
                    if last_state != "waiting":
                        if detail_setter: detail_setter("Verificando...")
                        last_state = "waiting"
                    await asyncio.sleep(0.01)
            except Exception as e:
                if detail_setter: detail_setter("Verificando...")
                await asyncio.sleep(0.01)

    async def _run_mensagem(self, client, entity, do_send, set_status, is_active, detail_setter=None):
        admin_ids = set()
        try:
            if ChannelParticipantsAdmins is not None:
                async for p in client.iter_participants(entity, filter=ChannelParticipantsAdmins()):
                    admin_ids.add(p.id)
            else:
                async for p in client.iter_participants(entity):
                    admin_ids.add(p.id)
        except Exception as e:
            self._log(f"Não consegui listar admins: {e}", "warning")

        # pill permanece "Monitorando" — usa só detail_setter para status
        if detail_setter:
            detail_setter(f"Aguardando mensagem de admin ({len(admin_ids)} admins)...")

        fired = asyncio.Event()
        async def handler(event):
            try:
                sid = event.sender_id
                if not admin_ids or sid in admin_ids:
                    fired.set()
            except Exception:
                pass
        if tg_events is None:
            self._log("telethon.events indisponível", "error")
            return
        client.add_event_handler(handler, tg_events.NewMessage(chats=entity))
        try:
            while is_active() and not fired.is_set():
                try:
                    await asyncio.wait_for(fired.wait(), timeout=0.01)
                except asyncio.TimeoutError:
                    continue
            if fired.is_set() and is_active():
                if detail_setter: detail_setter("Admin postou — enviando...")
                await do_send()
        finally:
            try:
                client.remove_event_handler(handler)
            except Exception:
                pass

    async def _run_abertura2(self, horario, do_send, set_status, is_active, detail_setter=None):
        try:
            hh, mm = horario.strip().split(":")
            target_h, target_m = int(hh), int(mm)
        except Exception:
            self._log(f"Horário inválido '{horario}' — use HH:MM", "error")
            return
        # pill permanece "Monitorando"
        if detail_setter:
            detail_setter(f"Aguardando {target_h:02d}:{target_m:02d} (Brasília)...")

        def now_br():
            return _brasilia_now()

        while is_active():
            n = now_br()
            if n.hour == target_h and n.minute == target_m:
                break
            target_seconds = target_h * 3600 + target_m * 60
            now_seconds = n.hour * 3600 + n.minute * 60 + n.second
            delta = target_seconds - now_seconds
            if delta < 0:
                self._log(f"Horário {target_h:02d}:{target_m:02d} já passou hoje ({n.strftime('%H:%M:%S')})", "warning")
                return
            # loop mais agressivo — retenta a cada 0.01s quando perto,
            # e sleeps mais longos quando ainda falta muito tempo.
            sleep_for = 0.01 if delta <= 2 else min(delta / 4, 5.0)
            await asyncio.sleep(sleep_for)
        if not is_active():
            return
        if detail_setter: detail_setter("Horário atingido — enviando...")
        await do_send()

    # ------------------------------------------------------------------
    # Sessão / infra
    # ------------------------------------------------------------------
    def _update_accounts_display(self):
        count = len(self.clients)
        if count > 0:
            self.status_pill.set("Conectado", "success")
        else:
            self.status_pill.set("Desconectado", "error")
        for w in self.accounts_frame.winfo_children():
            w.destroy()
        for aid, client in self.clients.items():
            info = self.account_info.get(aid, {})
            name = info.get("first_name", aid[:8])
            row = tk.Frame(self.accounts_frame, bg=THEME["bg_secondary"])
            row.pack(fill=tk.X, pady=2)
            tk.Label(row, text="●", bg=THEME["bg_secondary"], fg=THEME["success"],
                     font=(FONT_UI, 9)).pack(side=tk.LEFT, padx=(0, 6))
            tk.Label(row, text=name, bg=THEME["bg_secondary"], fg=THEME["text_primary"],
                     font=(FONT_UI, 9)).pack(side=tk.LEFT)

    def _auto_reconnect(self):
        config = self._load_config()
        accounts = config.get("accounts", {})
        if not accounts or TelegramClient is None:
            return
        if not self.loop or not self.loop.is_running():
            self.root.after(500, self._auto_reconnect)
            return
        self._log(f"Reconectando {len(accounts)} conta(s)...", "info")
        for aid, sd in accounts.items():
            try:
                self._run_async(self._reconnect_account_async(aid, sd))
            except Exception as e:
                self._log(f"Erro ao agendar reconexão: {e}", "warning")

    async def _reconnect_account_async(self, account_id, session_data):
        try:
            api_id = int(session_data.get("api_id", 0))
            api_hash = session_data.get("api_hash", "")
            client = TelegramClient(StringSession(session_data["string_session"]), api_id, api_hash)
            await client.start()
            me = await client.get_me()
            self.clients[account_id] = client
            self.account_info[account_id] = {
                "first_name": me.first_name or "User",
                "username": me.username or ""
            }
            self.root.after(0, self._update_accounts_display)
            self.root.after(0, self._update_multi_display)
            self._log(f"Reconectado: {me.first_name}", "success")
        except Exception as e:
            self._log(f"Erro ao reconectar: {e}", "warning")

    def _start_event_loop(self):
        def run_loop():
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)
            self.loop.run_forever()
            self.loop.close()
        self.thread_loop = threading.Thread(target=run_loop, daemon=True)
        self.thread_loop.start()

    def _shutdown(self):
        if self.loop and self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
        if self.thread_loop and self.thread_loop.is_alive():
            self.thread_loop.join(timeout=2)

    def _run_async(self, coro):
        if self.loop and self.loop.is_running():
            return asyncio.run_coroutine_threadsafe(coro, self.loop)

    def _load_config(self) -> dict:
        if not os.path.exists(CONFIG_FILE):
            return {"accounts": {}, "grupos": {}}
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)

    def _save_config(self, config: dict):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)

    def run(self):
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()

    def _on_close(self):
        self._shutdown()
        self.root.destroy()

    # ------------------------------------------------------------------
    # my.telegram.org — automação (opcional, com fallback manual)
    # ------------------------------------------------------------------
    def _mt_normalize_phone(self, raw: str) -> str:
        raw = (raw or "").strip()
        digits = "".join(ch for ch in raw if ch.isdigit())
        if raw.startswith("+"):
            return "+" + digits
        if digits.startswith("55") and len(digits) in (12, 13):
            return "+" + digits
        if len(digits) in (10, 11):
            return "+55" + digits
        if 8 <= len(digits) <= 20:
            return "+" + digits
        raise ValueError("Telefone inválido")

    def _auto_fetch_api(self):
        if not _HAS_REQUESTS:
            messagebox.showerror(
                "Falta dependência",
                "Instale a lib 'requests' com:  pip install requests")
            return
        try:
            phone_raw = self.phone_entry.get_e164() if hasattr(self, "phone_entry") else ""
            phone = self._mt_normalize_phone(phone_raw)
        except Exception:
            self.register_error.set("Preencha o telefone antes de usar a automação.")
            return
        name = self.register_vars["name_var"].get().strip() or "SB Client"
        self.register_error.set("")
        # Estado B — botão "Enviando código..." desabilitado
        self.auto_btn.set_text("Enviando código...")
        self.auto_btn.set_enabled(False)
        try:
            self.auto_hint.configure(text="")
        except Exception:
            pass
        self._log(f"Automação: pedindo código para {phone}...", "info")
        threading.Thread(target=self._mt_flow, args=(phone, name), daemon=True).start()

    def _mt_flow(self, phone: str, client_title: str):
        """Fluxo completo em thread: send_password → pede código no UI → login → apps."""
        UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")
        ORIGIN = "https://my.telegram.org"
        s = _requests_mt.Session()
        s.headers.update({
            "User-Agent": UA,
            "Accept-Language": "pt-BR,pt;q=0.9",
        })
        try:
            # 1) GET pra plantar cookies
            s.get(f"{ORIGIN}/auth?to=apps", timeout=20)
            # 2) send_password
            r = s.post(f"{ORIGIN}/auth/send_password",
                       data={"phone": phone},
                       headers={
                           "Accept": "application/json, text/javascript, */*; q=0.01",
                           "X-Requested-With": "XMLHttpRequest",
                           "Origin": ORIGIN,
                           "Referer": f"{ORIGIN}/auth?to=apps",
                       },
                       timeout=20)
            if not r.ok:
                self._schedule_ui(self._mt_reset_auto_btn,
                                  f"Falha ao pedir código: HTTP {r.status_code}")
                self._log(f"Automação: HTTP {r.status_code}", "error")
                return
            data = r.json()
            random_hash = data.get("random_hash")
            if not random_hash:
                self._schedule_ui(self._mt_reset_auto_btn,
                                  "Resposta inesperada do Telegram. Preencha manualmente.")
                return
            self._log("Automação: código enviado no seu Telegram.", "success")
            # 3) UI pede o código inline (estado C)
            self._schedule_ui(self._mt_show_code_input, s, phone, random_hash, client_title)
        except Exception as e:
            self._log(f"Automação: erro — {e}", "error")
            self._schedule_ui(self._mt_reset_auto_btn, f"Erro na automação: {e}")

    def _mt_reset_auto_btn(self, err_msg: Optional[str] = None):
        """Volta o botão de automação ao estado inicial (com erro opcional)."""
        try:
            self.auto_btn.set_text("⚡ Obter API automaticamente")
            self.auto_btn.set_enabled(True)
            self.auto_hint.configure(text="Preencha o telefone acima e clique aqui")
        except Exception:
            pass
        if err_msg:
            self.register_error.set(err_msg)

    def _mt_show_code_input(self, session, phone, random_hash, client_title):
        """Estado C — esconde o botão automático e mostra input inline."""
        self._mt_session = session
        self._mt_phone = phone
        self._mt_random_hash = random_hash
        self._mt_client_title = client_title
        try:
            # esconde o auto_row inteiro
            self.auto_btn.master.pack_forget()
        except Exception:
            pass
        # mostra o bloco de código do my.telegram.org logo abaixo do telefone
        self.mt_code_frame.pack(fill=tk.X, pady=(6, 4))
        self.mt_code_var.set("")
        self.mt_code_btn.set_text("Confirmar código")
        self.mt_code_btn.set_enabled(True)
        try:
            self.mt_code_entry.entry.configure(state="normal")
            self.mt_code_entry.entry.focus_set()
        except Exception:
            pass

    def _mt_confirm_code_click(self):
        code = self.mt_code_var.get().strip()
        if not code:
            self.register_error.set("Digite o código enviado no Telegram.")
            return
        self.register_error.set("")
        # Estado D — "Verificando..."
        self.mt_code_btn.set_text("Verificando...")
        self.mt_code_btn.set_enabled(False)
        try:
            self.mt_code_entry.entry.configure(state="disabled")
        except Exception:
            pass
        threading.Thread(target=self._mt_finish, args=(
            self._mt_session, self._mt_phone, self._mt_random_hash,
            code, self._mt_client_title
        ), daemon=True).start()

    def _mt_finish(self, s, phone, random_hash, code, client_title):
        ORIGIN = "https://my.telegram.org"
        try:
            r = s.post(f"{ORIGIN}/auth/login",
                       data={"phone": phone, "random_hash": random_hash, "password": code},
                       headers={
                           "Accept": "application/json, text/javascript, */*; q=0.01",
                           "X-Requested-With": "XMLHttpRequest",
                           "Origin": ORIGIN,
                           "Referer": f"{ORIGIN}/auth",
                       },
                       timeout=20)
            if r.text.strip() != "true":
                self._schedule_ui(self._mt_code_error, "Código inválido ou expirado.")
                return
            # /apps
            html = s.get(f"{ORIGIN}/apps", timeout=20).text
            api_id, api_hash = self._mt_extract_creds(html)
            if not api_id:
                # precisa criar
                m = _re_mt.search(
                    r'<input[^>]+name=["\']hash["\'][^>]+value=["\']([^"\']+)["\']', html, _re_mt.I)
                if not m:
                    self._schedule_ui(self._mt_code_error, "Não consegui ler o formulário. Preencha manualmente.")
                    return
                create_hash = m.group(1)
                base = _re_mt.sub(r'[^a-z0-9]', '',
                                  (client_title or "sb").lower())[:20] or "sb"
                short = f"sb{base}"[:32]
                s.post(f"{ORIGIN}/apps/create",
                       data={
                           "hash": create_hash,
                           "app_title": f"SB {client_title}"[:32],
                           "app_shortname": short,
                           "app_url": "",
                           "app_platform": "desktop",
                           "app_desc": "",
                       },
                       headers={
                           "X-Requested-With": "XMLHttpRequest",
                           "Origin": ORIGIN,
                           "Referer": f"{ORIGIN}/apps",
                       },
                       timeout=20)
                html = s.get(f"{ORIGIN}/apps", timeout=20).text
                api_id, api_hash = self._mt_extract_creds(html)
            if not api_id:
                self._schedule_ui(self._mt_code_error, "Não consegui obter API ID/Hash. Preencha manualmente.")
                return
            # sucesso — salva creds internamente e dispara o send_code do Telethon
            self._schedule_ui(self._mt_success_start_signin, api_id, api_hash)
        except Exception as e:
            self._schedule_ui(self._mt_code_error, f"Erro: {e}")

    def _mt_code_error(self, msg: str):
        """Reabilita o botão de confirmar código com uma mensagem de erro."""
        self.register_error.set(msg)
        try:
            self.mt_code_btn.set_text("Confirmar código")
            self.mt_code_btn.set_enabled(True)
            self.mt_code_entry.entry.configure(state="normal")
        except Exception:
            pass

    def _mt_success_start_signin(self, api_id, api_hash):
        """API obtida — esconde o bloco MT e dispara o send_code do Telethon."""
        self.register_vars["api_id_var"].set(str(api_id))
        self.register_vars["api_hash_var"].set(api_hash)
        self._log(f"Automação: API ID={api_id} obtido. Enviando código de login...", "success")
        # esconde bloco MT
        try:
            self.mt_code_frame.pack_forget()
            self.manual_toggle.pack_forget()
        except Exception:
            pass
        self.register_error.set("")
        # dispara cadastro (que envia o código do Telethon e mostra auth_frame)
        self._register_client(auto=True)

    def _mt_extract_creds(self, html: str):
        id_m = (_re_mt.search(r'api_id[^<]*</label>[\s\S]{0,400}?<strong[^>]*>\s*(\d{3,20})\s*</strong>', html, _re_mt.I)
                or _re_mt.search(r'<strong[^>]*>\s*(\d{5,20})\s*</strong>', html, _re_mt.I))
        hash_m = (_re_mt.search(r'api_hash[^<]*</label>[\s\S]{0,400}?<span[^>]*>\s*([a-f0-9]{32})\s*</span>', html, _re_mt.I)
                  or _re_mt.search(r'>\s*([a-f0-9]{32})\s*<', html))
        if id_m and hash_m:
            return id_m.group(1), hash_m.group(1).lower()
        return None, None


if __name__ == "__main__":
    app = SenhaBaixaApp()
    app.run()
