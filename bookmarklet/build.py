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


# Where to send someone who clicks the bookmark on the wrong page. ODU's, since
# this is built against ODU's Banner; change it with the endpoint names if you
# are porting this.
BANNER_URL = ("https://facultyssb-prod.ec.odu.edu/FacultySelfService"
              "/ssb/classListApp/classListPage")


def loader(base: str, name: str) -> str:
    """The bookmark itself: a few lines that fetch the real program.

    WHY IT CANNOT OPEN BANNER AND INJECT IN ONE CLICK

    A bookmarklet runs in whatever page is open. Navigating away destroys the
    context it is running in, so there is no "after the page loads" to inject
    into — the script that would do the injecting no longer exists. Opening
    Banner in a new window instead keeps this code alive, but the new window is
    a different origin, and same-origin policy means the opener cannot reach
    into its document. Both doors are shut, and they are shut on purpose: a
    page that could inject script into any site you visit is the exact thing
    the policy exists to prevent. Doing it properly needs a browser extension,
    which is an install.

    So: clicked somewhere else, it offers to take you to Banner. That is one
    extra click, once, and it beats an alert that only says no.
    """
    base = base.rstrip("/")
    js = (
        "(function(){"
        # Banner's own pages, by host or by path, so it also works on an
        # install that is not ODU's.
        "if(!/facultyssb|\\/FacultySelfService/i.test(location.host+location.pathname)){"
        "if(confirm('Banner Plus runs inside Banner Faculty Self-Service.\\n\\n"
        "Open it now? Then click this bookmark again.'))"
        "location.href='" + BANNER_URL + "';return;}"
        "var d=document,s=d.createElement('script');"
        "s.src='" + base + "/" + name + "?v='+Date.now();"
        "s.onerror=function(){alert('Banner Plus could not load " + name + " from "
        + base + ".\\n\\nEither the site is unreachable, or this page blocked the "
        "script \\u2014 check the browser console for a Content-Security-Policy error.');};"
        "d.body.appendChild(s);"
        "})();"
    )
    return "javascript:" + quote(js, safe=_SAFE)


def decodes_back(href: str, expected: str) -> bool:
    """What the browser will run: HTML-unescape the attribute, then URL-decode."""
    return unquote(html_lib.unescape(href))[len("javascript:"):] == expected


# ---- the cartoon ----------------------------------------------------------
#
# A drawing of the console rather than a screenshot, because a screenshot of
# this is a roster: real names, real faces, real grades. It is also the one
# picture that cannot go stale in the embarrassing direction — nobody expects a
# cartoon to match the build exactly.
#
# The colours are the console's own, lifted from src/10-core.js, so the drawing
# is at least the right thing in the right hues.

RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"]
CAT = ["#2a78d6", "#1baf7a", "#4a3aa7", "#e34948", "#eb6834", "#008300"]

# How free each half-hour is, Mon-Fri, 9am to well after lunch. Mid-morning is
# solid teaching; the afternoon opens up. Invented, but the shape is real.
FREE = [
    [1, 3, 1, 3, 2], [0, 2, 0, 2, 1], [0, 2, 0, 2, 1], [1, 1, 1, 1, 2],
    [2, 1, 2, 1, 3], [3, 0, 3, 0, 3], [3, 0, 3, 0, 4], [4, 2, 4, 2, 4],
    [5, 4, 5, 4, 5], [5, 5, 5, 5, 5], [4, 5, 4, 5, 4], [3, 4, 3, 4, 3],
    [4, 4, 4, 4, 5], [5, 5, 5, 5, 5],
]

CLASSES = [("PHYS 101", 118, 34), ("PHYS 226", 104, 29), ("PHYS 232", 110, 22),
           ("PHYS 420", 96, 11)]
GROUPS = [(92, 62), (78, 48)]


