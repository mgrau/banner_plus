/* ---- The roster ------------------------------------------------------------
 *
 * The middle pane, in two forms of the same list. Photos when you are
 * recognising faces; a sortable table with resizable columns when you are
 * reading — scanning majors, checking who is a senior, pulling an email.
 *
 * Both support the same two gestures: pick one student to open on the right,
 * and select a set to act on. The table adds drag-across-rows because a run of
 * rows is a thing you can sweep; the grid does not, because its photos are
 * drag handles for adding students to a group.
 */

/* Dragging students to a group.
 *
 * The photo is the handle, not the whole row: rows already own a drag gesture
 * for range-selection, and one element cannot mean two things. A photo is also
 * the most object-like part of a row — the thing that looks draggable.
 *
 * Dragging a selected student carries the whole selection; dragging an
 * unselected one carries just that student, the way a file manager behaves. */
function dragPayload(s) {
  var sel = S.students.filter(function (x) { return S.sel[x.key]; });
  var carry = (S.sel[s.key] && sel.length) ? sel : [s];
  return carry.map(function (x) { return { uin: x.uin, name: x.name }; })
              .filter(function (x) { return x.uin; });
}

function makeDragHandle(node, s) {
  node.draggable = true;
  node.title = "Drag to a group in the sidebar";
  // Stops the row's own range-select gesture from starting on the handle.
  node.addEventListener("mousedown", function (ev) { ev.stopPropagation(); }, true);
  node.addEventListener("dragstart", function (ev) {
    var carry = dragPayload(s);
    ev.dataTransfer.effectAllowed = "copy";
    try {
      ev.dataTransfer.setData("application/x-bc-students", JSON.stringify(carry));
      ev.dataTransfer.setData("text/plain",
        carry.map(function (x) { return x.uin; }).join(" "));
    } catch (e) {}
    dragCarry = carry;                 // dataTransfer is unreadable during dragover
    document.body.setAttribute("data-bc-dragging", String(carry.length));
  });
  node.addEventListener("dragend", function () {
    dragCarry = null;
    document.body.removeAttribute("data-bc-dragging");
    renderSide();
  });
}

var dragCarry = null;

function selectedStudents() {
  var out = S.students.filter(function (s) { return S.sel[s.key]; });
  return out.length ? out : S.students;
}

