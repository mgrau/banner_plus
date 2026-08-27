/* ---- The window itself ----------------------------------------------------
 *
 * The full-screen overlay and everything permanent inside it: the state object
 * every view reads, the toolbar, the progress strip, the settings drawer, and
 * the three panes with the divider between them.
 *
 * Building this file's contents has side effects — it puts the app on screen —
 * so it runs after the data layer is defined and before any view that draws
 * into it.
 */

var S = {
  term: null, termLabel: "", allTerms: false,
  sections: [], groups: loadGroups(),
  source: null,            // {kind:'section'|'group', crn|name, label}
  students: [], sel: {}, focus: null,
  sat: false,              // include Saturday in the free-time grid
  // Under "All terms" the sidebar mixes terms, so every data call follows the
  // section that was opened rather than whatever the dropdown reads.
  activeTerm: null, activeLabel: "",
  table: false, hideEmpty: true
};

var ALL_TERMS_CODE = "__all__";
function curTerm() { return S.activeTerm || S.term; }
function curLabel() { return S.activeLabel || S.termLabel; }
function newestStandard() {
  var std = ALL_TERMS.filter(isStandardTerm);
  return std.length ? std[0] : (ALL_TERMS[0] || null);
}

var old = document.getElementById("bc-app");
if (old) old.remove();

var app = el("div", { id: "bc-app", style: {
  position: "fixed", top: "0", left: "0", right: "0", bottom: "0", zIndex: 2147483647,
  background: "#eef1f6", color: "#16191f", display: "flex", flexDirection: "column",
  font: "13px/1.45 -apple-system,Segoe UI,Arial,sans-serif"
} });
document.body.appendChild(app);

function btn(label, primary) {
  return el("button", { text: label, style: {
    padding: "5px 11px", borderRadius: "6px", cursor: "pointer", font: "inherit",
    border: primary ? "0" : "1px solid #c7d0dd",
    background: primary ? "#2a78d6" : "#fff",
    color: primary ? "#fff" : "#41556f", fontWeight: primary ? "600" : "400"
  } });
}

// toolbar
var bar = el("div", { style: {
  display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px",
  background: "#1f2430", color: "#eceff4", flex: "0 0 auto", flexWrap: "wrap"
} });
bar.appendChild(el("div", { text: "Banner console", style: { fontWeight: "700" } }));

var termSel = el("select", { style: {
  padding: "4px 7px", borderRadius: "5px", border: "1px solid #3b455a",
  background: "#161a23", color: "#eceff4", font: "inherit" } });
bar.appendChild(termSel);

var status = el("div", { style: { color: "#9fb4d0", fontSize: "12px", marginLeft: "6px" } });
bar.appendChild(status);

var spacer = el("div", { style: { marginLeft: "auto", display: "flex", gap: "8px",
  position: "relative" } });
bar.appendChild(spacer);

/* Settings live behind a gear rather than on the toolbar: they are set once
 * and then not thought about, and a permanent checkbox spends attention every
 * time you look at the bar for something else.
 *
 * A drawer from the right rather than a dropdown under the gear. A dropdown
 * is a small box pinned to a corner \u2014 fine for two switches, cramped for
 * anything that wants a sentence saying what it does. */
var allTermsBox = el("input", { type: "checkbox" });
var hideEmptyBox = el("input", { type: "checkbox" });
hideEmptyBox.checked = true;

var drawer = el("div", { style: {
  position: "absolute", top: "0", right: "0", bottom: "0", width: "330px",
  maxWidth: "84%", background: "#fff", color: "#16191f", zIndex: "30",
  boxShadow: "-10px 0 30px rgba(15,18,25,.22)", padding: "16px 18px",
  overflowY: "auto", transform: "translateX(100%)", visibility: "hidden",
  transition: "transform .22s ease" } });

/* State in a variable, not read back out of the style attribute: the browser
 * normalises "translateX(0)" to "translateX(0px)", so comparing the string
 * reported the drawer as closed while it was open and Escape did nothing. */
var drawerShown = false;
function drawerIsOpen() { return drawerShown; }
function drawerOpen(open) {
  drawerShown = !!open;
  drawer.style.transform = open ? "translateX(0)" : "translateX(100%)";
  // Hidden as well as translated: a transform alone leaves it in the tab
  // order and under the pointer.
  drawer.style.visibility = open ? "visible" : "hidden";
}

