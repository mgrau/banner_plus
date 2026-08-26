#!/usr/bin/env python3
"""Serve the bookmarklets locally so you can edit and re-click, with no copying.

    python3 bookmarklet/devserve.py
    python3 bookmarklet/devserve.py --port 9000

Then open http://127.0.0.1:8765/ and drag a "dev" link to your bookmarks bar
once. After that the loop is: edit the file, save, click the bookmark on the
Banner page. No paste, no rebuild, no push.

WHY PLAIN HTTP WORKS

Banner is HTTPS, and an HTTPS page normally refuses to load scripts over HTTP.
Loopback is the exception: browsers treat http://127.0.0.1 and http://localhost
as potentially trustworthy origins, so they are exempt from mixed-content
blocking. Verified against a local HTTPS page loading a script from
http://127.0.0.1 — it loads. No self-signed certificate needed.

Use 127.0.0.1 rather than localhost: on some machines localhost resolves to ::1
first, and a server bound only to IPv4 is then unreachable.

Responses carry no-store, and each bookmarklet appends a timestamp, so an edit
is live on the next click rather than after a cache expires.

This is a development tool. It serves only this directory, binds to loopback
only, and has nothing to do with the published bookmarklets in docs/.
"""

from __future__ import annotations

import argparse
import http.server
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Reuse the published encoder rather than repeating it. Leaving "&" raw once
# corrupted a shipped bookmarklet; there is no reason to risk it twice.
from build import _SAFE  # noqa: E402


def dev_bookmarklet(port: int, name: str) -> str:
    js = (
        "(function(){"
        "var d=document,s=d.createElement('script');"
        "s.src='http://127.0.0.1:%d/%s?v='+Date.now();"
        "s.onerror=function(){alert('Dev server not reachable on port %d \\u2014 "
        "is devserve.py still running?');};"
        "d.body.appendChild(s);"
        "})();" % (port, name, port)
    )
    return "javascript:" + quote(js, safe=_SAFE)


PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Bookmarklet dev server</title>
<style>
  :root { color-scheme: light dark; --ink:#16191f; --dim:#5b6675; --line:#dfe3ea;
          --bg:#fbfcff; --card:#fff; --accent:#2f6bdd; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e9edf5; --dim:#9aa6b8; --line:#283040; --bg:#0f1219; --card:#161c28;
            --accent:#4d86ff; } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif; }
  main { max-width:46rem; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
  h1 { font-size:1.5rem; margin:0 0 .3rem; letter-spacing:-.02em; }
  .lede { color:var(--dim); margin:0 0 1.6rem; font-size:.95rem; }
  .row { display:flex; align-items:center; gap:.8rem; background:var(--card);
         border:1px solid var(--line); border-radius:10px; padding:.8rem 1rem; margin-bottom:.6rem; }
  .bm { display:inline-block; background:var(--accent); color:#fff !important; text-decoration:none;
        font-weight:600; padding:.45rem 1rem; border-radius:7px; cursor:grab; white-space:nowrap; }
  .bm:active { cursor:grabbing }
  .meta { min-width:0 }
  .name { font-weight:600; font-family:ui-monospace,Menlo,monospace; font-size:.9rem }
  .sub { color:var(--dim); font-size:.8rem }
  ol { color:var(--dim); font-size:.9rem; padding-left:1.1rem }
  li { margin:.3rem 0 }
  code { background:var(--card); border:1px solid var(--line); border-radius:4px;
         padding:.08em .35em; font-size:.85em }
  footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--line);
           color:var(--dim); font-size:.82rem }
</style></head>
<body><main>
<h1>Bookmarklet dev server</h1>
<p class="lede">Drag a link to your bookmarks bar once. Then: edit the file, save,
click the bookmark on the Banner page.</p>
__ROWS__
<ol>
  <li>Drag a <strong>dev</strong> link above to your bookmarks bar.</li>
  <li>Open Banner Faculty Self-Service.</li>
  <li>Click it. Edit the file and click again to see the change.</li>
</ol>
<footer>Serving <code>__DIR__</code> on 127.0.0.1 only, with no-store and a
per-click cache-buster. Loopback is exempt from mixed-content blocking, which is
why an HTTPS Banner page will load these over plain HTTP.</footer>
</main></body></html>
"""


def build_index(port: int) -> bytes:
    rows = []
    scripts = sorted(p for p in HERE.glob("*.js"))
    for p in scripts:
        age = time.time() - p.stat().st_mtime
        when = ("%.0fs" % age if age < 90 else
                "%.0fm" % (age / 60) if age < 5400 else
                "%.1fh" % (age / 3600))
        rows.append(
            '<div class="row">'
            '<a class="bm" href="%s">dev: %s</a>'
            '<div class="meta"><div class="name">%s</div>'
            '<div class="sub">%.1f KB &middot; edited %s ago</div></div></div>'
            % (dev_bookmarklet(port, p.name).replace("&", "&amp;"),
               p.stem, p.name, p.stat().st_size / 1024, when)
        )
    if not rows:
        rows.append('<div class="row">No .js files in this directory.</div>')
    html = PAGE.replace("__ROWS__", "\n".join(rows)).replace("__DIR__", str(HERE))
    return html.encode("utf-8")


def make_handler(port: int):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(HERE), **kw)

        def end_headers(self):
            # An edit must be live on the next click, not after a TTL.
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Access-Control-Allow-Origin", "*")
            super().end_headers()

        def do_GET(self):
            if self.path.split("?")[0] in ("/", "/index.html"):
                body = build_index(port)      # rebuilt per request, so mtimes are current
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            return super().do_GET()

        def log_message(self, fmt, *args):
            # One readable line per fetch: seeing the click land is the point.
            sys.stderr.write("  %s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    return Handler


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.port))
    print(f"serving {HERE}")
    print(f"open    http://127.0.0.1:{args.port}/   and drag a dev link to your bookmarks bar")
    print("ctrl-c to stop\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
