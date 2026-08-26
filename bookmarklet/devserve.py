#!/usr/bin/env python3
"""Serve the console locally so you can edit and re-click, with no copying.

    python3 bookmarklet/devserve.py
    python3 bookmarklet/devserve.py --port 9000

Open http://127.0.0.1:8765/ and drag the dev link to your bookmarks bar once.
After that the loop is: edit a file in src/, save, click the bookmark on the
Banner page. No paste, no rebuild, no push.

The bundle is rebuilt from src/ on every request, so what you get is exactly
what build.py would publish — a fragment that fails to parse fails here too,
rather than at the end of the day.

WHY PLAIN HTTP WORKS

Banner is HTTPS, and an HTTPS page normally refuses to load scripts over HTTP.
Loopback is the exception: browsers treat http://127.0.0.1 and http://localhost
as potentially trustworthy origins, so they are exempt from mixed-content
blocking. Verified against a local HTTPS page loading a script from
http://127.0.0.1 — it loads. No self-signed certificate needed.

Use 127.0.0.1 rather than localhost: on some machines localhost resolves to ::1
first, and a server bound only to IPv4 is then unreachable.

Responses carry no-store and the bookmarklet appends a timestamp, so an edit is
live on the next click rather than after a cache expires.

This is a development tool. It binds to loopback only and has nothing to do
with the published bookmarklet in docs/.
"""

from __future__ import annotations

import argparse
import http.server
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Reuse the published bundler and encoder rather than repeating either. Leaving
# "&" raw once corrupted a shipped bookmarklet; there is no reason to risk it
# twice, and a dev bundle assembled differently from the real one is a trap.
from build import _SAFE, bundle, fragments  # noqa: E402


def dev_bookmarklet(port: int) -> str:
    js = (
        "(function(){"
        "var d=document,s=d.createElement('script');"
        "s.src='http://127.0.0.1:%d/console.js?v='+Date.now();"
        "s.onerror=function(){alert('Dev server not reachable on port %d \\u2014 "
        "is devserve.py still running?');};"
        "d.body.appendChild(s);"
        "})();" % (port, port)
    )
    return "javascript:" + quote(js, safe=_SAFE)


PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Banner Plus dev server</title>
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
         border:1px solid var(--line); border-radius:10px; padding:.9rem 1rem;
         margin-bottom:1.4rem; }
  .bm { display:inline-block; background:var(--accent); color:#fff !important;
        text-decoration:none; font-weight:600; padding:.45rem 1rem; border-radius:7px;
        cursor:grab; white-space:nowrap; }
  .bm:active { cursor:grabbing }
  .meta { min-width:0; color:var(--dim); font-size:.85rem }
  h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; color:var(--dim);
       margin:0 0 .5rem }
  table { width:100%; border-collapse:collapse; font-size:.86rem }
  td { padding:.28rem 0; border-top:1px solid var(--line) }
  td:first-child { font-family:ui-monospace,Menlo,monospace }
  td:last-child, td:nth-child(2) { text-align:right; color:var(--dim);
       font-variant-numeric:tabular-nums; white-space:nowrap; padding-left:1rem }
  .err { background:#fff0f0; border:1px solid #f0c0c0; color:#7a1616; border-radius:8px;
         padding:.8rem 1rem; white-space:pre-wrap; font-family:ui-monospace,Menlo,monospace;
         font-size:.8rem; margin-bottom:1.4rem }
  footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--line);
           color:var(--dim); font-size:.82rem }
</style></head>
<body><main>
<h1>Banner Plus dev server</h1>
<p class="lede">Drag the link to your bookmarks bar once. Then: edit a file in
<code>src/</code>, save, click the bookmark on the Banner page.</p>
__ERROR__
<div class="row"><a class="bm" href="__HREF__">Banner Plus (dev)</a>
<div class="meta">__SIZE__, rebuilt from <code>src/</code> on every click.</div></div>
<h2>Sources</h2>
<table>__ROWS__</table>
<footer>Serving 127.0.0.1 only, with no-store and a per-click cache-buster.
Loopback is exempt from mixed-content blocking, which is why an HTTPS Banner
page will load this over plain HTTP.</footer>
</main></body></html>
"""


def age(seconds: float) -> str:
    return ("%.0fs" % seconds if seconds < 90 else
            "%.0fm" % (seconds / 60) if seconds < 5400 else
            "%.1fh" % (seconds / 3600))


def build_index(port: int) -> bytes:
    error, size = "", "unbuilt"
    try:
        size = "%.1f KB" % (len(bundle()) / 1024)
    except Exception:
        error = '<div class="err">%s</div>' % traceback.format_exc()

    rows = []
    for p in fragments():
        rows.append("<tr><td>%s</td><td>%.1f KB</td><td>edited %s ago</td></tr>"
                    % (p.name, p.stat().st_size / 1024,
                       age(time.time() - p.stat().st_mtime)))

    html = (PAGE.replace("__HREF__", dev_bookmarklet(port).replace("&", "&amp;"))
                .replace("__ERROR__", error)
                .replace("__SIZE__", size)
                .replace("__ROWS__", "\n".join(rows)))
    return html.encode("utf-8")


def make_handler(port: int):
    class Handler(http.server.BaseHTTPRequestHandler):
        def send_body(self, body: bytes, ctype: str, code: int = 200):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            # An edit must be live on the next click, not after a TTL.
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in ("/", "/index.html"):
                # Rebuilt per request, so mtimes and sizes are current.
                return self.send_body(build_index(port), "text/html; charset=utf-8")
            if path == "/console.js":
                try:
                    js = bundle()
                except Exception:
                    # Surface the failure in the page that asked for it rather
                    # than only in this terminal.
                    msg = traceback.format_exc().replace("`", "'")
                    js = "alert('Banner Plus build failed:\\n\\n' + %r);" % msg
                return self.send_body(js.encode("utf-8"), "application/javascript; charset=utf-8")
            self.send_body(b"not found", "text/plain", 404)

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
    print(f"bundling {HERE / 'src'}")
    print(f"open     http://127.0.0.1:{args.port}/   and drag the dev link to your bookmarks bar")
    print("ctrl-c to stop\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
