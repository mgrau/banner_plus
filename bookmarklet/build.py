#!/usr/bin/env python3
"""Bundle the console and build the install page.

    python3 bookmarklet/build.py
    python3 bookmarklet/build.py --base https://mgrau.github.io/banner_plus

Writes docs/console.js and docs/index.html. Point GitHub Pages at "main /docs"
and the page is live.

THE BUNDLE

src/*.js are fragments of one program, concatenated in filename order and
wrapped in a single IIFE. Each fragment is valid JavaScript on its own — they
hold function and var declarations, never half a function — so an editor can
parse one without the rest, but only the bundle runs.

The split is by job, not by size: 10-60 touch no DOM, 70 onwards draw. See the
header in src/00-header.js.

LOADER, NOT SELF-CONTAINED

The bookmark is a one-liner that injects console.js from this site, with a
cache-buster so a fix is live on the next click. The alternative — the whole
program encoded into the bookmark URL — means re-dragging the link after every
change, and the console is large enough that a 100 KB href stalled the Pages
build outright.

The trade is that a campus sending a script-src Content-Security-Policy would
block it. Browsers exempt bookmarklets from CSP but not the scripts a
bookmarklet injects. If that ever happens here, devserve.py serves the same
drag link from localhost.

ENCODING

Everything HTML-special is percent-encoded. Leaving "&" raw once corrupted a
shipped bookmarklet: an href is parsed as an HTML attribute before anything
treats it as a URL, so the parser turned the string "&quot;" inside the script
back into a quote character. The build verifies its own output by re-reading
the finished page and decoding it the way a browser would.
"""

from __future__ import annotations

import argparse
import html as html_lib
import re
import subprocess
from pathlib import Path
from urllib.parse import quote, unquote

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
ROOT = HERE.parent
DOCS = ROOT / "docs"

BOOKMARKLET = "console.js"


