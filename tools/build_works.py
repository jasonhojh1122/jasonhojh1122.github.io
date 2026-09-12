#!/usr/bin/env python3
"""
build_works.py — generate the Works pages from the Portfolio repo.

    python3 tools/build_works.py [~/src/Portfolio]

Reads  every <portfolio>/projects/<project_id>/metadata.json. Each carries its
       own `project_id` (must equal the folder name), `show` (false keeps it
       off the page without deleting it) and `feature` (0 = not featured;
       featured projects lead the page, lowest number first, then the rest
       newest first by date.end then date.start). The structure is fixed by projects/metadata-schema.json
       and checked with ajv (`npm run verify` in the portfolio) before
       building, when node is installed.
Writes works/index.html                 (one page; each project is a box with an id)
       works/img/<slug>/<image>.jpg     (resized with sips, max 1400px, JPEG 80)

Only the standard library and macOS `sips` are used. Re-running is cheap:
images are only re-encoded when the source is newer than the output. A project
that is no longer listed in index.json disappears from the page and its
works/img/<slug>/ folder is deleted.
"""

import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, ".."))
PORTFOLIO = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/src/Portfolio")
PROJECTS = os.path.join(PORTFOLIO, "projects")
OUT = os.path.join(SITE, "works")
IMG_OUT = os.path.join(OUT, "img")

MAX_PX = 1400
JPEG_Q = 80
LANG = "en"

# --- editorial ---------------------------------------------------------------

GROUPS = [
    ("commercial-game", "Commercial"),
    ("game",            "Games"),
    ("tool",            "Tools & apps"),
    ("creative-coding", "Creative coding & interactive"),
    ("art",             "Art"),
]

# Corrections for fields that read like working notes in the metadata.
# (Fix them upstream in Portfolio and delete the entry here.)
FIX_LINK_LABEL = {
    "Source (private-ish repo: LittleGirl)": "Source",
}
FIX_TEAM = {
    "3 contributors on the repo": "3 people",
}
EXTRA_LINKS = {
    "steam-library-viewer": [("Live on this site", "../steam/index.html")],
}

YT_RE = re.compile(r"(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]{6,})")

# --- helpers -----------------------------------------------------------------

def esc(s):
    return html.escape(str(s), quote=True)

def t(v):
    """Pick the site language out of a bilingual field."""
    if isinstance(v, dict):
        return v.get(LANG) or next(iter(v.values()), "")
    return v or ""

def is_todo(s):
    return str(s).strip().upper().startswith("TODO")

def clean_list(v):
    return [t(x) for x in (t(v) if isinstance(v, dict) else (v or [])) if not is_todo(t(x))]

def strip_note(s):
    """Drop a trailing '(…)' working note, e.g. 'PS5 (per my own account…)'."""
    return re.sub(r"\s*\((?:per my own|top contributor)[^)]*\)", "", s).strip()

MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

def fmt_ym(v):
    """'2021-10' -> '2021 Oct'; '2020' -> '2020'; None (still going) -> 'ongoing'."""
    if v is None:
        return "ongoing"
    if "-" in v:
        y, m = v.split("-")
        return f"{y} {MONTHS[int(m) - 1]}"
    return v

def date_line(d):
    """'2021 Oct – 2022 May' (the release date is its own row, see release_line)."""
    start, end = d["start"], d["end"]
    if start == end:
        line = fmt_ym(start)
    elif end and "-" in start and "-" in end and start[:4] == end[:4]:
        line = f"{fmt_ym(start)} – {fmt_ym(end).split()[1]}"      # 2022 Mar – Apr
    else:
        line = f"{fmt_ym(start)} – {fmt_ym(end)}"
    return line

def release_line(d):
    """'2022 May 17', or None when the project never shipped."""
    rel = d.get("release")
    if not rel:
        return None
    y, m, day = rel.split("-")
    return f"{y} {MONTHS[int(m) - 1]} {int(day)}"

