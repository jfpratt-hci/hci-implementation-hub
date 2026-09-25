#!/usr/bin/env python3
"""One time build: seed data from the Claude Hub export, produce public/index.html from the Hub page,
draw the Teams icons and write the manifest. Re run only when the Hub page or the seed data changes."""
import json, os, sys, uuid, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC_HTML = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "implementation-hub.html"
EXPORT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT.parent / "export"
HOST = os.environ.get("HOST", "hub.hci-tv.com")
COLS = ["projects","tasks","decisions","meetings","interfaces","people","devices","releases","deployments","components","catalog","access","network","template","team","shots"]

# 1. seed data
(ROOT / "data").mkdir(exist_ok=True)
for col in COLS:
    out = {}
    d = EXPORT / col
    if d.is_dir():
        for f in sorted(d.glob("*.json")):
            doc = json.loads(f.read_text())
            if isinstance(doc, dict) and "data" in doc and "id" in doc: doc = doc["data"]
            out[f.stem] = doc
    (ROOT / "data" / f"{col}.json").write_text(json.dumps(out, indent=1))
    print(f"data/{col}.json: {len(out)} documents")

# 2. index.html from the Hub page
html = SRC_HTML.read_text()
html = html.replace(
    'try{const v=JSON.parse(localStorage.getItem("hub.nav")||"{}");',
    'try{const v=window.HUB_PRESELECT||JSON.parse(localStorage.getItem("hub.nav")||"{}");')
html = html.replace('Open this page in Claude to load the project database.', 'Could not reach the Hub server.')
html = html.replace('Open this page in Claude to make changes', 'The Hub server is not reachable')
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="color-scheme" content="light dark">\n'
        '<script src="/teams-js/MicrosoftTeams.min.js"></script>\n<script src="/hub-data.js"></script>\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)} body{margin:0} img{max-width:100%} [hidden]{display:none!important}</style>\n')
# the Hub page starts with <title> and <style>; move them into head, keep the rest as body
i = html.index("<div class=\"app\">")
head_part, body_part = html[:i], html[i:]
(ROOT / "public").mkdir(exist_ok=True)
(ROOT / "public" / "index.html").write_text(head + head_part + "</head>\n<body>\n" + body_part + "\n</body>\n</html>\n")
print("public/index.html written")

# 3. icons
from PIL import Image, ImageDraw, ImageFont
def font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return None
man = ROOT / "manifest"; man.mkdir(exist_ok=True)
im = Image.new("RGBA", (192, 192), (11, 107, 203, 255)); dr = ImageDraw.Draw(im)
f = font(64)
if f:
    dr.text((96, 96), "HCI", fill="white", font=f, anchor="mm")
else:
    for k in range(3): dr.rectangle([40, 52 + k * 34, 152, 72 + k * 34], fill="white")
im.save(man / "color.png")
ol = Image.new("RGBA", (32, 32), (0, 0, 0, 0)); dr = ImageDraw.Draw(ol)
dr.rounded_rectangle([2, 2, 29, 29], radius=6, outline="white", width=3)
for k in range(3): dr.rectangle([9, 9 + k * 5, 23, 11 + k * 5], fill="white")
ol.save(man / "outline.png")
print("icons drawn")

# 4. manifest
tpl = json.loads((ROOT / "manifest" / "manifest.template.json").read_text())
ids = ROOT / "manifest" / ".appid"
app_id = ids.read_text().strip() if ids.exists() else str(uuid.uuid4())
ids.write_text(app_id)
entra = os.environ.get("ENTRA_APP_ID", "").strip()
if not entra: tpl.pop("webApplicationInfo", None)
text = json.dumps(tpl, indent=2).replace("__APP_ID__", app_id).replace("__HOST__", HOST).replace("__ENTRA_APP_ID__", entra)
(man / "manifest.json").write_text(text)
(ROOT / "dist").mkdir(exist_ok=True)
with zipfile.ZipFile(ROOT / "dist" / "hci-implementation-hub-teams-app.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for n in ["manifest.json", "color.png", "outline.png"]: z.write(man / n, n)
print(f"manifest for {HOST}, app id {app_id}; package at dist/hci-implementation-hub-teams-app.zip")
