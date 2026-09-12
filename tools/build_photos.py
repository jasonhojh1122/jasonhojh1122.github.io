#!/usr/bin/env python3
"""
build_photos.py — generate the Photos page from the Portfolio repo.

    python3 tools/build_photos.py [~/src/Portfolio]

Reads  <portfolio>/Photos/photos.json   (written by tools/extract_photos.py;
       run that first whenever a photograph is added or replaced)
       <portfolio>/Photos/<file>        (the originals)
Writes photos/index.html
       photos/img/<id>.jpg      full size for the lightbox (max 2000px, JPEG 82)
       photos/img/<id>-s.jpg    the print on the page  (max 1200px, JPEG 80)

The page is a board of prints, newest first, each in its own white frame.
Every picture has the same white border; the frames are laid out in rows
of equal height by photos.css from the --ar each carries. Clicking a print opens it full size with the data the
camera wrote: when, where, and the exposure.

Only the standard library and macOS `sips` are used. Images are re-encoded
only when the source is newer than the output; an image whose photograph
was removed or hidden is deleted from photos/img/.
"""

import html
import json
import os
import re
import struct
import subprocess
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, ".."))
PORTFOLIO = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/src/Portfolio")
PHOTOS = os.path.join(PORTFOLIO, "Photos")
DATA = os.path.join(PHOTOS, "photos.json")
OUT = os.path.join(SITE, "photos")
IMG_OUT = os.path.join(OUT, "img")

FULL_PX, FULL_Q = 2000, 82
SMALL_PX, SMALL_Q = 1200, 80

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def esc(s):
    return html.escape(str(s), quote=True)

# --- images ------------------------------------------------------------------

def sips_size(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                         capture_output=True, text=True).stdout
    return (int(re.search(r"pixelWidth:\s*(\d+)", out).group(1)),
            int(re.search(r"pixelHeight:\s*(\d+)", out).group(1)))

def encode(p, suffix, max_px, q):
    """One JPEG of photograph p in photos/img/. Returns (relname, w, h)."""
    src = os.path.join(PHOTOS, p["file"])
    if not os.path.exists(src):
        sys.exit(f"photograph not found: {src}")
    rel = p["id"] + suffix + ".jpg"
    dst = os.path.join(IMG_OUT, rel)
    if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(q),
                        "-Z", str(max_px), src, "--out", dst], check=True, capture_output=True)
    upright(p, dst)
    w, h = sips_size(dst)
    return rel, w, h

def upright(p, dst):
    """Bake the orientation into the pixels and clear the tag.

    sips turns the pixels of a rotated JPEG but not of a rotated HEIC, and in
    both cases copies the orientation tag through unchanged, so a browser
    would turn the picture a second time. Turn the pixels if they still lie
    the stored way, then write 1 into the tag."""
    d = bytearray(open(dst, "rb").read())
    seg = find_exif(d)
    if seg is None:
        return
    base, entry = seg
    e = "<" if d[base: base + 2] == b"II" else ">"
    tag = struct.unpack(e + "H", d[entry + 8: entry + 10])[0]
    if tag in (1, 0):
        return
    w, h = sips_size(dst)
    want_portrait = p["size"]["h"] > p["size"]["w"]
    if (h > w) != want_portrait:
        turn = {6: "90", 8: "-90", 5: "90", 7: "-90"}.get(tag, "90")
        subprocess.run(["sips", "-r", turn, dst], check=True, capture_output=True)
        d = bytearray(open(dst, "rb").read())
        seg = find_exif(d)
        if seg is None:
            return
        base, entry = seg
    elif tag == 3:
        subprocess.run(["sips", "-r", "180", dst], check=True, capture_output=True)
        d = bytearray(open(dst, "rb").read())
        base, entry = find_exif(d)
    d[entry + 8: entry + 10] = struct.pack(e + "H", 1)
    open(dst, "wb").write(d)

def find_exif(d):
    """(tiff header offset, offset of the Orientation entry) in a JPEG, or None."""
    i = 2
    while i + 4 <= len(d) and d[i] == 0xFF:
        m = d[i + 1]
        L = struct.unpack(">H", d[i + 2: i + 4])[0]
        if m == 0xE1 and d[i + 4: i + 10] == b"Exif\0\0":
            base = i + 10
            e = "<" if d[base: base + 2] == b"II" else ">"
            ifd = base + struct.unpack(e + "I", d[base + 4: base + 8])[0]
            n = struct.unpack(e + "H", d[ifd: ifd + 2])[0]
            for k in range(n):
                ent = ifd + 2 + k * 12
                if struct.unpack(e + "H", d[ent: ent + 2])[0] == 0x0112:
                    return base, ent
            return None
        if m == 0xDA:
            return None
        i += 2 + L
    return None

# --- the board ---------------------------------------------------------------

def taken(p):
    return datetime.strptime(p["taken"], "%Y-%m-%dT%H:%M:%S") if p.get("taken") else None

def day(dt):
    return f"{dt.year} {MONTHS[dt.month - 1]} {dt.day}"

# --- one print ---------------------------------------------------------------

def num(v):
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)

def coords(g):
    return (f"{abs(g['lat']):.4f} {'N' if g['lat'] >= 0 else 'S'} "
            f"{abs(g['lon']):.4f} {'E' if g['lon'] >= 0 else 'W'}")