def sort_key(p):
    """Featured first by feature number; then everyone else newest first,
    by end date then start date. A null end (ongoing) counts as the newest end."""
    d = p["date"]
    def ym(v, fill):
        if v is None:
            return "9999-99"
        return v if "-" in v else v + fill
    if p["feature"] > 0:
        return (0, p["feature"], "", "", p["name"].lower())
    # invert the strings for a descending sort inside an ascending key
    return (1, 0, inv(ym(d["end"], "-99")), inv(ym(d["start"], "-00")), p["name"].lower())

def inv(s):
    return "".join(chr(0x7f - ord(c)) for c in s)

def sips_size(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                         capture_output=True, text=True).stdout
    w = int(re.search(r"pixelWidth:\s*(\d+)", out).group(1))
    h = int(re.search(r"pixelHeight:\s*(\d+)", out).group(1))
    return w, h

def build_image(slug, name):
    """Copy/encode one image into works/img/<slug>/. Returns (relname, w, h)."""
    src = os.path.join(PROJECTS, slug, "images", name)
    if not os.path.exists(src):
        sys.exit(f"{slug}: media file not found: images/{name}")
    dst_dir = os.path.join(IMG_OUT, slug)
    os.makedirs(dst_dir, exist_ok=True)
    stem, ext = os.path.splitext(name)
    if ext.lower() == ".svg":   # vectors are copied as they are
        dst = os.path.join(dst_dir, name)
        if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):
            with open(src, "rb") as f, open(dst, "wb") as g:
                g.write(f.read())
        m = re.search(rb'width="(\d+)"\s+height="(\d+)"', open(src, "rb").read())
        w, h = (int(m.group(1)), int(m.group(2))) if m else (1, 1)
        return name, w, h
    dst = os.path.join(dst_dir, stem + ".jpg")
    if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):
        w, h = sips_size(src)
        cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(JPEG_Q)]
        if max(w, h) > MAX_PX:
            cmd += ["-Z", str(MAX_PX)]
        subprocess.run(cmd + [src, "--out", dst], check=True, capture_output=True)
    w, h = sips_size(dst)
    return stem + ".jpg", w, h

# --- load --------------------------------------------------------------------

def verify():
    """Check every metadata.json against the schema with ajv, when node is here."""
    if not shutil.which("npm"):
        print("note: node/npm not found — skipping `npm run verify`; install node and run it in", PORTFOLIO)
        return
    if not os.path.isdir(os.path.join(PORTFOLIO, "node_modules")):
        print("note: run `npm install` in", PORTFOLIO, "to enable the schema check; skipping")
        return
    r = subprocess.run(["npm", "run", "--silent", "verify"], cwd=PORTFOLIO, capture_output=True, text=True)
    if r.returncode != 0:
        lines = [l for l in (r.stdout + r.stderr).splitlines() if l.strip() and not l.endswith(" valid")]
        sys.exit("metadata failed schema validation:\n" + "\n".join(lines))
    print("schema: all metadata valid")

def load():
    projects = []
    for f in sorted(glob.glob(os.path.join(PROJECTS, "*", "metadata.json"))):
        folder = os.path.basename(os.path.dirname(f))
        m = json.load(open(f))
        if m.get("project_id") != folder:
            sys.exit(f"{f}: project_id {m.get('project_id')!r} does not match its folder {folder!r}")
        if not m.get("show", True):
            continue
        slug = folder
        p = {
            "slug": slug,
            "feature": int(m.get("feature", 0)),
            "name": t(m["name"]),
            "category": m["category"],
            "tagline": t(m.get("tagline")),
            "date": m.get("date", {}),
            "team": FIX_TEAM.get(t(m.get("team", {}).get("note", {})).split(":")[0].strip(),
                                 t(m.get("team", {}).get("note", {})).split(":")[0].strip()),
            "roles": [strip_note(r) for r in clean_list(m.get("my_role", {}))],
            "contributions": clean_list(m.get("contributions", {})),
            "tech": [x for x in m.get("tech", []) if not is_todo(x)],
            "platforms": [strip_note(x) for x in m.get("platforms", [])],
            "awards": [t(a) for a in m.get("awards", [])],
            "links": [(FIX_LINK_LABEL.get(t(l["label"]), t(l["label"])), l["url"])
                      for l in m.get("links", [])],
            "reel": [],       # ("video", youtube id) or ("image", rel, w, h), in metadata order
        }
        p["links"] += EXTRA_LINKS.get(slug, [])
        for entry in m.get("media", []):
            yt = YT_RE.search(entry)
            if yt:
                p["reel"].append(("video", yt.group(1)))
            else:
                p["reel"].append(("image",) + build_image(slug, entry))
        projects.append(p)
    projects.sort(key=sort_key)
    return projects

