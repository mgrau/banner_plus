#!/usr/bin/env python3
"""Drive the built console against a pretend Banner and check what it draws.

    python3 test/run.py
    python3 test/run.py --keep      # leave the browser open at the end

Builds docs/console.js, starts test/stub.py, and runs the checks below in a
headless Chrome. Each check is a snippet of JavaScript evaluated in the page:
it clicks something, waits for the DOM to settle, and reports pass or fail.

WHY IT DRIVES A BROWSER

Almost all of this program is a reaction to a click. A unit test of the pure
functions would cover the arithmetic and none of the parts that have actually
broken: a stale prefix cached from a 404, a drawer that would not close, an
edit that silently deleted a function. Those only show up when it runs.

WAITING

Never a fixed sleep. waitFor() polls a predicate, because the console fetches
in the background and a sleep long enough to be safe is long enough to make the
suite tedious. A check that times out reports what it was waiting for.
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stub  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 8802

# Shared helpers, prepended to every check.
PRELUDE = r"""
const app = () => document.getElementById("bc-app");
const $$ = (sel, root) => Array.from((root || app()).querySelectorAll(sel));
const text = (n) => (n ? n.textContent.trim() : "");
const status = () => text(app().children[0].children[2]);
const side = () => app().children[2].children[0];
const main = () => app().children[2].children[1];
const rightPane = () => app().children[2].children[3];
const drawer = () => app().lastElementChild;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(40);
  }
}

