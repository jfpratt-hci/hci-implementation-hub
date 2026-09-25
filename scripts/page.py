#!/usr/bin/env python3
"""Build public/index.html from the Hub page (implementation-hub.html). Run after any change to the page."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hub" / "implementation-hub.html"
html = SRC.read_text()
html = html.replace('Open this page in Claude to load the project database.', 'Could not reach the Hub server.')
html = html.replace('Open this page in Claude to make changes', 'The Hub server is not reachable')
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="color-scheme" content="light dark">\n'
        '<script src="/teams-js/MicrosoftTeams.min.js"></script>\n<script src="/hub-data.js"></script>\n'
        '<style>body{margin:0} img{max-width:100%} [hidden]{display:none!important}</style>\n')
i = html.index('<div class="app">')
(ROOT / "public" / "index.html").write_text(head + html[:i] + "</head>\n<body>\n" + html[i:] + "\n</body>\n</html>\n")
print("public/index.html written from", SRC)