var dHead = el("div", { style: { display: "flex", alignItems: "center", marginBottom: "2px" } });
dHead.appendChild(el("div", { text: "Settings", style: { fontWeight: "700", fontSize: "15px" } }));
var dClose = el("button", { text: "\u00d7", style: {
  marginLeft: "auto", border: "0", background: "transparent", cursor: "pointer",
  fontSize: "21px", color: "#9aa1ab", lineHeight: "1" } });
dClose.onclick = function () { drawerOpen(false); };
dHead.appendChild(dClose);
drawer.appendChild(dHead);

function setting(box, labelText, hint, onChange) {
  var row = el("label", { style: { display: "flex", gap: "8px", alignItems: "flex-start",
    padding: "10px 2px", cursor: "pointer", borderTop: "1px solid #eef1f5" } });
  box.onchange = onChange;
  row.appendChild(box);
  var txt = el("div");
  txt.appendChild(el("div", { text: labelText, style: { fontSize: "13px", fontWeight: "600" } }));
  if (hint) txt.appendChild(el("div", { text: hint, style: {
    fontSize: "11.5px", color: "#6b7280", lineHeight: "1.45", marginTop: "1px" } }));
  row.appendChild(txt);
  return row;
}

drawer.appendChild(setting(allTermsBox, "Show every term",
  "Includes eight-week sessions and medical-school terms, which are normally hidden.",
  function () { S.allTerms = allTermsBox.checked; fillTerms(); termSel.onchange(); }));
drawer.appendChild(setting(hideEmptyBox, "Hide empty sections",
  "Sections with nobody enrolled \u2014 cross-listed shells, dissertation sections.",
  function () { S.hideEmpty = hideEmptyBox.checked; loadSections(); }));

/* Faces per row on the printed roster.
 *
 * This used to fit itself: render at three columns, measure the real row
 * heights, add a column, repeat until it came in under two pages. Clever, and
 * wrong about what the number is for — how large a face has to be to be
 * recognised from the back of the room is a judgement about the room, not
 * about the page budget. So it is a dial, and the auto-fit is gone.
 *
 * Fewer across means larger faces and more paper. Five fits a letter page at
 * about an inch and a quarter each, which is the size Banner's own 200px
 * photographs stop looking sharp at.
 */
var COLS_KEY = "banner_console_cols";
var printCols = 5;
try {
  var storedCols = parseInt(localStorage.getItem(COLS_KEY), 10);
  if (isFinite(storedCols) && storedCols >= 2 && storedCols <= 10) printCols = storedCols;
} catch (e) {}

function slider(labelText, hint, min, max, value, onChange) {
  var row = el("div", { style: { padding: "10px 2px", borderTop: "1px solid #eef1f5" } });
  var head = el("div", { style: { display: "flex", alignItems: "baseline", gap: "8px" } });
  head.appendChild(el("div", { text: labelText, style: { fontSize: "13px", fontWeight: "600" } }));
  var readout = el("div", { text: String(value), style: {
    marginLeft: "auto", fontSize: "13px", fontWeight: "700", color: "#2a78d6",
    fontVariantNumeric: "tabular-nums" } });
  head.appendChild(readout);
  row.appendChild(head);

  var input = el("input", { type: "range", min: String(min), max: String(max), step: "1",
    value: String(value), style: { width: "100%", margin: "7px 0 2px", accentColor: "#2a78d6" } });
  // Both events: input tracks the drag, change catches a keyboard arrow.
  input.oninput = input.onchange = function () {
    readout.textContent = input.value;
    onChange(parseInt(input.value, 10));
  };
  row.appendChild(input);

  var ticks = el("div", { style: { display: "flex", justifyContent: "space-between",
    fontSize: "10px", color: "#9aa1ab", fontVariantNumeric: "tabular-nums" } });
  ticks.appendChild(el("span", { text: String(min) }));
  ticks.appendChild(el("span", { text: String(max) }));
  row.appendChild(ticks);

  if (hint) row.appendChild(el("div", { text: hint, style: {
    fontSize: "11.5px", color: "#6b7280", lineHeight: "1.45", marginTop: "4px" } }));
  return row;
}

drawer.appendChild(slider("Faces per row",
  "On the printed photo roster. Fewer across means larger faces and more pages.",
  2, 10, printCols, function (n) {
    printCols = n;
    try { localStorage.setItem(COLS_KEY, String(n)); } catch (e) {}
  }));

