#!/usr/bin/env python3
"""
extract_photos.py — read the metadata out of every photograph in the
Portfolio and write it to one JSON file.

    python3 tools/extract_photos.py [~/src/Portfolio]

Reads  <portfolio>/Photos/*.{jpg,jpeg,png,heic}
Writes <portfolio>/Photos/photos.json

Only the standard library is used. Each file is read directly:
  JPEG   the Exif block in APP1 (and the XMP packet, if any)
  PNG    the eXIf chunk, or the XMP packet in an iTXt chunk (Lightroom exports)
  HEIC   the 'Exif' item located through the meta/iinf/iloc boxes
Spotlight (mdls) and sips are not used for the data: they convert the
camera's local time through the Mac's own time zone and lose the offset.

Two keys on each photo are yours to edit and survive a re-run: `show`
(false keeps a photo off the page) and `place` (a short place name; it is
pre-filled from the City that Lightroom wrote, and otherwise left blank).
Everything else is overwritten from the files each time.
"""

import glob
import json
import os
import re
import struct
import subprocess
import sys
from datetime import datetime

PORTFOLIO = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/src/Portfolio")
PHOTOS = os.path.join(PORTFOLIO, "Photos")
OUT = os.path.join(PHOTOS, "photos.json")
EXTS = (".jpg", ".jpeg", ".png", ".heic")
KEEP = ("show", "place")        # hand-edited keys carried over from the last run

# --- TIFF / Exif -------------------------------------------------------------

TAGS0 = {0x010F: "make", 0x0110: "model", 0x0112: "orientation", 0x0131: "software",
         0x8769: "_exif", 0x8825: "_gps"}
TAGSX = {0x829A: "exposure_time", 0x829D: "f_number", 0x8822: "program", 0x8827: "iso",
         0x9003: "datetime", 0x9011: "offset", 0x920A: "focal", 0xA405: "focal35",
         0xA433: "lens_make", 0xA434: "lens", 0xA002: "px_w", 0xA003: "px_h"}
TAGSG = {1: "lat_ref", 2: "lat", 3: "lon_ref", 4: "lon", 5: "alt_ref", 6: "alt",
         7: "gps_time", 29: "gps_date"}
SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}

def read_ifd(d, base, off, e, tags, out):
    """Read one IFD of a TIFF block `d` (TIFF header at `base`) into `out`."""
    try:
        n = struct.unpack(e + "H", d[base + off: base + off + 2])[0]
    except struct.error:
        return
    for i in range(n):
        p = base + off + 2 + i * 12
        try:
            tag, typ, cnt = struct.unpack(e + "HHI", d[p: p + 8])
        except struct.error:
            return
        if tag not in tags or typ not in SIZES:
            continue
        size = SIZES[typ] * cnt
        vp = p + 8 if size <= 4 else base + struct.unpack(e + "I", d[p + 8: p + 12])[0]
        raw = d[vp: vp + size]
        if typ == 2:
            val = raw.split(b"\0")[0].decode("utf-8", "replace").strip()
        elif typ in (5, 10):
            f = e + ("II" if typ == 5 else "ii")
            pairs = [struct.unpack(f, raw[k: k + 8]) for k in range(0, size, 8)]
            val = [a / b if b else 0.0 for a, b in pairs]
            if len(val) == 1:
                val = val[0]
        elif typ in (3, 4, 9):
            f = {3: "H", 4: "I", 9: "i"}[typ]
            val = list(struct.unpack(e + f * cnt, raw))
            if len(val) == 1:
                val = val[0]
        else:
            val = raw
        out[tags[tag]] = val

def parse_tiff(d, base=0):
    e = {b"II": "<", b"MM": ">"}.get(d[base: base + 2])
    if not e:
        return {}
    out = {}
    ifd0 = struct.unpack(e + "I", d[base + 4: base + 8])[0]
    read_ifd(d, base, ifd0, e, TAGS0, out)
    if "_exif" in out:
        read_ifd(d, base, out.pop("_exif"), e, TAGSX, out)
    if "_gps" in out:
        read_ifd(d, base, out.pop("_gps"), e, TAGSG, out)
    return out

# --- XMP ---------------------------------------------------------------------

