#!/usr/bin/env python3
"""Build the install page for Banner Plus.

    python3 bookmarklet/build.py
    python3 bookmarklet/build.py --base https://mgrau.github.io/banner_plus

Writes docs/index.html plus a copy of each tool it publishes. Point GitHub Pages
at "main /docs" and the page is live.

LOADER, NOT SELF-CONTAINED

Each bookmark is a one-liner that injects the script from this site, with a
cache-buster so a fix is live on the next click. The alternative — the whole
program encoded into the bookmark URL — means re-dragging the link after every
change, and console.js is large enough that a 100 KB href stalled the Pages
build outright.

The trade is that a campus sending a script-src Content-Security-Policy would
block it. Browsers exempt bookmarklets from CSP but not the scripts a bookmarklet
injects. If that ever happens here, devserve.py serves the same drag links from
localhost.

ENCODING

Everything HTML-special is percent-encoded. Leaving "&" raw once corrupted a
shipped bookmarklet: an href is parsed as an HTML attribute before anything
treats it as a URL, so the parser turned the string "&quot;" inside the script
back into a quote character. The build verifies its own output by re-reading the
finished page and decoding it the way a browser would.
"""

from __future__ import annotations

import argparse
import html as html_lib
import time
from pathlib import Path
from urllib.parse import quote, unquote

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DOCS = ROOT / "docs"

DEFAULT_BASE = "https://USERNAME.github.io/banner_plus"

# Characters that must never reach an href unencoded, because the HTML parser
# decodes the attribute before the URL layer sees it.
_UNSAFE_IN_HREF = "&<>\"'"
_SAFE = "".join(c for c in "!$&()*+,-./:;=?@_~'" if c not in _UNSAFE_IN_HREF)


def loader(base: str, name: str) -> str:
    base = base.rstrip("/")
    js = (
        "(function(){"
        "var d=document,s=d.createElement('script');"
        "s.src='" + base + "/" + name + "?v='+Date.now();"
        "s.onerror=function(){alert('Banner Plus: could not load " + name + ". "
        "This page may block outside scripts.');};"
        "d.body.appendChild(s);"
        "})();"
    )
    return "javascript:" + quote(js, safe=_SAFE)


def decodes_back(href: str, expected: str) -> bool:
    """What the browser will run: HTML-unescape the attribute, then URL-decode."""
    return unquote(html_lib.unescape(href))[len("javascript:"):] == expected


# name, label, one-line description, whether it belongs on the main page
TOOLS = [
    ("console.js", "Banner Console",
     "Your classes, rosters with photographs, student records, and scheduling.", True),
    ("gpa-bridge.js", "GPA Bridge",
     "Click this on the student-profile window the console opens. It reads the "
     "official GPAs, sends them back, and closes itself.", True),
]

KIT = [
    ("spy.js", "Records every API call a Banner page makes while you use it."),
    ("probe.js", "Checks a Banner install has the fields the console needs."),
    ("diagnose.js", "Dumps a response's shape when something answers unexpectedly."),
    ("probe-courselist.js", "Why a course list came back empty or refused."),
    ("probe-profile.js", "Finds which endpoint a student profile uses."),
    ("probe-photo.js", "Finds a photo endpoint that does not need a section."),
    ("probe-gpa.js", "Looks for a GPA in responses already being received."),
]

PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Banner Plus</title>
<style>
  :root {
    color-scheme: light dark;
    --ink:#141922; --dim:#5b6675; --line:#e2e7f0;
    --bg1:#eef3ff; --bg2:#fbfcff; --card:#ffffff;
    --accent:#2f6bdd; --accent2:#5b93ff; --shadow:rgba(30,50,100,.18);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink:#e9edf5; --dim:#9aa6b8; --line:#283040;
      --bg1:#111725; --bg2:#0c1018; --card:#161c28;
      --accent:#4d86ff; --accent2:#7aa6ff; --shadow:rgba(0,0,0,.5);
    }
  }
  * { box-sizing:border-box }
  html,body { margin:0 }
  body { background: radial-gradient(1100px 560px at 50% -10%, var(--bg1), var(--bg2)) fixed;
         color:var(--ink);
         font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;
         -webkit-font-smoothing:antialiased }
  main { max-width:52rem; margin:0 auto; padding:3rem 1.25rem 4rem }
  h1 { font-size:clamp(2rem,5vw,2.9rem); margin:0; letter-spacing:-.035em; font-weight:800 }
  .tag { color:var(--dim); font-size:1.08rem; margin:.5rem 0 2rem }
  h2 { font-size:1.05rem; margin:2.4rem 0 .7rem; letter-spacing:-.01em }
  .row { display:flex; align-items:center; gap:1rem; background:var(--card);
         border:1px solid var(--line); border-radius:12px; padding:1rem 1.1rem;
         margin-bottom:.7rem; box-shadow:0 2px 8px rgba(20,40,90,.05) }
  .bm { display:inline-block; position:relative; overflow:hidden; flex:0 0 auto;
        padding:.6rem 1.2rem; border-radius:10px; cursor:grab; white-space:nowrap;
        font-weight:700; color:#fff !important; text-decoration:none;
        background:linear-gradient(180deg,var(--accent2),var(--accent));
        box-shadow:0 1px 0 rgba(255,255,255,.4) inset, 0 6px 16px -6px var(--shadow) }
  .bm:active { cursor:grabbing }
  .meta { min-width:0 }
  .name { font-weight:600 }
  .sub { color:var(--dim); font-size:.88rem; line-height:1.45 }
  ol { color:var(--dim); font-size:.95rem; padding-left:1.2rem }
  li { margin:.4rem 0 }
  .kit { border:1px solid var(--line); border-radius:12px; background:var(--card);
         padding:.4rem 1.1rem }
  .kit div { display:flex; gap:.9rem; padding:.55rem 0; border-top:1px solid var(--line);
             font-size:.9rem; align-items:baseline }
  .kit div:first-child { border-top:0 }
  .kit code { font-family:ui-monospace,Menlo,monospace; font-size:.84rem;
              flex:0 0 11rem; color:var(--ink) }
  .kit span { color:var(--dim) }
  code { background:var(--card); border:1px solid var(--line); border-radius:4px;
         padding:.08em .35em; font-size:.86em }
  .note { border-left:3px solid var(--accent); background:var(--card);
          padding:.85rem 1rem; border-radius:0 10px 10px 0; margin:1.4rem 0;
          font-size:.93rem }
  footer { margin-top:3rem; padding-top:1.2rem; border-top:1px solid var(--line);
           color:var(--dim); font-size:.86rem }
  footer a { color:var(--accent) }