function renderMain() {
  main.innerHTML = "";
  if (!S.source) {
    main.appendChild(el("div", { text: "Pick a class or a group on the left.",
      style: { color: "#6b7280", padding: "20px 4px" } }));
    return;
  }

  var head = el("div", { style: { display: "flex", alignItems: "center", gap: "8px",
    marginBottom: "10px", flexWrap: "wrap" } });
  head.appendChild(el("div", { text: S.source.label,
    style: { fontSize: "17px", fontWeight: "700" } }));
  head.appendChild(el("div", { text: S.students.length + " students",
    style: { color: "#6b7280", fontSize: "12.5px" } }));

  var nSel = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).length;
  var selInfo = el("div", { text: nSel ? nSel + " selected" : "",
    style: { color: "#2a78d6", fontSize: "12.5px", fontWeight: "600" } });
  selInfoRef = selInfo;
  head.appendChild(selInfo);

  var acts = el("div", { style: { marginLeft: "auto", display: "flex", gap: "6px",
    flexWrap: "wrap", alignItems: "center" } });

  // A segmented toggle rather than a checkbox: two named views, one visibly
  // current. "table ☐" left you working out what unchecking would give you.
  var seg = el("div", { style: {
    display: "flex", border: "1px solid #c7d0dd", borderRadius: "7px",
    overflow: "hidden", marginRight: "4px" } });
  [["Photos", false], ["Table", true]].forEach(function (o, i) {
    var on = S.table === o[1];
    var b = el("button", { text: o[0], style: {
      padding: "5px 12px", border: "0", cursor: "pointer", font: "inherit", fontSize: "12px",
      background: on ? "#2a78d6" : "#fff", color: on ? "#fff" : "#41556f",
      fontWeight: on ? "600" : "400",
      borderLeft: i ? "1px solid " + (on ? "#2a78d6" : "#c7d0dd") : "0" } });
    b.onclick = function () {
      if (S.table === o[1]) return;
      S.table = o[1]; saveView(); renderMain();
    };
    seg.appendChild(b);
  });
  acts.appendChild(seg);

  var all = btn("Select all"); all.onclick = function () {
    S.students.forEach(function (s) { S.sel[s.key] = true; }); renderMain();
  };
  var none = btn("Clear"); none.onclick = function () { S.sel = {}; renderMain(); };
  var sched = btn("Scheduling", true); sched.onclick = openScheduling;
  var pr = btn("Print photo roster"); pr.onclick = printPhotoRoster;
  // Offering "Select all" and "Print photo roster" for an empty group is a
  // menu of things that cannot happen.
  if (S.students.length) {
    [all, none, sched, pr].forEach(function (b) { acts.appendChild(b); });
  }
  head.appendChild(acts);
  main.appendChild(head);

  if (S.table) { main.appendChild(studentTable()); return; }

  if (!S.students.length) {
    var hint = el("div", { style: { color: "#6b7280", padding: "24px 4px", maxWidth: "34rem" } });
    hint.appendChild(el("div", { text: "This group is empty.",
      style: { fontWeight: "600", marginBottom: "4px" } }));
    hint.appendChild(el("div", {
      text: S.source.kind === "group"
        ? "Open a class, select students, and drag one of their photos onto " +
          S.source.label + " in the sidebar. Or use the pencil to add them by name."
        : "Nobody is enrolled in this section.",
      style: { fontSize: "13px", lineHeight: "1.5" } }));
    main.appendChild(hint);
    return;
  }

  var grid = el("div", { style: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(104px,1fr))", gap: "10px" } });
  S.students.forEach(function (s) {
    var on = !!S.sel[s.key];
    var card = el("div", { style: {
      position: "relative", background: "#fff", borderRadius: "8px", padding: "6px",
      border: on ? "2px solid #2a78d6" : "1px solid #d8dde5", cursor: "pointer",
      boxShadow: S.focus === s ? "0 0 0 2px #9ec5f4" : "none" } });
    var img = el("img", { src: s.photo || SILHOUETTE, style: {
      width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: "5px", display: "block",
      background: "#eee" } });
    s._img = img;
    makeDragHandle(img, s);
    card.appendChild(img);
    card.appendChild(el("div", { text: s.name, style: {
      fontSize: "11.5px", fontWeight: "600", marginTop: "4px", lineHeight: "1.2" } }));
    card.appendChild(el("div", { text: (s.majors || []).join(" / "), style: {
      fontSize: "10px", color: "#6b7280", lineHeight: "1.2",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }));
    card.onclick = function () { focusStudent(s); };

    var tick = el("div", { text: on ? "✓" : "", title: "Select", style: {
      position: "absolute", top: "9px", left: "9px", width: "18px", height: "18px",
      borderRadius: "4px", border: "1.5px solid " + (on ? "#2a78d6" : "#c7d0dd"),
      background: on ? "#2a78d6" : "rgba(255,255,255,.85)", color: "#fff",
      fontSize: "12px", lineHeight: "16px", textAlign: "center", fontWeight: "700" } });
    tick.onclick = function (ev) {
      ev.stopPropagation();
      S.sel[s.key] = !S.sel[s.key];
      renderMain();
    };
    card.appendChild(tick);
    grid.appendChild(card);
  });
  main.appendChild(grid);
}

/* A table beats a wall of faces when you are reading rather than recognising —
 * scanning majors, checking who is a senior, pulling an email. Columns sort on
 * click, since that is the only thing a table offers that the grid cannot. */
var VIEW_KEY = "banner_console_view";
function saveView() {
  try { localStorage.setItem(VIEW_KEY, S.table ? "table" : "photos"); } catch (e) {}
}
try { S.table = localStorage.getItem(VIEW_KEY) === "table"; } catch (e) {}

var tableSort = { col: "name", dir: 1 };
var suppressUntil = 0;
var selInfoRef = null;

function updateSelCount() {
  if (!selInfoRef) return;
  var n = 0;
  S.students.forEach(function (s) { if (S.sel[s.key]) n++; });
  selInfoRef.textContent = n ? n + " selected" : "";
}

/* Column widths persist, because a width you dragged is a preference, not a
 * property of the roster you happened to be looking at. */
var COLW_KEY = "banner_console_colw";
var colW = {};
try { colW = JSON.parse(localStorage.getItem(COLW_KEY)) || {}; } catch (e) { colW = {}; }
function saveColW() {
  try { localStorage.setItem(COLW_KEY, JSON.stringify(colW)); } catch (e) {}
}

var COLW_DEFAULT = { name: 190, uin: 92, majors: 210, standing: 95, admit: 100, email: 190 };
var SEL_W = 30, PIC_W = 38;        // the two fixed leading columns

function widthOf(key) { return colW[key] || COLW_DEFAULT[key] || 120; }

function tableWidth(COLS) {
  return COLS.reduce(function (a, c) { return a + widthOf(c.key); }, SEL_W + PIC_W);
}

/* Drag handle on a header's trailing edge. Width is tracked on the <col>
 * rather than the <th> so the whole column follows, and mousedown stops
 * propagating so a drag never registers as a sort. */
var tblRef = null;
function addResizer(th, colEl, key, COLS) {
  var grip = el("div", { style: {
    position: "absolute", top: "0", right: "-3px", width: "7px", height: "100%",
    cursor: "col-resize", userSelect: "none" } });
  grip.onclick = function (ev) { ev.stopPropagation(); };
  grip.onmousedown = function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    var startX = ev.clientX;
    var startW = widthOf(key);
    var prevCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    function move(e) {
      var w = Math.max(56, Math.round(startW + (e.clientX - startX)));
      colW[key] = w;
      colEl.style.width = w + "px";
      // min-width tracks the columns so the table can still outgrow the pane
      // and scroll, rather than squeezing its neighbours.
      tblRef.style.minWidth = tableWidth(COLS) + "px";
    }
    function up() {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
      document.body.style.cursor = prevCursor;
      saveColW();
    }
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  };
  th.appendChild(grip);
}

