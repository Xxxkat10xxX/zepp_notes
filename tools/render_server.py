#!/usr/bin/env python3
"""
Офлайн-рендерер для приложения «Заметки» (Zepp OS). Работает прямо на телефоне
в Termux (Android) и не ходит в интернет.

Что делает:
  * берёт заметки и файлы из папки на телефоне (по умолчанию
    «Внутренняя память/ZeppNotes»):
      *.md, *.txt          — заметки (разметка: $$формулы$$, ![](file:фото.jpg), [pdf](file:док.pdf))
      *.pdf                — каждая PDF-заметка показывает страницы документа
      *.jpg/*.png/*.webp…  — каждая картинка становится заметкой-фото
  * рисует формулы LaTeX, фото и страницы PDF в PNG ровно под ширину экрана часов;
  * отдаёт всё это side service'у Zepp по адресу http://127.0.0.1:8787.

API:
    GET /notes                                        -> {"notes": [{id,title,body,updated}]}
    GET /render?kind=latex&tex=...&display=1&w=350
    GET /render?kind=image&url=file:photo.jpg&w=350
    GET /render?kind=pdf&url=file:doc.pdf&from=1&to=5&w=350
      -> {"items": [{"url": "/img/<id>.png", "w": 350, "h": 453, "page": 1}], "pages": 12}
    GET /img/<id>.png
    GET /health

Зависимости (Termux): pkg install python python-pillow mupdf-tools matplotlib
  * PDF рисуется через PyMuPDF, если он есть, иначе через `mutool` (mupdf-tools);
  * формулы — через matplotlib (mathtext, без установки TeX).
"""
import argparse
import glob
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageOps

MAX_W = 390
MAX_IMG_H = 600  # максимальная высота фото на часах
MAX_PDF_PAGES = 30
NOTE_EXT = (".md", ".txt")
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")
PDF_EXT = (".pdf",)

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
NOTES_DIR = os.path.expanduser("~/storage/shared/ZeppNotes")
USETEX = False
ALLOW_NET = False
_mpl_lock = threading.Lock()


def cache_path(key: str) -> str:
    return os.path.join(CACHE_DIR, key + ".png")


def make_key(*parts) -> str:
    return hashlib.sha1(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()[:20]


def save_png(img: Image.Image, key: str) -> dict:
    img = img.convert("RGB")
    img.save(cache_path(key), "PNG", optimize=True)
    return {"url": f"/img/{key}.png", "w": img.width, "h": img.height}


def cached(key: str):
    p = cache_path(key)
    if os.path.exists(p):
        with Image.open(p) as im:
            return {"url": f"/img/{key}.png", "w": im.width, "h": im.height}
    return None


def fit_width(img: Image.Image, w: int, max_h: int | None = None, enlarge=False) -> Image.Image:
    scale = w / img.width
    if max_h and img.height * scale > max_h:
        scale = max_h / img.height
    if not enlarge:
        scale = min(scale, 1.0)
    if scale != 1.0:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    return img


# ---------------- Файлы ----------------
def local_path(ref: str) -> str:
    """file:имя.pdf -> абсолютный путь внутри папки заметок (без выхода наружу)."""
    name = urllib.parse.unquote(ref[5:] if ref.startswith("file:") else ref).strip().lstrip("/")
    root = os.path.realpath(NOTES_DIR)
    path = os.path.realpath(os.path.join(root, name))
    if not path.startswith(root + os.sep):
        raise ValueError("путь вне папки заметок")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"нет файла «{name}» в папке {NOTES_DIR}")
    return path


def read_source(ref: str) -> tuple[bytes, str]:
    """Возвращает (содержимое, идентификатор версии) для file: или http(s)-ссылки."""
    if ref.startswith(("http://", "https://")):
        if not ALLOW_NET:
            raise ValueError("ссылки из интернета выключены; положите файл в папку и пишите file:имя")
        import urllib.request

        with urllib.request.urlopen(urllib.request.Request(ref, headers={"User-Agent": "zepp-notes"}), timeout=60) as r:
            data = r.read(50 * 1024 * 1024)
        return data, hashlib.sha1(data).hexdigest()
    path = local_path(ref)
    st = os.stat(path)
    with open(path, "rb") as f:
        data = f.read()
    return data, f"{path}:{st.st_size}:{int(st.st_mtime)}"