</style></head>
<body><main>

<h1>Banner Plus</h1>
<p class="tag">The things Banner has the data for but no screen for: a roster as
one sheet of faces, a group's schedules overlaid to find a free hour, a term's
classes in one list.</p>

__TOOLS__

<ol>
  <li>Drag <strong>Banner Console</strong> to your bookmarks bar
      (<code>&#8984;&#8679;B</code> shows the bar).</li>
  <li>Open Banner Faculty Self-Service and click it.</li>
  <li>For official GPAs, drag <strong>GPA Bridge</strong> too, then click it on
      the window the console opens.</li>
</ol>

<div class="note">Everything runs in your browser, on the Banner session you are
already signed in to. No student data is sent anywhere — this page is static and
has no server behind it. What it produces is a named list of students with
photographs and grades; treat it the way you would treat a gradebook.</div>

<h2>Discovery kit</h2>
<p class="sub">Banner's internal endpoints are undocumented and differ by version
and campus. These find them. Paste into the DevTools console; all are read-only
and redact identifiers.</p>
<div class="kit">__KIT__</div>

<footer>
<a href="__REPO__">Source</a> &middot;
<a href="__REPO__/blob/main/ENDPOINTS.md">Endpoint notes</a><br>
Built against Ellucian Banner 9 at Old Dominion University. Field names differ
between installations; the kit above is how you find yours.
</footer>
</main></body></html>
"""


def repo_url(base: str) -> str:
    import re
    m = re.match(r"https?://([^.]+)\.github\.io/([^/]+)", base.rstrip("/"))
    return f"https://github.com/{m.group(1)}/{m.group(2)}" if m else base


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=DEFAULT_BASE,
                    help="public URL docs/ is served from")
    args = ap.parse_args()

    DOCS.mkdir(exist_ok=True)
    (DOCS / ".nojekyll").write_text("")   # Jekyll has no job here

    rows = []
    published = []
    for name, label, blurb, _main in TOOLS:
        src = HERE / name
        if not src.exists():
            print(f"  ! missing {name}")
            continue
        (DOCS / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        published.append(name)
        rows.append(
            '<div class="row"><a class="bm" href="%s">%s</a>'
            '<div class="meta"><div class="name">%s</div>'
            '<div class="sub">%s</div></div></div>'
            % (loader(args.base, name), label, label, blurb)
        )

    kit = []
    for name, blurb in KIT:
        src = HERE / name
        if not src.exists():
            continue
        (DOCS / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        published.append(name)
        kit.append("<div><code>%s</code><span>%s</span></div>" % (name, blurb))

    page = (PAGE.replace("__TOOLS__", "\n".join(rows))
                .replace("__KIT__", "\n".join(kit))
                .replace("__REPO__", repo_url(args.base)))
    (DOCS / "index.html").write_text(page, encoding="utf-8")

    # Verify by re-reading the finished page, not the strings just built: the
    # failure this guards against happens during HTML parsing.
    import re
    hrefs = re.findall(r'href="(javascript:[^"]*)"', page)
    if len(hrefs) != len(rows):
        raise SystemExit(f"expected {len(rows)} bookmarklets, found {len(hrefs)}")
    for href, (name, _l, _b, _m) in zip(hrefs, TOOLS):
        if not decodes_back(href, unquote(loader(args.base, name)[len("javascript:"):])):
            raise SystemExit(f"{name}: link does not decode back to itself")

    print(f"verified   {len(hrefs)} bookmarklets decode correctly")
    for n in published:
        print(f"  published  {n:24} {(HERE / n).stat().st_size / 1024:6.1f} KB")
    print(f"-> {DOCS / 'index.html'}")
    if args.base == DEFAULT_BASE:
        print("\nNote: placeholder URL. Rebuild with")
        print("  python3 bookmarklet/build.py --base https://<you>.github.io/banner_plus")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