# --- html --------------------------------------------------------------------


def head():
    return """<!doctype html>
<html lang="en" data-theme="wall" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Works — deithzireael.net</title>
<meta name="description" content="Games, tools and experiments by Jason Ho, 2020 to now.">
<link rel="icon" href="../favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" type="image/png" sizes="192x192" href="../icon/dz-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="../icon/dz-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="image" href="../background/web/works.jpg" media="(min-width: 701px)">
<link rel="preload" as="image" href="../background/web/works-sm.jpg" media="(max-width: 700px)">
<link rel="stylesheet" href="../css/base.css">
<link rel="stylesheet" href="../css/works.css">
<!-- The look lives entirely in this one line. -->
<link rel="stylesheet" href="../css/theme-wall.css">
</head>
<body class="works">

<div class="ground is-warm" aria-hidden="true">
  <div class="frame is-on" data-frame="works"></div>
  <div class="wash"></div>
</div>
<div class="bar bar-top" aria-hidden="true"></div>
<div class="bar bar-bot" aria-hidden="true"></div>

<div class="sheet">

<header class="top">
  <h1 class="title"><a class="home" href="../">DeithZireael<span class="tld">.net</span></a><span class="sep"> - </span>Works</h1>
</header>

<main class="list">
"""

def foot():
    return """</main>
</div>

<dialog class="light" id="light" aria-label="Screenshot">
  <button class="light-x" type="button" data-close aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4L4 16"/></svg></button>
  <button class="light-arrow prev" type="button" data-step="-1" aria-label="Previous"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 3.5L6 10l6.5 6.5"/></svg></button>
  <img alt="">
  <button class="light-arrow next" type="button" data-step="1" aria-label="Next"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 3.5L14 10l-6.5 6.5"/></svg></button>
</dialog>

<script src="../js/works.js"></script>
</body>
</html>
"""

def media(p):
    slug = p["slug"]
    slides = []
    shot_n = 0
    for item in p["reel"]:
        if item[0] == "video":
            vid = item[1]
            slides.append(
                f'      <div class="slide is-video" data-yt="{esc(vid)}">'
                f'<img src="https://i.ytimg.com/vi/{esc(vid)}/hqdefault.jpg" alt="" loading="lazy" decoding="async">'
                f'<button class="play" type="button" aria-label="Play video"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2l14 8-14 8z"/></svg></button></div>')
        else:
            _, rel, w, h = item
            shot_n += 1
            slides.append(
                f'      <a class="slide shot" href="./img/{slug}/{esc(rel)}">'
                f'<img src="./img/{slug}/{esc(rel)}" width="{w}" height="{h}" alt="{esc(p["name"])} — screenshot {shot_n}" loading="lazy" decoding="async"></a>')
    if not slides:
        slides.append(f'      <div class="slide is-empty" aria-hidden="true"><span>{esc(p["name"][0])}</span></div>')
    dots = ""
    if len(slides) > 1:
        btns = []
        for i in range(len(slides)):
            sel = ' aria-selected="true"' if i == 0 else ""
            btns.append(f'      <button type="button" role="tab" aria-label="Slide {i+1}"{sel}></button>\n')
        dots = '    <div class="dots" role="tablist" aria-label="Slides">\n' + "".join(btns) + "    </div>\n"
    return ('  <div class="media">\n    <div class="reel" tabindex="0">\n' +
            "\n".join(slides) + "\n    </div>\n" + dots + "  </div>\n")