def osm(g):
    return f"https://www.openstreetmap.org/?mlat={g['lat']}&mlon={g['lon']}#map=16/{g['lat']}/{g['lon']}"

def exposure_bits(p):
    e = p["exposure"]
    bits = []
    if e.get("shutter"):    bits.append(e["shutter"])
    if e.get("aperture"):   bits.append(f"f/{num(e['aperture'])}")
    if e.get("iso"):        bits.append(f"ISO {e['iso']}")
    if e.get("focal_mm"):   bits.append(f"{num(e['focal_mm'])} mm")
    return bits

def print_of(p, full, small):
    """One framed print."""
    dt = taken(p)
    when = f"{day(dt)}, {dt:%H:%M}" if dt else ""
    g = p.get("gps")
    place = p.get("place") or ""
    where = ", ".join(x for x in (place, coords(g) if g else "") if x)
    camera = (p["camera"].get("model") or "").strip()
    expo = " ".join(exposure_bits(p) + ([camera] if camera else []))

    rel_f, wf, hf = full
    rel_s, ws, hs = small
    ar = ws / hs
    alt = ", ".join(x for x in (place or "Photograph", day(dt) if dt else "") if x)
    data = [("when", when), ("where", where), ("map", osm(g) if g else ""), ("expo", expo)]
    attrs = "".join(f' data-{k}="{esc(v)}"' for k, v in data if v)

    wide = " is-wide" if ar > 1 else ""
    return (f'  <figure class="print{wide}" id="{esc(p["id"])}" style="--ar: {ar:.4f}">\n'
            f'    <a class="shot" href="./img/{esc(rel_f)}"{attrs}>'
            f'<img src="./img/{esc(rel_s)}" width="{ws}" height="{hs}" alt="{esc(alt)}" loading="lazy" decoding="async"></a>\n'
            f'  </figure>')

def board(photos):
    prints = [print_of(p, encode(p, "", FULL_PX, FULL_Q), encode(p, "-s", SMALL_PX, SMALL_Q)) for p in photos]
    return '\n<div class="board">\n' + "\n".join(prints) + '\n</div>\n'

# --- page --------------------------------------------------------------------

def head(n):
    return f"""<!doctype html>
<html lang="en" data-theme="wall" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Photos — deithzireael.net</title>
<meta name="description" content="{n} photographs by Jason Ho, with the time, the place and the exposure of each.">
<link rel="icon" href="../favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" type="image/png" sizes="192x192" href="../icon/dz-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="../icon/dz-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="image" href="../background/web/photos.jpg" media="(min-width: 701px)">
<link rel="preload" as="image" href="../background/web/photos-sm.jpg" media="(max-width: 700px)">
<link rel="stylesheet" href="../css/base.css">
<link rel="stylesheet" href="../css/works.css">
<link rel="stylesheet" href="../css/photos.css">
<!-- The look lives entirely in this one line. -->
<link rel="stylesheet" href="../css/theme-wall.css">
</head>
<body class="works photos">

<div class="ground is-warm" aria-hidden="true">
  <div class="frame is-on" data-frame="photos"></div>
  <div class="wash"></div>
</div>
<div class="bar bar-top" aria-hidden="true"></div>
<div class="bar bar-bot" aria-hidden="true"></div>

<div class="sheet">

<header class="top">
  <h1 class="title"><a class="home" href="../">DeithZireael<span class="tld">.net</span></a><span class="sep"> - </span>Photos</h1>
</header>

<main class="list">
"""

def foot():
    return """</main>
</div>

<dialog class="light" id="light" aria-label="Photograph">
  <button class="light-x" type="button" data-close aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4L4 16"/></svg></button>
  <button class="light-arrow prev" type="button" data-step="-1" aria-label="Previous"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 3.5L6 10l6.5 6.5"/></svg></button>
  <figure class="light-fig">
    <img alt="">
    <figcaption class="light-note"></figcaption>
  </figure>
  <button class="light-arrow next" type="button" data-step="1" aria-label="Next"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 3.5L14 10l-6.5 6.5"/></svg></button>
</dialog>

<script src="../js/works.js"></script>
</body>
</html>
"""

def main():
    if not os.path.exists(DATA):
        sys.exit(f"no {DATA}; run tools/extract_photos.py first")
    photos = [p for p in json.load(open(DATA))["photos"] if p.get("show", True)]
    undated = [p["file"] for p in photos if not p.get("taken")]
    if undated:
        sys.exit("these photographs have no capture time, so they cannot be ordered: " + ", ".join(undated))
    photos.sort(key=lambda p: (p["taken"], p["file"]), reverse=True)   # newest first
    os.makedirs(IMG_OUT, exist_ok=True)
    body = board(photos)
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(head(len(photos)) + body + foot())
    live = {p["id"] + s + ".jpg" for p in photos for s in ("", "-s")}
    for name in sorted(os.listdir(IMG_OUT)):
        if name not in live:
            os.remove(os.path.join(IMG_OUT, name))
            print("removed image of a hidden photograph:", name)
    print(f"wrote {len(photos)} photographs -> {OUT}/index.html")
    unplaced = [p["file"] for p in photos if not p.get("place")]
    if unplaced:
        print(f"  {len(unplaced)} photographs have no place name (set 'place' in photos.json):", ", ".join(unplaced))

if __name__ == "__main__":
    main()
