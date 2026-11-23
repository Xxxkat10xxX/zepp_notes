#!/usr/bin/env python3
"""
Сервер рендеринга для приложения «Заметки» (Zepp OS).

Превращает формулы LaTeX, фотографии и страницы PDF в PNG ровно под ширину
экрана часов. Side service на телефоне обращается к нему так:

    GET /render?kind=latex&tex=...&display=1&w=350
    GET /render?kind=image&url=https://...&w=350
    GET /render?kind=pdf&url=https://...&from=1&to=5&w=350
      -> {"items": [{"url": "/img/<id>.png", "w": 350, "h": 120, "page": 1}], "pages": 12}
    GET /img/<id>.png   -> сама картинка
    GET /health         -> ok

Запуск:
    pip install -r tools/requirements.txt
    python3 tools/render_server.py --host 0.0.0.0 --port 8787

Телефон должен видеть этот адрес (одна Wi-Fi сеть или сервер в интернете).
Для «настоящего» LaTeX (TikZ, окружения и т.п.) установите TeX Live и
запускайте с --usetex; без него используется встроенный mathtext matplotlib.
"""
import argparse
import hashlib
import io
import json
import os
import sys
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

MAX_W = 390
MAX_IMG_H = 600  # максимальная высота фото на часах
MAX_PDF_PAGES = 30
MAX_DOWNLOAD = 50 * 1024 * 1024
UA = "zepp-notes-render/1.0"

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
USETEX = False
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


def download(url: str) -> bytes:
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("поддерживаются только http(s) ссылки")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError("файл слишком большой")
    return data


def fit_width(img: Image.Image, w: int, max_h: int | None = None) -> Image.Image:
    scale = min(1.0, w / img.width)
    if max_h and img.height * scale > max_h:
        scale = max_h / img.height
    if scale < 1.0:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    return img


# ---------------- LaTeX ----------------
def render_latex(tex: str, display: bool, w: int) -> dict:
    key = make_key("latex", tex, display, w, USETEX)
    hit = cached(key)
    if hit:
        return hit

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    size = 20 if display else 17
    dpi = 140 if display else 125
    # многострочные формулы (через \\\\) рендерим построчно и склеиваем
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
    img = fit_width(img, w)
    return save_png(img, key)


# ---------------- Фото ----------------
def render_image(url: str, w: int) -> dict:
    key = make_key("image", url, w)
    hit = cached(key)
    if hit:
        return hit
    img = Image.open(io.BytesIO(download(url)))
    try:
        from PIL import ImageOps

        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
        bg.alpha_composite(img)
        img = bg
    img = fit_width(img, w, MAX_IMG_H)
    return save_png(img, key)


# ---------------- PDF ----------------
def render_pdf(url: str, first: int, last: int, w: int) -> tuple[list, int]:
    import pymupdf

    data = download(url)
    doc_id = hashlib.sha1(data).hexdigest()[:12]
    doc = pymupdf.open(stream=data, filetype="pdf")
    total = doc.page_count
    first = max(1, first)
    last = min(total, last, first + MAX_PDF_PAGES - 1)
    items = []
    for pno in range(first, last + 1):
        key = make_key("pdf", doc_id, pno, w)
        hit = cached(key)
        if not hit:
            page = doc[pno - 1]
            # рендерим с запасом (2x) и уменьшаем — так текст читается лучше
            zoom = (w * 2) / page.rect.width
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            img = fit_width(img, w)
            hit = save_png(img, key)
        hit = dict(hit, page=pno)
        items.append(hit)
    doc.close()
    return items, total


class Handler(BaseHTTPRequestHandler):
    server_version = "ZeppNotesRender/1.0"

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if u.path == "/health":
                return self._send(200, b"ok", "text/plain")
            if u.path.startswith("/img/"):
                name = os.path.basename(u.path)
                if not name.endswith(".png") or not all(c.isalnum() or c == "." for c in name):
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
                    item = render_latex(q.get("tex", ""), q.get("display", "1") == "1", w)
                    return self._json(200, {"items": [item]})
                if kind == "image":
                    return self._json(200, {"items": [render_image(q["url"], w)]})
                if kind == "pdf":
                    first = int(q.get("from", 1))
                    last = int(q.get("to", first + MAX_PDF_PAGES - 1))
                    items, total = render_pdf(q["url"], first, last, w)
                    return self._json(200, {"items": items, "pages": total})
                return self._json(400, {"error": "unknown kind"})
            return self._send(404, b"not found", "text/plain")
        except Exception as e:  # ошибка уходит на часы как текст
            self.log_error("render failed: %r", e)
            return self._json(200, {"error": f"{type(e).__name__}: {e}"})


def main():
    global USETEX
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--usetex", action="store_true", help="использовать установленный LaTeX вместо mathtext")
    args = ap.parse_args()
    USETEX = args.usetex
    os.makedirs(CACHE_DIR, exist_ok=True)
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Render server: http://{args.host}:{args.port}  (cache: {CACHE_DIR})", file=sys.stderr)
    srv.serve_forever()


if __name__ == "__main__":
    main()