function studentTable() {
  var COLS = [
    { key: "name", label: "Name", get: function (s) { return s.name; } },
    { key: "uin", label: "UIN", get: function (s) { return s.uin; } },
    { key: "majors", label: "Major", get: function (s) { return (s.majors || []).join(" / "); } },
    { key: "standing", label: "Standing", get: function (s) { return s.standing || ""; } },
    { key: "admit", label: "Admitted", get: function (s) { return s.admit || ""; } },
    { key: "email", label: "Email", get: function (s) { return s.email || ""; } }
  ];
  var col = COLS.filter(function (c) { return c.key === tableSort.col; })[0] || COLS[0];
  // Every column is text. numeric:true keeps UINs and "2Y"-style values in
  // human order rather than lexical.
  var rows = S.students.slice().sort(function (a, b) {
    return String(col.get(a)).localeCompare(String(col.get(b)), undefined, { numeric: true }) *
      tableSort.dir;
  });

  /* Fills the pane, and every dragged width stays exact.
   *
   * table-layout:fixed is what makes a dragged width stick; with auto layout
   * the browser re-decides column widths from the content on every render.
   *
   * width:100% alone would redistribute the surplus across all the columns,
   * undoing a drag; a fixed pixel width alone would leave the table stuck at
   * its old size when the pane narrows for the detail view, so it overflowed
   * and looked as though the right pane had covered it. A trailing spacer
   * column with no width of its own absorbs whatever is left over, and
   * min-width keeps the columns honest when the pane is too narrow for them. */
  var tbl = el("table", { style: { borderCollapse: "collapse", tableLayout: "fixed",
    background: "#fff", borderRadius: "8px", fontSize: "12.5px",
    width: "100%", minWidth: tableWidth(COLS) + "px" } });

  var cg = el("colgroup");
  cg.appendChild(el("col", { style: { width: SEL_W + "px" } }));
  cg.appendChild(el("col", { style: { width: PIC_W + "px" } }));
  var colEls = COLS.map(function (c) {
    var ce = el("col", { style: { width: widthOf(c.key) + "px" } });
    cg.appendChild(ce);
    return ce;
  });
  cg.appendChild(el("col"));          // spacer: takes the slack
  tbl.appendChild(cg);
  tblRef = tbl;

  var hr = el("tr");
  hr.appendChild(el("th", { style: { background: "#f4f6fa", borderBottom: "1px solid #d8dde5" } }));
  hr.appendChild(el("th", { style: { background: "#f4f6fa", borderBottom: "1px solid #d8dde5" } }));
  COLS.forEach(function (c, i) {
    var th = el("th", { title: c.label,
      text: c.label + (tableSort.col === c.key ? (tableSort.dir > 0 ? " ▲" : " ▼") : ""),
      style: { textAlign: "left", padding: "7px 8px", background: "#f4f6fa", cursor: "pointer",
               borderBottom: "1px solid #d8dde5", fontWeight: "600", color: "#41556f",
               whiteSpace: "nowrap", position: "relative", overflow: "hidden",
               textOverflow: "ellipsis" } });
    th.onclick = function () {
      if (tableSort.col === c.key) tableSort.dir *= -1;
      else { tableSort.col = c.key; tableSort.dir = 1; }
      renderMain();
    };
    addResizer(th, colEls[i], c.key, COLS);
    hr.appendChild(th);
  });
  hr.appendChild(el("th", { style: { background: "#f4f6fa",
    borderBottom: "1px solid #d8dde5" } }));
  tbl.appendChild(hr);

  /* Drag across rows to select a run of them.
   *
   * A plain click still opens the student, so the two gestures are told apart
   * by movement: under a few pixels it is a click, beyond that it is a drag
   * and the click that follows mouseup is swallowed. Dragging applies the
   * opposite of the anchor row's current state, so a drag over selected rows
   * clears them — the spreadsheet convention, and the only one that makes a
   * mis-drag undoable by repeating it. */
  var trOf = [];
  var drag = null;

  function paintRow(s, tr) {
    var on = !!S.sel[s.key];
    tr.style.background = S.focus === s ? "#e7f0fd" : (on ? "#e8f1ff" : "transparent");
    if (tr.__cb) tr.__cb.checked = on;
  }

  function applyDrag(toIdx) {
    var lo = Math.min(drag.from, toIdx), hi = Math.max(drag.from, toIdx);
    for (var i = 0; i < trOf.length; i++) {
      if (i < lo || i > hi) continue;
      S.sel[trOf[i].s.key] = drag.want;
      paintRow(trOf[i].s, trOf[i].tr);
    }
    updateSelCount();
  }

  function rowIndexAt(x, y) {
    var node = document.elementFromPoint(x, y);
    while (node && node.tagName !== "TR") node = node.parentNode;
    if (!node) return -1;
    for (var i = 0; i < trOf.length; i++) if (trOf[i].tr === node) return i;
    return -1;
  }

  function endDrag() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    document.body.style.userSelect = "";
    // Time-boxed rather than a flag waiting to be consumed: a drag that ends
    // outside a row produces no click at all, and a latched flag would then
    // swallow the next real one.
    if (drag && drag.moved) suppressUntil = Date.now() + 350;
    drag = null;
  }
  function onMove(ev) {
    if (!drag) return;
    if (!drag.moved && Math.abs(ev.clientY - drag.y) + Math.abs(ev.clientX - drag.x) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      document.body.style.userSelect = "none";
      // The anchor row joins the selection the moment a drag begins.
      S.sel[trOf[drag.from].s.key] = drag.want;
      paintRow(trOf[drag.from].s, trOf[drag.from].tr);
    }
    ev.preventDefault();
    var i = rowIndexAt(ev.clientX, ev.clientY);
    if (i >= 0) applyDrag(i);
  }
  function onUp() { endDrag(); }

  rows.forEach(function (s, idx) {
    var on = !!S.sel[s.key];
    var tr = el("tr", { style: { cursor: "pointer",
      background: S.focus === s ? "#e7f0fd" : (on ? "#e8f1ff" : "transparent") } });
    trOf.push({ s: s, tr: tr });

    tr.onmousedown = function (ev) {
      if (ev.button !== 0) return;
      drag = { from: idx, want: !S.sel[s.key], moved: false, x: ev.clientX, y: ev.clientY };
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    };
    tr.onclick = function () {
      if (Date.now() < suppressUntil) return;
      focusStudent(s);
    };

    var tdSel = el("td", { style: { padding: "4px 6px", borderBottom: "1px solid #eef1f5" } });
    var cb = el("input", { type: "checkbox" });
    cb.checked = on;
    tr.__cb = cb;
    cb.onmousedown = function (ev) { ev.stopPropagation(); };
    cb.onclick = function (ev) {
      ev.stopPropagation();
      S.sel[s.key] = cb.checked;
      paintRow(s, tr);
      updateSelCount();
    };
    tdSel.appendChild(cb);
    tr.appendChild(tdSel);

    var tdPic = el("td", { style: { padding: "2px 4px", borderBottom: "1px solid #eef1f5" } });
    var im = el("img", { src: s.photo || SILHOUETTE, style: { width: "26px", height: "26px",
      objectFit: "cover", borderRadius: "4px", display: "block" } });
    s._img = im;
    makeDragHandle(im, s);
    tdPic.appendChild(im);
    tr.appendChild(tdPic);

    COLS.forEach(function (c) {
      var v = c.get(s);
      var td = el("td", { style: { padding: "5px 8px", borderBottom: "1px solid #eef1f5",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } });
      td.title = v;
      if (c.key === "name") {
        td.appendChild(el("b", { text: v }));
        if (s.confidential)
          td.appendChild(el("span", { text: " C", title: "Directory information confidential",
            style: { color: "#b3261e", fontWeight: "700" } }));
      } else {
        td.textContent = v;
        if (c.key === "uin") td.style.fontVariantNumeric = "tabular-nums";
      }
      tr.appendChild(td);
    });
    tr.appendChild(el("td", { style: { borderBottom: "1px solid #eef1f5" } }));
    tbl.appendChild(tr);
  });
  return tbl;
}