def tint(hex_color: str) -> str:
    """The console's own washed-out background for a category colour."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return "#%02x%02x%02x" % tuple(round(c + (255 - c) * 0.88) for c in (r, g, b))


def face(x: float, y: float, size: float) -> str:
    """A photograph, of nobody."""
    cx, r = x + size / 2, size * 0.17
    return (f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="5" fill="#e8eaee"/>'
            f'<circle cx="{cx}" cy="{y + size * 0.38}" r="{r}" fill="#c2c8d2"/>'
            f'<path d="M{x + size * 0.18} {y + size} '
            f'a{size * 0.32} {size * 0.34} 0 0 1 {size * 0.64} 0 Z" fill="#c2c8d2"/>')


def bar(x: float, y: float, w: float, h: float, fill: str, rx: float = None) -> str:
    rx = h / 2 if rx is None else rx
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"/>'


def mockup() -> str:
    """An SVG drawing of the console, with three labels pointing into it."""
    p = []                                     # pieces, in painting order

    # --- window chrome -----------------------------------------------------
    p.append('<clipPath id="win"><rect x="8" y="8" width="884" height="452" rx="14"/></clipPath>')
    p.append('<g clip-path="url(#win)">')
    p.append('<rect x="8" y="8" width="884" height="452" fill="#eef1f6"/>')
    p.append('<rect x="8" y="8" width="884" height="34" fill="#e3e8f0"/>')
    for i, c in enumerate(("#f0655a", "#f5be4f", "#5bc75d")):
        p.append(f'<circle cx="{28 + i * 18}" cy="25" r="5.5" fill="{c}"/>')
    p.append(bar(92, 17, 320, 16, "#f7f9fc", 8))
    p.append('<text x="104" y="29" class="w-url">facultyssb-prod.ec.odu.edu</text>')

    # --- app toolbar -------------------------------------------------------
    p.append('<rect x="8" y="42" width="884" height="36" fill="#1f2430"/>')
    p.append('<text x="24" y="65" class="w-brand">Banner Plus</text>')
    p.append('<rect x="122" y="51" width="98" height="19" rx="5" fill="#161a23" stroke="#3b455a"/>')
    p.append('<text x="131" y="65" class="w-pill">Fall 2026</text>')
    p.append('<path d="M206 58l5 5 5-5" stroke="#9fb4d0" stroke-width="1.4" fill="none"/>')
    p.append('<text x="236" y="65" class="w-status">38 students &#183; 36 photos</text>')
    p.append('<circle cx="866" cy="60" r="9" fill="none" stroke="#3b455a"/>')
    p.append('<circle cx="866" cy="60" r="3" fill="#9fb4d0"/>')
    p.append('<rect x="8" y="78" width="884" height="3" fill="#2b3444"/>')
    p.append('<rect x="8" y="78" width="548" height="3" fill="#4c8dff"/>')

    # --- panes -------------------------------------------------------------
    p.append('<rect x="8" y="81" width="168" height="379" fill="#ffffff"/>')
    p.append('<rect x="632" y="81" width="260" height="379" fill="#ffffff"/>')
    p.append('<rect x="630" y="81" width="4" height="379" fill="#dde3ec"/>')

    # sidebar: my classes, then groups
    p.append('<text x="22" y="103" class="w-label">MY CLASSES</text>')
    y = 110
    for i, (_name, w, _n) in enumerate(CLASSES):
        if i == 0:
            p.append(f'<rect x="14" y="{y - 4}" width="156" height="32" rx="6" fill="#e7f0fd"/>')
            p.append(f'<rect x="14" y="{y - 4}" width="3" height="32" fill="#2a78d6"/>')
        p.append(bar(24, y + 2, w * 0.62, 7, "#41556f", 3.5))
        p.append(bar(24, y + 14, w, 5, "#c7d0dd", 2.5))
        p.append(f'<text x="162" y="{y + 9}" class="w-count">{_n}</text>')
        y += 34
    p.append(f'<text x="22" y="{y + 12}" class="w-label">GROUPS</text>')
    y += 20
    for w, sub in GROUPS:
        p.append(bar(24, y + 2, w, 7, "#41556f", 3.5))
        p.append(bar(24, y + 14, sub, 5, "#c7d0dd", 2.5))
        y += 32
    p.append(f'<rect x="14" y="{y}" width="156" height="24" rx="6" fill="none" '
             f'stroke="#c7d0dd" stroke-dasharray="4 3"/>')

    # main: header, then a grid of faces that runs off the bottom edge
    p.append(bar(190, 96, 116, 11, "#16191f", 5))
    p.append(bar(316, 99, 62, 7, "#9aa1ab", 3.5))
    p.append('<rect x="470" y="94" width="70" height="17" rx="6" fill="#2a78d6"/>')
    for i, x in enumerate((548, 590)):
        p.append(f'<rect x="{x}" y="94" width="{36 if i else 34}" height="17" rx="6" '
                 f'fill="#ffffff" stroke="#c7d0dd"/>')
    for row in range(3):
        for col in range(4):
            x, cy = 190 + col * 110, 124 + row * 144
            p.append(f'<rect x="{x}" y="{cy}" width="98" height="132" rx="8" '
                     f'fill="#ffffff" stroke="#d8dde5"/>')
            p.append(face(x + 5, cy + 6, 88))
            p.append(bar(x + 7, cy + 100, 60 + (col * 7 + row * 11) % 26, 7, "#41556f", 3.5))
            c = CAT[(col + row * 3) % len(CAT)]
            p.append(f'<rect x="{x + 7}" y="{cy + 112}" width="{48 + (col * 13) % 22}" '
                     f'height="12" rx="4" fill="{tint(c)}" stroke="{c}"/>')

    # right pane: the free-time heatmap
    p.append(bar(648, 100, 88, 10, "#16191f", 5))
    p.append(bar(648, 116, 168, 6, "#9aa1ab", 3))
    for i, d in enumerate("MTWRF"):
        p.append(f'<text x="{682 + i * 42}" y="140" class="w-day">{d}</text>')
    for r, row in enumerate(FREE):
        yy = 146 + r * 15
        if r % 4 == 0:
            p.append(f'<text x="656" y="{yy + 9}" class="w-time">{9 + r // 2}</text>')
        for c, step in enumerate(row):
            p.append(f'<rect x="{662 + c * 42}" y="{yy}" width="40" height="13" rx="2" '
                     f'fill="{RAMP[step]}"/>')
    for i, c in enumerate(RAMP):
        p.append(f'<rect x="{662 + i * 16}" y="{364}" width="14" height="8" rx="2" fill="{c}"/>')
    p.append('<rect x="648" y="384" width="236" height="52" rx="7" fill="#fafbfd" stroke="#e6eaf0"/>')
    p.append(bar(658, 394, 96, 7, "#16191f", 3.5))
    p.append(bar(658, 408, 40, 6, "#1b7a4b", 3))
    p.append(bar(704, 408, 128, 6, "#c7d0dd", 3))
    p.append(bar(658, 420, 52, 6, "#b3261e", 3))
    p.append(bar(716, 420, 96, 6, "#c7d0dd", 3))
    p.append("</g>")
    p.append('<rect x="8" y="8" width="884" height="452" rx="14" fill="none" class="w-edge"/>')

    # --- labels pointing into it -------------------------------------------
    for x, text in ((92, "your classes"), (404, "faces, not rows"),
                    (762, "when everyone is free")):
        p.append(f'<circle cx="{x}" cy="462" r="3" class="w-dot"/>')
        p.append(f'<path d="M{x} 462 L{x} 492" class="w-lead"/>')
        p.append(f'<text x="{x}" y="512" class="w-cal">{text}</text>')

    return ('<svg class="shot" viewBox="0 0 900 528" role="img" '
            'aria-label="A drawing of Banner Plus: a term of classes down the left, '
            'a roster of photographs in the middle, and a shared free-time heatmap '
            'on the right.">' + "".join(p) + "</svg>")


PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Banner Plus</title>
<style>
  :root {
    color-scheme: light dark;
    --ink:#101622; --dim:#5d6a7d; --faint:#8e9aab; --line:#e0e6f0;
    --bg:#eef2fb; --bg2:#f9fbff; --card:#ffffff;
    --accent:#2f6bdd; --accent2:#63a0ff; --deep:#1b2540;
    --shadow:rgba(24,44,92,.18);
    --chrome:#dfe5f0; --chrome-ink:#7c8798;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink:#eaeff8; --dim:#9aa7bb; --faint:#6d7a8d; --line:#232c3e;
      --bg:#0b0f1a; --bg2:#10151f; --card:#151b28;
      --accent:#5b93ff; --accent2:#8fb8ff; --deep:#0a0e18;
      --shadow:rgba(0,0,0,.6);
      --chrome:#1b2231; --chrome-ink:#5f6b7d;
    }
  }
  * { box-sizing:border-box }
  html,body { margin:0 }
  body {
    background:
      radial-gradient(900px 480px at 12% -8%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
      radial-gradient(760px 440px at 92% 4%, color-mix(in srgb, var(--accent2) 14%, transparent), transparent 70%),
      linear-gradient(var(--bg), var(--bg2));
    background-attachment: fixed;
    color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  main { max-width:60rem; margin:0 auto; padding:3.4rem 1.25rem 3rem }

  /* ---- hero ---------------------------------------------------------- */
  .hero { text-align:center; margin-bottom:2.4rem }
  h1 { font-size:clamp(2.4rem,7vw,4rem); margin:0; letter-spacing:-.045em; font-weight:800;
       background:linear-gradient(180deg, var(--ink), color-mix(in srgb, var(--ink) 62%, var(--accent)));
       -webkit-background-clip:text; background-clip:text; color:transparent }
  .tag { color:var(--dim); font-size:1.14rem; margin:.7rem auto 0; max-width:32rem }

  /* ---- the drag target ------------------------------------------------ */
  .install { margin:0 auto 1rem; max-width:34rem }
  .browser { border:1px solid var(--line); border-radius:14px; overflow:hidden;
             background:var(--card); box-shadow:0 18px 44px -20px var(--shadow) }
  .toolbar { display:flex; align-items:center; gap:.4rem; padding:.55rem .8rem;
             background:var(--chrome) }
  .toolbar i { width:9px; height:9px; border-radius:50%; background:var(--chrome-ink);
               opacity:.45; display:block }
  .toolbar i:first-child { margin-right:.15rem }
  .marks { display:flex; align-items:center; gap:.5rem; padding:.42rem .8rem;
           background:color-mix(in srgb, var(--chrome) 55%, var(--card));
           border-bottom:1px solid var(--line); font-size:.76rem; color:var(--faint) }
  .marks b { font-weight:500; display:flex; align-items:center; gap:.25rem; white-space:nowrap }
  .marks b::before { content:""; width:11px; height:11px; border-radius:3px;
                     background:var(--chrome-ink); opacity:.4 }
  .slot { margin-left:auto; border:1.5px dashed var(--accent); border-radius:5px;
          padding:.1rem .6rem; color:var(--accent); font-weight:600;
          animation:pulse 2.4s ease-in-out infinite }
  @keyframes pulse { 0%,100%{opacity:.45} 50%{opacity:1} }
  .stage { position:relative; padding:3.6rem 1rem 2.4rem; text-align:center;
           background:repeating-linear-gradient(45deg, transparent 0 9px,
             color-mix(in srgb, var(--line) 40%, transparent) 9px 10px) }
  .bm { display:inline-block; padding:.72rem 1.5rem; border-radius:11px;
        font-weight:700; font-size:1.06rem; letter-spacing:-.01em;
        color:#fff !important; text-decoration:none; cursor:grab; white-space:nowrap;
        background:linear-gradient(180deg,var(--accent2),var(--accent));
        box-shadow:0 1px 0 rgba(255,255,255,.45) inset, 0 10px 22px -10px var(--shadow);
        transition:transform .12s ease }
  .bm:hover { transform:translateY(-2px) }
  .bm:active { cursor:grabbing; transform:translateY(0) }
  /* Sits in the stage's top padding, so it runs from above the button to the
     slot in the bar without ever crossing either. */
  .arrow { position:absolute; right:1.5rem; top:.45rem; width:min(210px,52%); height:46px;
           pointer-events:none; overflow:visible }
  .arrow path { fill:none; stroke:var(--accent); stroke-width:2.2; stroke-linecap:round;
                stroke-dasharray:5 5; animation:crawl 1s linear infinite }
  @keyframes crawl { to { stroke-dashoffset:-20 } }
  /* The head is its own square SVG so that stretching the curve to fit the
     card cannot stretch the arrowhead with it. */
  .tip { position:absolute; right:1.2rem; top:.1rem; width:18px; height:18px;
         pointer-events:none }
  .tip polygon { fill:var(--accent) }
  @media (prefers-reduced-motion: reduce) {
    .arrow path, .slot { animation:none }
  }
  .step { text-align:center; color:var(--dim); font-size:.95rem; margin:.9rem 0 0 }
  .step b { color:var(--ink); font-weight:600 }

  /* ---- the cartoon ---------------------------------------------------- */
  .figure { margin:3.2rem 0 0; overflow-x:auto }
  .shot { display:block; width:100%; min-width:640px; height:auto }
  .w-edge { stroke:var(--line) }
  .w-url { font:9px ui-monospace,Menlo,monospace; fill:#8b95a6 }
  .w-brand { font:700 13px -apple-system,Segoe UI,Arial,sans-serif; fill:#eceff4 }
  .w-pill { font:10.5px -apple-system,Segoe UI,Arial,sans-serif; fill:#eceff4 }
  .w-status { font:10.5px -apple-system,Segoe UI,Arial,sans-serif; fill:#9fb4d0 }
  .w-label { font:700 8.5px -apple-system,Segoe UI,Arial,sans-serif; fill:#6b7280;
             letter-spacing:.09em }
  .w-count { font:700 9.5px -apple-system,Segoe UI,Arial,sans-serif; fill:#2a78d6;
             text-anchor:end }
  .w-day  { font:700 9.5px -apple-system,Segoe UI,Arial,sans-serif; fill:#6b7280;
            text-anchor:middle }
  .w-time { font:8.5px -apple-system,Segoe UI,Arial,sans-serif; fill:#9aa1ab; text-anchor:end }
  .w-cal  { font:600 15px -apple-system,Segoe UI,Arial,sans-serif; fill:var(--dim);
            text-anchor:middle }
  .w-lead { stroke:var(--line); stroke-width:1.5 }
  .w-dot  { fill:var(--accent) }

  /* ---- footer --------------------------------------------------------- */
  .fine { text-align:center; color:var(--faint); font-size:.86rem; margin:2.4rem auto 0;
          max-width:34rem; line-height:1.6 }
  footer { margin-top:1.6rem; text-align:center; color:var(--faint); font-size:.84rem }
  footer a { color:var(--accent); text-decoration:none; font-weight:500 }
  footer a:hover { text-decoration:underline }
  footer span { margin:0 .45rem; opacity:.5 }
</style></head>
<body><main>

<div class="hero">
  <h1>Banner Plus</h1>
  <p class="tag">Your rosters as faces, your advisees as a group, and everyone's
  free hour &mdash; inside the Banner you already use.</p>
</div>

<div class="install">
  <div class="browser">
    <div class="toolbar"><i></i><i></i><i></i></div>
    <div class="marks"><b>ODU</b><b>Leo Online</b><b>Grades</b>
      <span class="slot">drop here</span></div>
    <div class="stage">
      <svg class="arrow" viewBox="0 0 210 46" preserveAspectRatio="none" aria-hidden="true">
        <path d="M8 42 C 84 42, 158 38, 188 16" vector-effect="non-scaling-stroke"/>
      </svg>
      <svg class="tip" viewBox="0 0 20 20" aria-hidden="true">
        <polygon points="18,2 4,7 11,17"/>
      </svg>
      <a class="bm" href="__HREF__" draggable="true">&#10022; Banner Plus</a>
    </div>
  </div>
  <p class="step"><b>Drag it to your bookmarks bar.</b> Then open Banner and click it.<br>
  No install, no extension, no account.</p>
</div>

<div class="figure">__MOCKUP__</div>

<p class="fine">Runs in your browser on the Banner session you are already signed
in to. Nothing is uploaded &mdash; this page is static and has no server behind
it. What it shows you is a gradebook; treat it like one.</p>

<footer>
<a href="__REPO__">Source</a><span>&middot;</span>
<a href="__REPO__/blob/main/ENDPOINTS.md">Endpoint notes</a><span>&middot;</span>
<a href="__REPO__#tests">How it is tested</a><br>
Built against Ellucian Banner 9 at Old Dominion University.
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
                .replace("__MOCKUP__", mockup())
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