def default_base() -> str | None:
    """Where Pages will serve docs/, worked out from the git remote.

    The base is baked into the bookmark's href, so getting it wrong ships a
    link to a URL that does not exist — and the failure surfaces as "could not
    load console.js" on someone else's machine, days later. Deriving it beats
    remembering to pass --base.
    """
    try:
        url = subprocess.run(["git", "-C", str(ROOT), "remote", "get-url", "origin"],
                             capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None
    m = (re.match(r"git@github\.com:([^/]+)/(.+?)(?:\.git)?$", url) or
         re.match(r"https://github\.com/([^/]+)/(.+?)(?:\.git)?$", url))
    return f"https://{m.group(1)}.github.io/{m.group(2)}" if m else None

# Characters that must never reach an href unencoded, because the HTML parser
# decodes the attribute before the URL layer sees it.
_UNSAFE_IN_HREF = "&<>\"'"
_SAFE = "".join(c for c in "!$&()*+,-./:;=?@_~'" if c not in _UNSAFE_IN_HREF)


def fragments() -> list[Path]:
    """src/*.js in numeric order — 90 before 100, which a plain sort gets wrong."""
    def key(p: Path):
        m = re.match(r"(\d+)", p.name)
        return (int(m.group(1)) if m else 10**6, p.name)
    files = sorted(SRC.glob("*.js"), key=key)
    if not files:
        raise SystemExit(f"no fragments in {SRC}")
    return files


def bundle() -> str:
    """Concatenate the fragments into one runnable script.

    00-header.js is a comment block and stays outside the IIFE, so the file
    opens with what it is. Everything after it is indented into the wrapper.
    """
    files = fragments()
    head, body = files[0], files[1:]
    out = [head.read_text(encoding="utf-8").rstrip("\n"), "",
           "(function () {", '  "use strict";', ""]
    for f in body:
        out.append("  // ---- src/%s %s" % (f.name, "-" * max(0, 62 - len(f.name))))
        for line in f.read_text(encoding="utf-8").rstrip("\n").split("\n"):
            out.append(("  " + line) if line.strip() else "")
        out.append("")
    out.append("})();")
    return "\n".join(out) + "\n"


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
  .tag { color:var(--dim); font-size:1.08rem; margin:.5rem 0 2.2rem }
  h2 { font-size:1.05rem; margin:2.6rem 0 .7rem; letter-spacing:-.01em }
  .drag { display:flex; align-items:center; gap:1.1rem; background:var(--card);
          border:1px solid var(--line); border-radius:14px; padding:1.3rem 1.4rem;
          box-shadow:0 4px 18px -6px var(--shadow) }
  .bm { display:inline-block; flex:0 0 auto; padding:.7rem 1.4rem; border-radius:10px;
        cursor:grab; white-space:nowrap; font-weight:700; font-size:1.02rem;
        color:#fff !important; text-decoration:none;
        background:linear-gradient(180deg,var(--accent2),var(--accent));
        box-shadow:0 1px 0 rgba(255,255,255,.4) inset, 0 6px 16px -6px var(--shadow) }
  .bm:active { cursor:grabbing }
  .drag .meta { min-width:0; color:var(--dim); font-size:.92rem; line-height:1.45 }
  .does { list-style:none; padding:0; margin:1.4rem 0 0 }
  .does li { display:flex; gap:.75rem; padding:.62rem 0; border-top:1px solid var(--line);
             font-size:.94rem; line-height:1.5 }
  .does b { flex:0 0 9.5rem; font-weight:600; color:var(--ink) }
  .does span { color:var(--dim); min-width:0 }
  ol { color:var(--dim); font-size:.95rem; padding-left:1.2rem }
  li { margin:.4rem 0 }
  code { background:var(--card); border:1px solid var(--line); border-radius:4px;
         padding:.08em .35em; font-size:.86em }
  .note { border-left:3px solid var(--accent); background:var(--card);
          padding:.85rem 1rem; border-radius:0 10px 10px 0; margin:1.6rem 0;
          font-size:.93rem }
  footer { margin-top:3rem; padding-top:1.2rem; border-top:1px solid var(--line);
           color:var(--dim); font-size:.86rem }
  footer a { color:var(--accent) }
</style></head>
<body><main>

<h1>Banner Plus</h1>
<p class="tag">Banner has the data. It has no screen for the questions you
actually ask it &mdash; so this adds them, inside Banner, on the session you are
already signed in to.</p>

<div class="drag">
  <a class="bm" href="__HREF__">Banner Plus</a>
  <div class="meta">Drag this to your bookmarks bar, open Banner Faculty
  Self-Service, and click it.<br>
  <code>&#8984;&#8679;B</code> shows the bar if it is hidden.</div>
</div>

<h2>What it does</h2>
<ul class="does">
  <li><b>Your classes</b><span>Every section you teach in a term, with enrolment
      counts, in one list. Or every term at once.</span></li>
  <li><b>Rosters of faces</b><span>A grid of photographs you can actually learn
      names from, or a sortable table when you are reading rather than
      recognising.</span></li>
  <li><b>Student records</b><span>Photograph, major, standing, this term's
      schedule with rooms and times, and the full registration history laid out
      as a transcript &mdash; seasons across, years down, newest first.</span></li>
  <li><b>Shared free time</b><span>Select any set of students and see when they
      are collectively not in class. Hover a slot for who is free and who is
      not.</span></li>
  <li><b>Groups</b><span>An artificial class of students who share no section
      &mdash; a research group, your advisees. Search by name, paste UINs, or
      drag students in from a roster.</span></li>
  <li><b>Printable sheets</b><span>A photo roster with colour-coded majors,
      auto-fitted to the page, and a free-time sheet.</span></li>
</ul>

<div class="note">Everything runs in your browser. No student data is sent
anywhere &mdash; this page is static and has no server behind it. What it
produces is a named list of students with photographs and grades; treat it the
way you would treat a gradebook.</div>

<footer>
<a href="__REPO__">Source</a> &middot;
<a href="__REPO__/blob/main/ENDPOINTS.md">Endpoint notes</a><br>
Built against Ellucian Banner 9 at Old Dominion University. Endpoint and field
names differ between installations, so it may need adjusting elsewhere.
</footer>
</main></body></html>
"""


def repo_url(base: str) -> str:
    m = re.match(r"https?://([^.]+)\.github\.io/([^/]+)", base.rstrip("/"))
    return f"https://github.com/{m.group(1)}/{m.group(2)}" if m else base


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=None,
                    help="public URL docs/ is served from "
                         "(default: derived from the git remote)")
    args = ap.parse_args()

    base = args.base or default_base()
    if not base:
        raise SystemExit(
            "cannot work out where this will be served from — no github.com "
            "remote named origin.\nPass it: build.py --base https://<you>.github.io/<repo>")

    DOCS.mkdir(exist_ok=True)
    (DOCS / ".nojekyll").write_text("")   # Jekyll has no job here

    js = bundle()
    (DOCS / BOOKMARKLET).write_text(js, encoding="utf-8")

    href = loader(base, BOOKMARKLET)
    page = (PAGE.replace("__HREF__", href)
                .replace("__REPO__", repo_url(base)))
    (DOCS / "index.html").write_text(page, encoding="utf-8")

    # Verify against the finished page, not the string just built: the failure
    # this guards against happens during HTML parsing.
    written = (DOCS / "index.html").read_text(encoding="utf-8")
    hrefs = re.findall(r'href="(javascript:[^"]*)"', written)
    if len(hrefs) != 1:
        raise SystemExit(f"expected 1 bookmarklet in the page, found {len(hrefs)}")
    if not decodes_back(hrefs[0], unquote(href[len("javascript:"):])):
        raise SystemExit("the link does not decode back to itself")
    # A placeholder that reaches the page is a link to nowhere, and it fails on
    # someone else's machine days later. Refuse to ship one.
    if "USERNAME" in written or "example.com" in written:
        raise SystemExit(f"the base URL looks like a placeholder: {base}")

    for f in fragments():
        print(f"  {f.name:20} {f.stat().st_size / 1024:6.1f} KB")
    print(f"bundled    {len(js.splitlines())} lines, {len(js) / 1024:.1f} KB -> {DOCS / BOOKMARKLET}")
    print("verified   the bookmarklet decodes correctly")
    print(f"serving as {base}/{BOOKMARKLET}")
    print(f"->         {DOCS / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