// A node whose visible text is exactly s, ignoring nested duplicates.
function byText(sel, s, root) {
  return $$(sel, root).filter((n) => text(n) === s)[0] || null;
}
function containing(sel, s, root) {
  return $$(sel, root).filter((n) => text(n).indexOf(s) > -1);
}
function click(n) {
  if (!n) throw new Error("nothing to click");
  n.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/* Sidebar rows. There is no id or class to hang off — the console styles
 * inline — so they are told apart by what they say: a section row carries a
 * five-digit CRN, a group row carries "N students". */
const sectionRows = () =>
  Array.from(side().children).filter(
    (n) => /\d{5}/.test(text(n)) && !/\d+ students/.test(text(n)));
const groupRows = () =>
  Array.from(side().children).filter((n) => /\d+ students/.test(text(n)));

/* Boot finishes with the section list, and until it does a background idle()
 * can overwrite whatever the check just caused. Every check that reads the
 * status line waits for this first. */
const booted = () => waitFor("boot to finish", () => sectionRows().length >= 1);

async function openFall101() {
  await booted();
  click(sectionRows().filter((r) => /PHYS 101/.test(text(r)))[0]);
  await waitFor("roster", () => $$("img", main()).length >= 3);
}

// A group with nothing in it, so a check that needs one does not depend on
// whichever check ran before it.
async function makeGroup(name) {
  await booted();
  click(byText("button", "+ New group from UINs", side()));
  await waitFor("the group editor", () => byText("div", "New group"));
  const card = byText("div", "New group").parentNode;
  $$("input", card)[0].value = name;
  click(byText("button", "Create group", card));
  await waitFor("the group in the sidebar", () => groupRows().length >= 1);
  return card;
}
"""

CHECKS = [
    ("terms load, and sub-terms are hidden", r"""
      await waitFor("term dropdown", () => app().querySelector("select").options.length > 1);
      const opts = Array.from(app().querySelector("select").options).map((o) => o.text);
      if (opts[0] !== "All terms") return "first option is " + opts[0];
      if (opts.indexOf("Fall 2026") < 0) return "Fall 2026 missing: " + opts.join("|");
      if (opts.some((o) => /Eight Weeks/.test(o)))
        return "an eight-week sub-term leaked in: " + opts.join("|");
      return true;
    """),

    ("my classes list, empty section hidden", r"""
      await waitFor("sections", () => sectionRows().length >= 1);
      const labels = sectionRows().map((r) => text(r));
      if (!labels.some((l) => /PHYS 101/.test(l))) return "no PHYS 101: " + labels.join("|");
      if (labels.some((l) => /PHYS 420/.test(l)))
        return "PHYS 420 has nobody in it and should be hidden";
      if (!/1 class/.test(status())) return "status says: " + status();
      return true;
    """),

    ("roster loads with photographs", r"""
      await openFall101();
      await waitFor("photos", () => /students/.test(status()) && !/Photos/.test(status()));
      const imgs = $$("img", main());
      if (imgs.length !== 3) return imgs.length + " cards, expected 3";
      const real = imgs.filter((i) => /^data:image\/png/.test(i.src)).length;
      // 900003 has no photo on file; the other two do.
      if (real !== 2) return real + " real photos, expected 2 (one student has none)";
      if (!/2\/3 photos/.test(status())) return "status says: " + status();
      return true;
    """),

    ("the photo grid shows a UIN under every name", r"""
      await openFall101();
      const cards = $$("img", main()).map((i) => i.parentNode);
      if (cards.length !== 3) return cards.length + " cards";
      for (const uin of ["01234567", "01234568", "01234569"])
        if (!cards.some((c) => text(c).indexOf(uin) > -1))
          return "no " + uin + " on any card: " + cards.map(text).join(" | ");
      // Under the name, above the major — reading order, not just present.
      const c = cards.filter((c) => /Jane A Doe/.test(text(c)))[0];
      const order = Array.from(c.children).map(text).join(">");
      if (!/Jane A Doe>01234567>Physics/.test(order)) return "wrong order: " + order;
      return true;
    """),

    ("names are title-cased, apostrophes and hyphens kept", r"""
      await openFall101();
      const names = $$("div", main()).map(text);
      if (!names.includes("Jane A Doe")) return "no 'Jane A Doe' in " + names.slice(0, 12).join("|");
      if (!names.includes("Mary-Jo O'Brien"))
        return "no 'Mary-Jo O'Brien' in " + names.slice(0, 12).join("|");
      return true;
    """),

    ("table view: columns, sort, no GPA column", r"""
      await openFall101();
      click(byText("button", "Table", main()));
      await waitFor("table", () => main().querySelector("table"));
      const heads = $$("th", main()).map((h) => text(h).replace(/[▲▼]\s*$/, "").trim());
      if (heads.some((h) => /GPA/i.test(h))) return "GPA column is back: " + heads.join("|");
      for (const want of ["Name", "UIN", "Major", "Standing", "Admitted", "Email"])
        if (!heads.includes(want)) return "missing column " + want + ": " + heads.join("|");
      const first = () => text($$("tr", main())[1].children[2]);
      const before = first();
      click(byText("th", "Name ▲", main()) || $$("th", main())[2]);
      await sleep(50);
      if (first() === before) return "sorting by Name changed nothing";
      click(byText("button", "Photos", main()));
      return true;
    """),

    ("student pane: schedule with rooms, transcript by season", r"""
      await openFall101();
      click($$("img", main())[0].parentNode);
      await waitFor("transcript", () => containing("div", "Transcript", rightPane()).length);
      const t = text(rightPane());
      if (!/PHYS 101/.test(t)) return "no current course";
      if (!/MWF 9:00am/.test(t)) return "no meeting time: " + t.slice(0, 300);
      if (!/Oceanography 200/.test(t)) return "no room";
      if (!/4 credits this term/.test(t)) return "no term credit total";
      // Seasons across, newest year first. The headings are uppercased in CSS,
      // so textContent is still "Fall".
      const seasons = $$("div", rightPane()).map(text);
      for (const s of ["Fall", "Spring", "Summer"])
        if (!seasons.includes(s)) return "no " + s + " column heading";
      // Term headings inside the grid, not the "Admitted: Fall 2024" fact: a
      // grid heading sits next to that term's credit total.
      const yearOrder = $$("span", rightPane())
        .filter((n) => /^(Fall|Spring|Summer) 20\d\d$/.test(text(n)) &&
                       / cr\b/.test(text(n.parentNode)))
        .map(text);
      if (yearOrder.join("|") !== "Fall 2026|Spring 2026|Summer 2025")
        return "wrong transcript order: " + yearOrder.join("|");
      if (!/Calculus I/.test(t) && !/MATH 211/.test(t)) return "older term missing";
      if (!/Cumulative GPA/.test(t)) return "no computed GPA";
      if (/\(Banner\)/.test(t)) return "the removed official-GPA line is still there";
      return true;
    """),

    ("confidential students are flagged", r"""
      await openFall101();
      click(byText("button", "Table", main()));
      await waitFor("table", () => main().querySelector("table"));
      const row = containing("tr", "John Smith", main())[0];
      if (!row) return "John Smith not in the table";
      if (!/\bC\b/.test(text(row.children[2]))) return "no confidential mark";
      click(byText("button", "Photos", main()));
      return true;
    """),

    ("scheduling: heatmap, and hovering names who is free", r"""
      await openFall101();
      click(byText("button", "Scheduling", main()));
      await waitFor("heatmap", () => rightPane().querySelector("table"));
      await waitFor("counts", () => /have scheduled classes/.test(text(rightPane())));
      if (!/3 of 3 have scheduled classes/.test(text(rightPane())))
        return "wrong count: " + text(rightPane()).slice(0, 120);
      const cells = $$("td > div", rightPane());
      if (cells.length < 100) return "only " + cells.length + " slots";
      // Mon 9:00-9:30 — two of the three are in PHYS 101 then.
      const rows = $$("tr", rightPane());
      const nine = rows.filter((r) => /^9am/.test(text(r.children[0])))[0];
      if (!nine) return "no 9am row";
      const cell = nine.children[1].firstElementChild;
      cell.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      await sleep(60);
      const panel = text(rightPane());
      if (!/Mon 9am/.test(panel)) return "hover panel did not update";
      if (!/In class/.test(panel)) return "no 'In class' list";
      if (!/Jane A Doe/.test(panel)) return "Jane should be in class at 9 on Monday";
      if (!/1 of 3 free/.test(panel)) return "wrong free count: " + panel.slice(0, 200);
      return true;
    """),

    ("panes share width, and the divider drags", r"""
      await openFall101();
      click($$("img", main())[0].parentNode);
      await waitFor("pane", () => rightPane().style.display === "block");
      const gut = app().children[2].children[2];
      if (gut.style.display !== "block") return "divider is hidden";
      const mainW = main().getBoundingClientRect().width;
      const rightW = rightPane().getBoundingClientRect().width;
      const bodyW = app().children[2].getBoundingClientRect().width;
      if (rightW < 100) return "right pane has no width";
      if (mainW + rightW > bodyW) return "panes overlap: " + mainW + "+" + rightW + ">" + bodyW;
      const before = rightPane().getBoundingClientRect().width;
      gut.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 800 }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 700 }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      const after = rightPane().getBoundingClientRect().width;
      if (Math.abs((after - before) - 100) > 4)
        return "drag moved it " + (after - before) + "px, expected ~100";
      return true;
    """),

    ("settings drawer opens, and Escape closes it", r"""
      const gear = containing("button", "⚙")[0];
      if (!gear) return "no gear button";
      click(gear);
      await sleep(300);
      if (drawer().style.visibility !== "visible") return "drawer did not open";
      const d = text(drawer());
      if (!/Show every term/.test(d)) return "no term setting";
      if (!/Hide empty sections/.test(d)) return "no empty-section setting";
      if (!/Reset table column widths/.test(d)) return "no width reset";
      if (!drawer().querySelector('a[href*="github.com"]')) return "no source link";
      if (/CSV/.test(d)) return "the removed CSV export is back";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(300);
      if (drawer().style.visibility !== "hidden") return "Escape did not close it";
      return true;
    """),

    ("groups: create empty, add by name, open", r"""
      await makeGroup("Research group");
      await waitFor("the empty-group message", () => /is empty/.test(status()));
      if (!/This group is empty/.test(text(main()))) return "no empty-group hint";

      // Reopen it and add someone by surname.
      click(containing("button", "✎", side())[0]);
      await waitFor("editor", () => byText("div", "Edit group"));
      const card2 = byText("div", "Edit group").parentNode;
      const search = $$("input", card2)[1];
      search.value = "Nguyen";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor("search results", () => containing("div", "01234570", card2).length, 9000);
      click(containing("div", "01234570", card2).pop());
      await waitFor("member row", () => /Members \(1\)/.test(text(card2)));
      click(byText("button", "Save", card2));
      await waitFor("roster", () => $$("img", main()).length >= 1, 9000);
      if (!/Linh Nguyen/.test(text(main()))) return "group roster: " + text(main()).slice(0, 200);
      // A pasted student has no CRN, so this exercises the CRN-free endpoints.
      if (!/Chemistry/.test(text(main()))) return "major not filled in for a group member";
      return true;
    """),

    ("dragging a student onto a group adds them", r"""
      await makeGroup("Drop target");
      await openFall101();
      const img = $$("img", main())[0];
      const dt = new DataTransfer();
      img.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      const grp = groupRows()[0];
      grp.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      grp.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      img.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      await sleep(80);
      if (!/added to Drop target/.test(status())) return "status says: " + status();
      if (!/1 students/.test(text(groupRows()[0]))) return "group shows " + text(groupRows()[0]);
      return true;
    """),

    ("printed photo roster fits and carries a legend", r"""
      await openFall101();
      const html = photoRosterDoc(S.students, "PHYS 101", "Fall 2026", 3);
      if (!/PHYS 101 &mdash; Fall 2026/.test(html)) return "no title";
      if (!/3 students/.test(html)) return "no count";
      if (!/Physics \(2\)/.test(html)) return "no major legend: " + html.slice(0, 400);
      for (const uin of ["01234567", "01234568", "01234569"])
        if (html.indexOf('class="uin">' + uin) < 0) return "no UIN " + uin + " on the sheet";
      if (!(html.match(/class="card"/g) || []).length === 3) return "wrong card count";
      if (!/directory information confidential/.test(html)) return "no confidential note";
      if (!/charset=utf-8|<meta charset=utf-8>/.test(html)) return "no charset";
      return true;
    """),

    ("printed free-time sheet names who was left out", r"""
      await openFall101();
      await waitFor("histories", () => S.students.every((s) => s.history), 9000)
        .catch(() => null);
      await hydrate(S.students, curTerm());
      const html = freeTimeDoc(S.students, curTerm(), "Fall 2026", 5);
      if (!/Shared free time/.test(html)) return "no title";
      if (!/Best windows/.test(html)) return "no best windows";
      if (!/darker means more of them are free/.test(html)) return "no legend caption";
      return true;
    """),

    ("clicked away from the class list, it wakes the app up", r"""
      // Started on /menu: no synchronizer token in the page, and the stub
      // answers courseList 401 until the class-list page has been served.
      if (document.querySelector('meta[name="synchronizerToken"]'))
        return "the harness started on the wrong page";
      await booted();
      const labels = sectionRows().map(text);
      if (!labels.some((l) => /PHYS 101/.test(l)))
        return "no classes after warm-up: " + status();
      await openFall101();
      return true;
    """),

    ("no stray globals leak onto window", r"""
      for (const k of ["S", "el", "hydrate", "fetchRoster", "photoRosterDoc"])
        if (k in window) return k + " escaped onto window";
      return true;
    """),
]

# The last three checks reach into the console's own scope, which a bookmarklet
# does not expose. They run with the IIFE opened up; see harness().
INTERNAL = {"printed photo roster fits and carries a legend",
            "printed free-time sheet names who was left out"}

# Checks that start somewhere other than the class-list page. The default is
# the class list because that is where most people click it; /menu is the case
# that used to need a manual visit to Faculty Class List first.
START_PAGE = {"clicked away from the class list, it wakes the app up":
              "/FacultySelfService/ssb/menu"}


def build() -> str:
    """The bundle, in memory.

    Deliberately not a shell out to build.py: that also writes docs/index.html,
    and running it without --base once published an install page pointing at
    https://USERNAME.github.io. Tests must not be able to break the site.
    """
    sys.path.insert(0, str(ROOT / "bookmarklet"))
    import build as builder
    return builder.bundle()


def harness(js: str, internal: bool) -> str:
    """The console, optionally with its scope exposed for white-box checks.

    The internals go out through one global rather than by unwrapping the IIFE,
    so the program under test is still the program that ships.
    """
    if not internal:
        return js
    tail = "})();"
    i = js.rstrip().rfind(tail)
    return (js[:i] + "  window.__bp = { S, el, hydrate, curTerm, "
            "photoRosterDoc, freeTimeDoc };\n" + js[i:])


def check_script(script: str) -> str:
    """Wrap one check so the page runs it and POSTs the verdict back.

    Reporting through the stub rather than through Chrome's output is what lets
    the run finish the instant the check does. --dump-dom would mean guessing
    how long the page needs, and --virtual-time-budget fast-forwards the timers
    right past the fetches this is meant to be waiting on.
    """
    return f"""(async () => {{
{PRELUDE}
  let out;
  try {{
    await waitFor("the console to open", () => document.getElementById("bc-app"));
    const r = await (async () => {{ {script} }})();
    out = r === true ? {{ok: true}} : {{ok: false, why: String(r)}};
  }} catch (e) {{
    out = {{ok: false, why: String((e && e.message) || e)}};
  }}
  try {{ await fetch("/result", {{method: "POST", body: JSON.stringify(out)}}); }} catch (e) {{}}
}})();"""


def run_one(srv, url: str, timeout: int = 45) -> tuple[bool, str]:
    """One check, in its own browser.

    A fresh profile per check, because groups and pane widths live in
    localStorage — sharing one would make a check's result depend on which
    checks ran before it.
    """
    srv.done.clear()
    srv.result = None
    srv.warm = False           # every check gets a cold Banner session
    profile = Path(tempfile.mkdtemp(prefix="bp-chrome-"))
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--no-first-run", "--disable-extensions", "--window-size=1400,900",
         f"--user-data-dir={profile}", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not srv.done.wait(timeout):
            return False, f"no verdict within {timeout}s — the check hung or the console threw"
        obj = json.loads(srv.result or "{}")
        return bool(obj.get("ok")), obj.get("why", "")
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="run only checks whose name contains this")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if not Path(CHROME).exists():
        print(f"Chrome not found at {CHROME}")
        return 2

    js = build()
    srv = stub.serve(PORT, js, verbose=args.verbose)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    root = f"http://127.0.0.1:{PORT}"
    default_page = "/FacultySelfService/ssb/classListApp/classListPage"

    checks = [(n, s) for n, s in CHECKS if not args.only or args.only in n]
    failed = []
    try:
        for name, script in checks:
            internal = name in INTERNAL
            srv.console_js = harness(js, internal)
            if internal:
                script = ("const {S, el, hydrate, curTerm, photoRosterDoc, freeTimeDoc} "
                          "= window.__bp;\n") + script
            srv.check_js = check_script(script)
            ok, why = run_one(srv, root + START_PAGE.get(name, default_page))
            print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "\n         " + why))
            if not ok:
                failed.append(name)
    finally:
        srv.shutdown()

    print()
    if failed:
        print(f"{len(failed)} of {len(checks)} checks failed")
        return 1
    print(f"all {len(checks)} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