def side(p):
    return '  <div class="side">\n' + facts(p) + links(p) + "  </div>\n"

def head_of(p):
    # A project with no end date is still in progress.
    status = ' <span class="status">ongoing</span>' if p["date"]["end"] is None else ""
    return ('  <header class="box-head">\n'
            f'    <h2 class="name">{esc(p["name"])}{status}</h2>\n'
            f'    <p class="tagline">{esc(p["tagline"])}</p>\n'
            '  </header>\n')

def info(p):
    # The description in metadata.json is deliberately not shown: it restates
    # the tagline at store-blurb length. What I did is the substance here.
    # With no recognition list, what I did takes the whole width.
    did, won = [], []
    if p["contributions"]:
        did.append('    <h3>What I did</h3>\n    <ul>\n' +
                   "".join(f"      <li>{esc(c)}</li>\n" for c in p["contributions"]) + "    </ul>\n")
    # reflection and context in metadata.json are private notes: not shown.
    if p["awards"]:
        won.append('    <h3>Recognition</h3>\n    <ul>\n' +
                   "".join(f"      <li>{esc(a)}</li>\n" for a in p["awards"]) + "    </ul>\n")
    if not did and not won:
        return ""
    out = '  <div class="info">\n' if won else '  <div class="info is-wide">\n'
    if did: out += '  <section class="did">\n' + "".join(did) + "  </section>\n"
    if won: out += '  <section class="won">\n' + "".join(won) + "  </section>\n"
    return out + "  </div>\n"

def facts(p):
    rows = [("When", date_line(p["date"]))]
    rel = release_line(p["date"])
    if rel:            rows.append(("Released", rel))
    if p["roles"]:     rows.append(("Role", ", ".join(p["roles"])))
    if p["team"]:      rows.append(("Team", p["team"]))
    if p["platforms"]: rows.append(("Platform", ", ".join(p["platforms"])))
    if p["tech"]:      rows.append(("Made with", ", ".join(p["tech"])))
    return ('    <dl class="facts">\n' +
            "".join(f"      <dt>{esc(k)}</dt><dd>{esc(v)}</dd>\n" for k, v in rows) +
            "    </dl>\n")

def links(p):
    if not p["links"]:
        return ""
    rows = []
    for l, u in p["links"]:
        ext = ' rel="noopener" target="_blank"' if u.startswith("http") else ""
        rows.append(f'      <a href="{esc(u)}"{ext}>{esc(l)}</a>')
    return '    <p class="links">\n' + "\n".join(rows) + "\n    </p>\n"

def box(p):
    return f'\n<article class="box" id="{esc(p["slug"])}">\n' + head_of(p) + media(p) + side(p) + info(p) + "</article>\n"

def index_page(projects):
    return head() + "".join(box(p) for p in projects) + foot()

# --- main --------------------------------------------------------------------

def main():
    if not os.path.isdir(PROJECTS):
        sys.exit(f"no projects dir at {PROJECTS}")
    verify()
    projects = load()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(index_page(projects))
    # images belong to listed projects only; anything else is left over
    live = {p["slug"] for p in projects}
    for name in sorted(os.listdir(IMG_OUT)) if os.path.isdir(IMG_OUT) else []:
        path = os.path.join(IMG_OUT, name)
        if os.path.isdir(path) and name not in live:
            shutil.rmtree(path)
            print("removed images of hidden project:", name)
    shots = sum(1 for p in projects for i in p["reel"] if i[0] == "image")
    vids = sum(1 for p in projects for i in p["reel"] if i[0] == "video")
    print(f"wrote {len(projects)} projects, {shots} screenshots, {vids} videos -> {OUT}/index.html")
    for p in projects:
        if not p["reel"]:
            print("  no media:", p["slug"])

if __name__ == "__main__":
    main()