XMP_ATTR = re.compile(r'\b([A-Za-z0-9]+:[A-Za-z0-9]+)="([^"]*)"')
XMP_SEQ = re.compile(r"<([A-Za-z0-9]+:[A-Za-z0-9]+)>\s*<rdf:(?:Seq|Alt|Bag)>\s*<rdf:li[^>]*>([^<]*)</rdf:li>", re.S)

def parse_xmp(text):
    x = dict(XMP_ATTR.findall(text))
    x.update({k: v for k, v in XMP_SEQ.findall(text)})
    return x

def xmp_rational(s):
    if s is None:
        return None
    try:
        a, b = s.split("/")
        return float(a) / float(b)
    except ValueError:
        return float(s)

def xmp_coord(s):
    """'45,26.0417N' -> 45.4340 (XMP writes degrees,decimal-minutes + hemisphere)."""
    if not s:
        return None
    m = re.match(r"([\d.]+),([\d.]+)(?:,([\d.]+))?([NSEW])", s)
    if not m:
        return None
    deg, mn, sec, h = m.groups()
    v = float(deg) + float(mn) / 60 + (float(sec) / 3600 if sec else 0)
    return -v if h in "SW" else v

def xmp_to_fields(x):
    out = {}
    def put(k, v):
        if v not in (None, ""):
            out[k] = v
    put("make", x.get("tiff:Make")); put("model", x.get("tiff:Model"))
    put("software", x.get("xmp:CreatorTool"))
    if "tiff:Orientation" in x: put("orientation", int(x["tiff:Orientation"]))
    put("lens", x.get("exifEX:LensModel") or x.get("aux:Lens"))
    put("lens_make", x.get("exifEX:LensMake"))
    put("datetime_iso", x.get("exif:DateTimeOriginal") or x.get("photoshop:DateCreated") or x.get("xmp:CreateDate"))
    put("exposure_time", xmp_rational(x.get("exif:ExposureTime")))
    put("f_number", xmp_rational(x.get("exif:FNumber")))
    if "exif:ISOSpeedRatings" in x: put("iso", int(x["exif:ISOSpeedRatings"]))
    if "exif:ExposureProgram" in x: put("program", int(x["exif:ExposureProgram"]))
    put("focal", xmp_rational(x.get("exif:FocalLength")))
    if "exif:FocalLengthIn35mmFilm" in x: put("focal35", int(x["exif:FocalLengthIn35mmFilm"]))
    put("lat", xmp_coord(x.get("exif:GPSLatitude")))
    put("lon", xmp_coord(x.get("exif:GPSLongitude")))
    put("alt", xmp_rational(x.get("exif:GPSAltitude")))
    if x.get("exif:GPSAltitudeRef") == "1" and "alt" in out: out["alt"] = -out["alt"]
    put("city", x.get("photoshop:City")); put("state", x.get("photoshop:State"))
    put("country", x.get("photoshop:Country")); put("location", x.get("Iptc4xmpCore:Location"))
    return out

# --- containers --------------------------------------------------------------

def blocks_jpeg(d):
    exif = xmp = None
    i = 2
    while i + 4 <= len(d) and d[i] == 0xFF:
        m = d[i + 1]
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2; continue
        L = struct.unpack(">H", d[i + 2: i + 4])[0]
        seg = d[i + 4: i + 2 + L]
        if m == 0xE1 and seg.startswith(b"Exif\0\0"):
            exif = seg[6:]
        elif m == 0xE1 and seg.startswith(b"http://ns.adobe.com/xap/1.0/\0"):
            xmp = seg[29:].decode("utf-8", "replace")
        elif m == 0xDA:
            break
        i += 2 + L
    return exif, xmp

def blocks_png(d):
    exif = xmp = None
    i = 8
    while i + 8 <= len(d):
        L = struct.unpack(">I", d[i: i + 4])[0]
        t = d[i + 4: i + 8]
        body = d[i + 8: i + 8 + L]
        if t == b"eXIf":
            exif = body
        elif t == b"iTXt" and body.startswith(b"XML:com.adobe.xmp\0"):
            rest = body[len(b"XML:com.adobe.xmp\0"):]
            comp = rest[0]
            payload = rest[2:]
            payload = payload.split(b"\0", 2)[2] if payload.count(b"\0") >= 2 else payload
            if comp == 0:
                xmp = payload.decode("utf-8", "replace")
        elif t == b"IEND":
            break
        i += 12 + L
    return exif, xmp