var resetW = el("button", { text: "Reset table column widths", style: {
  width: "100%", marginTop: "12px", padding: "7px", borderRadius: "6px",
  border: "1px solid #c7d0dd", background: "#fff", color: "#41556f",
  cursor: "pointer", font: "inherit", fontSize: "12.5px" } });
resetW.onclick = function () { colW = {}; saveColW(); renderMain(); };
drawer.appendChild(resetW);

var ghLink = el("a", { href: "https://github.com/mgrau/banner_plus", target: "_blank",
  rel: "noopener", style: {
    display: "flex", alignItems: "center", gap: "7px", marginTop: "18px",
    paddingTop: "12px", borderTop: "1px solid #eef1f5", color: "#41556f",
    textDecoration: "none", fontSize: "12.5px" } });
ghLink.innerHTML =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path ' +
  'd="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49' +
  '-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 ' +
  '1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36' +
  '-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 ' +
  '1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 ' +
  '1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>' +
  "<span>Source, and how it works</span>";
drawer.appendChild(ghLink);
drawer.appendChild(el("div", {
  text: "Runs in your browser on the Banner session you are already signed in to. " +
        "Nothing is uploaded.",
  style: { fontSize: "11px", color: "#9aa1ab", marginTop: "10px", lineHeight: "1.45" } }));

document.addEventListener("mousedown", function (ev) {
  if (!drawerIsOpen()) return;
  if (drawer.contains(ev.target) || ev.target === gearBtn) return;
  drawerOpen(false);
}, true);
document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape" && drawerIsOpen()) drawerOpen(false);
}, true);

function toolBtn(label, fn) {
  var b = el("button", { text: label, style: {
    padding: "5px 11px", borderRadius: "6px", border: "1px solid #3b455a", cursor: "pointer",
    background: "transparent", color: "#9fb4d0", font: "inherit" } });
  b.onclick = fn; spacer.appendChild(b); return b;
}

/* A progress strip under the toolbar. Loading a roster with photos, or a term
 * sweep, takes long enough that a frozen-looking screen is the natural
 * reading. Where a total is known the bar fills; where it is not — a single
 * request in flight — it slides, which says "working" without implying a
 * fraction it cannot compute. */
var oldStyle = document.getElementById("bc-style");
if (oldStyle) oldStyle.remove();
document.head.appendChild(el("style", { id: "bc-style",
  text: "@keyframes bc-slide{0%{transform:translateX(-110%)}100%{transform:translateX(420%)}}" }));

var progWrap = el("div", { style: {
  height: "3px", flex: "0 0 auto", background: "#2b3444", overflow: "hidden",
  opacity: "0", transition: "opacity .2s ease" } });
var progBar = el("div", { style: {
  height: "100%", width: "0%", background: "#4c8dff", transition: "width .18s ease" } });
progWrap.appendChild(progBar);

/* Progress runs 0 -> 100 across a whole operation, not per request.
 *
 * Loading a roster is two phases with very different costs: one call for the
 * students, then one per photo. Each is given a slice of the bar, so the fill
 * is monotonic and a full bar means finished — rather than the bar completing
 * once for the roster and again for the photos.
 *
 * Within a phase whose size is unknown — a single request in flight — the bar
 * eases toward the top of its slice without reaching it. That is the usual
 * convention and it is honest in the only way available: it says "still
 * working" while promising nothing about how far along it is. As soon as a
 * real count arrives, prog() takes over and the easing stops. */
var P = { val: 0, lo: 0, hi: 1, timer: null, fade: [] };

function progPaint() { progBar.style.width = (Math.min(1, P.val) * 100).toFixed(1) + "%"; }
function progStop() { if (P.timer) { clearInterval(P.timer); P.timer = null; } }

/* Cancel the previous operation's fade-out. Its timers fire half a second
 * after it finishes, and a click inside that window had them land on the new
 * operation — zeroing a bar that had already started filling. */
function progCancelFade() {
  P.fade.forEach(function (t) { clearTimeout(t); });
  P.fade = [];
}

function progEase(ceiling) {
  progStop();
  P.timer = setInterval(function () {
    var gap = ceiling - P.val;
    if (gap <= 0.003) return;
    P.val += gap * 0.07;
    progPaint();
  }, 110);
}

function taskBegin(text) {
  if (text != null) status.textContent = text;
  progCancelFade();
  P.lo = 0; P.hi = 1; P.val = 0;
  progBar.style.transition = "width .2s ease";
  progWrap.style.opacity = "1";
  progPaint();
  progEase(0.9);
}