def list_notes() -> list:
    """Заметки из папки: текстовые файлы, PDF и картинки."""
    notes = []
    if not os.path.isdir(NOTES_DIR):
        return notes
    for path in sorted(glob.glob(os.path.join(NOTES_DIR, "*")), key=os.path.getmtime, reverse=True):
        name = os.path.basename(path)
        low = name.lower()
        if name.startswith(".") or not os.path.isfile(path):
            continue
        stem = os.path.splitext(name)[0]
        mtime = int(os.path.getmtime(path) * 1000)
        if low.endswith(NOTE_EXT):
            with open(path, encoding="utf-8", errors="replace") as f:
                body = f.read()
            m = re.match(r"\s*#\s+(.+)", body)
            title = m.group(1).strip() if m else stem
            if m:
                body = body[m.end():].lstrip("\n")
        elif low.endswith(PDF_EXT):
            title, body = stem, f"[pdf](file:{name})"
        elif low.endswith(IMG_EXT):
            title, body = stem, f"![](file:{name})"
        else:
            continue
        notes.append({"id": "f:" + name, "title": title, "body": body, "updated": mtime})
    return notes


# ---------------- LaTeX ----------------
def render_latex(tex: str, display: bool, w: int) -> dict:
    key = make_key("latex", 2, tex, display, w, USETEX)
    hit = cached(key)
    if hit:
        return hit
    try:
        import matplotlib
    except ImportError:
        raise RuntimeError("для формул установите matplotlib: pkg install matplotlib")

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    size = 20 if display else 17
    dpi = 140 if display else 125
    # многострочные формулы (через \\) рендерим построчно и склеиваем
    lines = [l.strip() for l in tex.split("\\\\") if l.strip()] or [tex]
    parts = []
    with _mpl_lock:
        plt.rcParams["text.usetex"] = USETEX
        if USETEX:
            plt.rcParams["text.latex.preamble"] = r"\usepackage{amsmath,amssymb}"
        for line in lines:
            fig = plt.figure(figsize=(0.01, 0.01), dpi=dpi)
            fig.patch.set_facecolor("black")
            fig.text(0, 0, f"${line}$", fontsize=size, color="white")
            buf = io.BytesIO()
            try:
                fig.savefig(buf, format="png", dpi=dpi, facecolor="black", bbox_inches="tight", pad_inches=0.05)
            finally:
                plt.close(fig)
            buf.seek(0)
            im = Image.open(buf)
            im.load()
            parts.append(fit_width(im.convert("RGB"), w))
    gap = 8
    img = Image.new("RGB", (max(p.width for p in parts), sum(p.height for p in parts) + gap * (len(parts) - 1)))
    y = 0
    for part in parts:
        x = (img.width - part.width) // 2 if display else 0
        img.paste(part, (x, y))
        y += part.height + gap
    return save_png(fit_width(img, w), key)


# ---------------- Фото ----------------
def render_image(ref: str, w: int) -> dict:
    data, version = read_source(ref)
    key = make_key("image", version, w)
    hit = cached(key)
    if hit:
        return hit
    img = Image.open(io.BytesIO(data))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
        bg.alpha_composite(img)
        img = bg
    return save_png(fit_width(img, w, MAX_IMG_H), key)


# ---------------- PDF ----------------
def _pdf_pages_pymupdf(data: bytes, pages: list, w: int):
    import pymupdf

    doc = pymupdf.open(stream=data, filetype="pdf")
    total = doc.page_count
    out = {}
    for pno in pages:
        if pno > total:
            break
        page = doc[pno - 1]
        zoom = (w * 2) / page.rect.width  # с запасом 2x, потом уменьшаем — текст чётче
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        out[pno] = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    doc.close()
    return total, out


def _pdf_pages_mutool(data: bytes, pages: list, w: int):
    mutool = shutil.which("mutool")
    if not mutool:
        raise RuntimeError("для PDF установите mupdf-tools: pkg install mupdf-tools")
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.pdf")
        with open(src, "wb") as f:
            f.write(data)
        info = subprocess.run([mutool, "info", src], capture_output=True, text=True, timeout=120)
        m = re.search(r"Pages:\s*(\d+)", info.stdout + info.stderr)
        if not m:
            raise RuntimeError("не удалось прочитать PDF: " + (info.stderr.strip()[:200] or "mutool info"))
        total = int(m.group(1))
        want = [p for p in pages if p <= total]
        out = {}
        if want:
            pattern = os.path.join(tmp, "p%d.png")
            r = subprocess.run(
                [mutool, "draw", "-q", "-F", "png", "-w", str(w * 2), "-o", pattern, src, ",".join(map(str, want))],
                capture_output=True,
                text=True,
                timeout=600,
            )
            if r.returncode != 0:
                raise RuntimeError("mutool draw: " + r.stderr.strip()[:200])
            for pno in want:
                p = os.path.join(tmp, f"p{pno}.png")
                if os.path.exists(p):
                    with Image.open(p) as im:
                        out[pno] = im.convert("RGB")
        return total, out