def blocks_heic(d):
    """Find the Exif item (and an XMP mime item) through meta > iinf + iloc."""
    def walk(off, end, into):
        while off + 8 <= end:
            L, t = struct.unpack(">I4s", d[off: off + 8]); hdr = 8
            if L == 1:
                L = struct.unpack(">Q", d[off + 8: off + 16])[0]; hdr = 16
            if L == 0:
                L = end - off
            into.append((t, off + hdr, off + L))
            off += L
    top = []; walk(0, len(d), top)
    meta = next((b for b in top if b[0] == b"meta"), None)
    if not meta:
        return None, None
    inner = []; walk(meta[1] + 4, meta[2], inner)
    items = {}   # id -> type/mime
    iinf = next((b for b in inner if b[0] == b"iinf"), None)
    if iinf:
        ver = d[iinf[1]]
        entries = []; walk(iinf[1] + (6 if ver == 0 else 8), iinf[2], entries)
        for t, s, e in entries:
            if t != b"infe":
                continue
            v = d[s]
            if v >= 2:
                iid = struct.unpack(">H", d[s + 4: s + 6])[0] if v == 2 else struct.unpack(">I", d[s + 4: s + 8])[0]
                p = s + (8 if v == 2 else 10)
                ityp = d[p: p + 4]
                name = d[p + 4: e].split(b"\0")[0]
                items[iid] = (ityp, name)
    iloc = next((b for b in inner if b[0] == b"iloc"), None)
    if not iloc:
        return None, None
    s = iloc[1]; ver = d[s]
    b1, b2 = d[s + 4], d[s + 5]
    osz, lsz, bsz, isz = b1 >> 4, b1 & 15, b2 >> 4, (b2 & 15 if ver in (1, 2) else 0)
    p = s + 6
    def rd(n):
        nonlocal p
        v = {0: 0, 4: None, 8: None}[n]
        if n == 4: v = struct.unpack(">I", d[p: p + 4])[0]
        if n == 8: v = struct.unpack(">Q", d[p: p + 8])[0]
        p += n
        return v
    if ver < 2:
        count = struct.unpack(">H", d[p: p + 2])[0]; p += 2
    else:
        count = struct.unpack(">I", d[p: p + 4])[0]; p += 4
    locs = {}
    for _ in range(count):
        if ver < 2:
            iid = struct.unpack(">H", d[p: p + 2])[0]; p += 2
        else:
            iid = struct.unpack(">I", d[p: p + 4])[0]; p += 4
        if ver in (1, 2):
            p += 2   # construction method
        p += 2       # data reference index
        base = rd(bsz)
        n = struct.unpack(">H", d[p: p + 2])[0]; p += 2
        ext = []
        for _ in range(n):
            if isz: rd(isz)
            ext.append((base + rd(osz), rd(lsz)))
        locs[iid] = ext
    exif = xmp = None
    for iid, (ityp, name) in items.items():
        if iid not in locs:
            continue
        data = b"".join(d[o: o + n] for o, n in locs[iid])
        if ityp == b"Exif":
            skip = struct.unpack(">I", data[:4])[0]
            exif = data[4 + skip:]
        elif ityp == b"mime" and b"xap" in name:
            xmp = data.decode("utf-8", "replace")
    return exif, xmp

# --- one photograph ----------------------------------------------------------

def sips_size(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                         capture_output=True, text=True).stdout
    w = int(re.search(r"pixelWidth:\s*(\d+)", out).group(1))
    h = int(re.search(r"pixelHeight:\s*(\d+)", out).group(1))
    return w, h

def shutter(t):
    """0.01667 -> '1/60'; 2.5 -> '2.5'."""
    if not t:
        return None
    if t >= 1:
        return f"{t:g}"
    return f"1/{round(1 / t)}"

def clean_num(v):
    return round(v, 4) if isinstance(v, float) else v

PROGRAMS = {1: "manual", 2: "program", 3: "aperture priority", 4: "shutter priority",
            5: "creative", 6: "action", 7: "portrait", 8: "landscape"}