// Claim [lo,hi] of the bar for what comes next.
function taskPhase(text, lo, hi) {
  if (text != null) status.textContent = text;
  progCancelFade();
  P.lo = lo; P.hi = hi;
  if (P.val < lo) { P.val = lo; progPaint(); }
  progWrap.style.opacity = "1";
  progEase(hi - (hi - lo) * 0.08);
}

function prog(text, d, t) {
  if (text != null) status.textContent = text;
  progCancelFade();
  progStop();
  progWrap.style.opacity = "1";
  P.val = P.lo + (P.hi - P.lo) * (t ? d / t : 0);
  progPaint();
}

function idle(text) {
  if (text != null) status.textContent = text;
  progStop();
  P.val = 1; P.lo = 0; P.hi = 1;
  progPaint();
  progCancelFade();
  P.fade.push(setTimeout(function () {
    progWrap.style.opacity = "0";
    P.fade.push(setTimeout(function () {
      P.val = 0; progBar.style.transition = "none"; progPaint();
    }, 240));
  }, 260));
}

var body = el("div", { style: { flex: "1 1 auto", display: "flex", minHeight: "0" } });
app.appendChild(bar); app.appendChild(progWrap); app.appendChild(body);
// Last, so it paints over the panes and leaves their indices alone.
app.appendChild(drawer);

var side = el("div", { style: {
  width: "230px", flex: "0 0 auto", background: "#fff", borderRight: "1px solid #d8dde5",
  overflowY: "auto", padding: "10px" } });
var main = el("div", { style: { flex: "1 1 auto", overflowY: "auto", overflowX: "auto",
  padding: "12px", minWidth: "0" } });
/* The right pane's width is a preference: a transcript wants room, a
 * scheduling grid wants more, and how much of the roster you want to keep in
 * view is a judgement only the person looking can make. Dragged width
 * persists. */
var RIGHTW_KEY = "banner_console_rightw";
var rightW = 520;
try {
  var stored = parseInt(localStorage.getItem(RIGHTW_KEY), 10);
  if (isFinite(stored) && stored >= 320) rightW = stored;
} catch (e) {}

var gutter = el("div", { title: "Drag to resize", style: {
  width: "7px", flex: "0 0 auto", cursor: "col-resize", background: "#dde3ec",
  display: "none", position: "relative" } });
// A visible grip, so the gutter reads as a handle rather than a border.
gutter.appendChild(el("div", { style: {
  position: "absolute", top: "50%", left: "2px", width: "3px", height: "34px",
  marginTop: "-17px", borderRadius: "2px", background: "#98a4b6" } }));

var right = el("div", { style: {
  width: rightW + "px", flex: "0 0 auto", background: "#fff",
  overflowY: "auto", padding: "14px", display: "none", minWidth: "0" } });

gutter.addEventListener("mousedown", function (ev) {
  ev.preventDefault();
  /* startW is the width we last set, not the pane's measured width. The pane
   * has padding and no border-box, so its rect is 28px wider than its style
   * width — measuring here and assigning there made every drag overshoot by
   * that much, and the error compounded across drags. */
  var startX = ev.clientX, startW = rightW;
  var prev = document.body.style.cursor;
  document.body.style.cursor = "col-resize";
  function move(e) {
    // Dragging left widens the right pane, so the delta is inverted. The
    // lower bound keeps the pane usable; the upper leaves the roster visible.
    var w = Math.round(startW - (e.clientX - startX));
    var max = Math.max(360, body.getBoundingClientRect().width - 320);
    rightW = Math.max(320, Math.min(max, w));
    right.style.width = rightW + "px";
  }
  function up() {
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("mouseup", up, true);
    document.body.style.cursor = prev;
    try { localStorage.setItem(RIGHTW_KEY, String(rightW)); } catch (e) {}
  }
  document.addEventListener("mousemove", move, true);
  document.addEventListener("mouseup", up, true);
});

function setRightOpen(open) {
  right.style.display = open ? "block" : "none";
  gutter.style.display = open ? "block" : "none";
  if (open) right.style.width = rightW + "px";
}

body.appendChild(side); body.appendChild(main);
body.appendChild(gutter); body.appendChild(right);

var gearBtn = toolBtn("⚙", function () {
  drawerOpen(!drawerIsOpen());
});
gearBtn.title = "Settings";

toolBtn("✕", function () { app.remove(); });