def render_pdf(ref: str, first: int, last: int, w: int) -> tuple[list, int]:
    data, version = read_source(ref)
    first = max(1, first)
    last = max(first, min(last, first + MAX_PDF_PAGES - 1))
    pages = list(range(first, last + 1))

    total_key = make_key("pdf-total", version)
    total_file = os.path.join(CACHE_DIR, total_key + ".txt")
    total = int(open(total_file).read()) if os.path.exists(total_file) else None
    if total is not None:
        pages = [p for p in pages if p <= total]  # лишние страницы не запрашиваем

    items, missing = {}, []
    for pno in pages:
        hit = cached(make_key("pdf", version, pno, w))
        if hit and total is not None:
            items[pno] = hit
        else:
            missing.append(pno)

    if missing or total is None:
        try:
            total, imgs = _pdf_pages_pymupdf(data, missing, w)
        except ImportError:
            total, imgs = _pdf_pages_mutool(data, missing, w)
        with open(total_file, "w") as f:
            f.write(str(total))
        for pno, img in imgs.items():
            items[pno] = save_png(fit_width(img, w, enlarge=True), make_key("pdf", version, pno, w))

    if first > total:
        raise ValueError(f"в документе всего {total} стр.")
    return [dict(items[p], page=p) for p in pages if p in items], total


class Handler(BaseHTTPRequestHandler):
    server_version = "ZeppNotesRender/2.0"

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if u.path == "/health":
                return self._send(200, b"ok", "text/plain")
            if u.path == "/notes":
                return self._json(200, {"notes": list_notes(), "dir": NOTES_DIR})
            if u.path.startswith("/img/"):
                name = os.path.basename(u.path)
                if not re.fullmatch(r"[0-9a-f]{20}\.png", name):
                    return self._send(404, b"not found", "text/plain")
                p = os.path.join(CACHE_DIR, name)
                if not os.path.exists(p):
                    return self._send(404, b"not found", "text/plain")
                with open(p, "rb") as f:
                    return self._send(200, f.read(), "image/png")
            if u.path == "/render":
                w = max(50, min(MAX_W, int(q.get("w", 350))))
                kind = q.get("kind")
                if kind == "latex":
                    return self._json(200, {"items": [render_latex(q.get("tex", ""), q.get("display", "1") == "1", w)]})
                if kind == "image":
                    return self._json(200, {"items": [render_image(q["url"], w)]})
                if kind == "pdf":
                    first = int(q.get("from", 1))
                    last = int(q.get("to", first + MAX_PDF_PAGES - 1))
                    items, total = render_pdf(q["url"], first, last, w)
                    return self._json(200, {"items": items, "pages": total})
                return self._json(400, {"error": "unknown kind"})
            return self._send(404, b"not found", "text/plain")
        except Exception as e:  # ошибка уходит на часы текстом
            self.log_error("render failed: %r", e)
            return self._json(200, {"error": f"{e}"})


def main():
    global USETEX, ALLOW_NET, NOTES_DIR
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1", help="127.0.0.1 — доступен только с этого телефона")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--notes-dir", default=NOTES_DIR, help="папка с заметками, PDF и фото")
    ap.add_argument("--usetex", action="store_true", help="использовать установленный LaTeX вместо mathtext")
    ap.add_argument("--allow-net", action="store_true", help="разрешить http(s)-ссылки на файлы")
    args = ap.parse_args()
    USETEX, ALLOW_NET = args.usetex, args.allow_net
    NOTES_DIR = os.path.abspath(os.path.expanduser(args.notes_dir))
    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(NOTES_DIR, exist_ok=True)
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Заметки: http://{args.host}:{args.port}  папка: {NOTES_DIR}", file=sys.stderr)
    srv.serve_forever()


if __name__ == "__main__":
    main()