def read_photo(path):
    d = open(path, "rb").read()
    ext = os.path.splitext(path)[1].lower()
    exif_raw, xmp_raw = {".jpg": blocks_jpeg, ".jpeg": blocks_jpeg, ".png": blocks_png, ".heic": blocks_heic}[ext](d)
    f = {}
    if xmp_raw:
        f.update(xmp_to_fields(parse_xmp(xmp_raw)))
    if exif_raw:
        f.update(parse_tiff(exif_raw))      # Exif wins where both carry a value

    # capture time, as the camera wrote it (local to where it was taken)
    taken = offset = None
    if f.get("datetime"):
        try:
            dt = datetime.strptime(f["datetime"], "%Y:%m:%d %H:%M:%S")
            taken = dt.strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            pass
        offset = f.get("offset")
    if not taken and f.get("datetime_iso"):
        m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?([+-]\d\d:\d\d|Z)?", f["datetime_iso"])
        if m:
            taken, offset = m.group(1), m.group(2)
    if not offset and f.get("datetime_iso"):
        m = re.search(r"([+-]\d\d:\d\d)$", f["datetime_iso"])
        if m: offset = m.group(1)

    lat, lon = f.get("lat"), f.get("lon")
    if isinstance(lat, list):
        lat = lat[0] + lat[1] / 60 + lat[2] / 3600
        if f.get("lat_ref") == "S": lat = -lat
    if isinstance(lon, list):
        lon = lon[0] + lon[1] / 60 + lon[2] / 3600
        if f.get("lon_ref") == "W": lon = -lon
    alt = f.get("alt")
    if isinstance(alt, float) and f.get("alt_ref") == 1:
        alt = -alt

    w, h = sips_size(path)
    orient = f.get("orientation") or 1
    if orient in (5, 6, 7, 8):
        w, h = h, w          # sips reports the stored pixels; the picture is rotated

    model = (f.get("model") or "").replace("_", " ").strip()
    return {
        "file": os.path.basename(path),
        "id": re.sub(r"[^a-z0-9]+", "-", os.path.splitext(os.path.basename(path))[0].lower()).strip("-"),
        "show": True,
        "place": f.get("city") or "",
        "taken": taken,
        "utc_offset": offset,
        "gps": ({"lat": round(lat, 6), "lon": round(lon, 6),
                 "alt_m": round(alt, 1) if isinstance(alt, float) else None}
                if lat is not None and lon is not None else None),
        "camera": {"make": (f.get("make") or "").strip().title().replace("Fujifilm", "Fujifilm") or None,
                   "model": model or None,
                   "lens": f.get("lens") or None},
        "exposure": {"shutter": shutter(f.get("exposure_time")),
                     "shutter_s": clean_num(f.get("exposure_time")),
                     "aperture": clean_num(f.get("f_number")),
                     "iso": f.get("iso"),
                     "focal_mm": clean_num(f.get("focal")),
                     "focal_35mm": f.get("focal35"),
                     "program": PROGRAMS.get(f.get("program"))},
        "size": {"w": w, "h": h},
        "orientation": orient,
        "location_note": {k: f[k] for k in ("location", "city", "state", "country") if f.get(k)} or None,
        "software": f.get("software") or None,
    }

# --- main --------------------------------------------------------------------

def main():
    if not os.path.isdir(PHOTOS):
        sys.exit(f"no Photos dir at {PHOTOS}")
    old = {}
    if os.path.exists(OUT):
        for p in json.load(open(OUT)).get("photos", []):
            old[p["file"]] = p
    photos = []
    missing_time, missing_gps = [], []
    for path in sorted(glob.glob(os.path.join(PHOTOS, "*"))):
        if not path.lower().endswith(EXTS):
            continue
        p = read_photo(path)
        prev = old.get(p["file"])
        if prev:
            for k in KEEP:
                if k in prev and prev[k] not in (None, ""):
                    p[k] = prev[k]
        if not p["taken"]: missing_time.append(p["file"])
        if not p["gps"]: missing_gps.append(p["file"])
        photos.append(p)
    photos.sort(key=lambda p: (p["taken"] or "", p["file"]))
    doc = {
        "_readme": "Generated by tools/extract_photos.py in the site repo. Edit only `show` and `place`; everything else is rewritten from the files.",
        "photos": photos,
    }
    with open(OUT, "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(photos)} photos -> {OUT}")
    if missing_time: print("  no capture time:", ", ".join(missing_time))
    if missing_gps:  print("  no GPS:", ", ".join(missing_gps))

if __name__ == "__main__":
    main()
