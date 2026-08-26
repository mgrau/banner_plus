/* ---- The student pane -----------------------------------------------------
 *
 * One student: who they are, what they are taking now, and the whole
 * registration history laid out as a transcript — seasons across, academic
 * years down, newest first. That shape is the point. Banner's own history
 * screen is one flat list, which cannot be read as a degree in progress.
 *
 * Also the home of showRight(), which every right-hand view goes through.
 */

function showRight(nodes) {
  right.innerHTML = "";
  setRightOpen(true);
  nodes.forEach(function (n) { right.appendChild(n); });
}

function paneHeader(title, onClose) {
  var h = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" } });
  h.appendChild(el("div", { text: title, style: { fontWeight: "700", fontSize: "15px" } }));
  var x = el("button", { text: "×", style: { marginLeft: "auto", border: "0", background: "transparent",
    cursor: "pointer", fontSize: "20px", color: "#9aa1ab", lineHeight: "1" } });
  x.onclick = onClose;
  h.appendChild(x);
  return h;
}

/* Which academic year and season a term belongs to.
 * ODU's codes are YYYY + a two-digit part-of-term whose first digit is the
 * season: 1 Fall, 2 Spring, 3 Summer. That first digit is what makes sub-terms
 * like 202617 ("Fall 2026 Second Eight Weeks") land in the right column
 * instead of nowhere. YYYY is the academic year, so Fall 2026, Spring 2027 and
 * Summer 2027 share the prefix 2026 and sit on one row — which is exactly how
 * a degree plan is read. */
var SEASONS = ["Fall", "Spring", "Summer"];
function termSlot(code, label) {
  var m = /^(\d{4})(\d)/.exec(String(code || ""));
  if (m) {
    var idx = ["1", "2", "3"].indexOf(m[2]);
    if (idx > -1) return { year: +m[1], idx: idx };
  }
  var p = parseTerm(label);            // fall back to the printed description
  if (!p) return null;
  var i = SEASONS.indexOf(p.season);
  if (i < 0) return null;
  return { year: p.season === "Fall" ? p.year : p.year - 1, idx: i };
}

function transcriptGrid(s) {
  var cells = {}, years = {}, used = [false, false, false];
  (s.history || []).forEach(function (c) {
    var slot = termSlot(c.termCode, c.term);
    if (!slot) slot = { year: 0, idx: 0 };
    var k = slot.year + ":" + slot.idx;
    if (!cells[k]) cells[k] = { label: c.term || c.termCode, rows: [] };
    cells[k].rows.push(c);
    years[slot.year] = 1;
    used[slot.idx] = true;
  });

  // Summer only earns a column when there is a summer to show.
  var cols = [0, 1, 2].filter(function (i) { return used[i]; });
  if (!cols.length) return el("div", { text: "No registration history",
    style: { color: "#9aa1ab", fontSize: "12px", fontStyle: "italic" } });

  var wrap = el("div", { style: { display: "grid", gap: "8px",
    gridTemplateColumns: "repeat(" + cols.length + ", minmax(0,1fr))" } });

  cols.forEach(function (i) {
    wrap.appendChild(el("div", { text: SEASONS[i], style: {
      fontSize: "10.5px", fontWeight: "700", color: "#6b7280",
      textTransform: "uppercase", letterSpacing: ".04em" } }));
  });

  // Newest year on top: what a student is taking now, and took last term, is
  // what an advising conversation is about; freshman year is the footnote.
  Object.keys(years).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
    cols.forEach(function (i) {
      var cell = cells[y + ":" + i];
      var box = el("div", { style: { border: "1px solid #e6eaf0", borderRadius: "6px",
        padding: "5px 7px", minHeight: "34px",
        background: cell ? "#fff" : "#fafbfd" } });
      if (!cell) { wrap.appendChild(box); return; }

      var g = gpaOf(cell.rows);
      var cr = cell.rows.reduce(function (a, c) { return a + (parseFloat(c.credits) || 0); }, 0);
      var hd = el("div", { style: { display: "flex", alignItems: "baseline", gap: "5px",
        fontSize: "11px", fontWeight: "700", marginBottom: "2px" } });
      hd.appendChild(el("span", { text: cell.label }));
      hd.appendChild(el("span", { text: cr + " cr" + (g ? " · " + g.gpa.toFixed(2) : ""),
        style: { marginLeft: "auto", fontWeight: "400", color: "#6b7280", fontSize: "10px" } }));
      box.appendChild(hd);

      cell.rows.forEach(function (c) {
        var r = el("div", { style: { display: "flex", gap: "5px", fontSize: "11px",
          padding: "1px 0", alignItems: "baseline" } });
        r.appendChild(el("span", { text: c.course || "", title: c.title || "",
          style: { fontWeight: "600", whiteSpace: "nowrap" } }));
        // Credits sit between course and grade: dim, because they are context
        // for the grade rather than something you read on their own.
        r.appendChild(el("span", { text: c.credits != null && c.credits !== "" ? c.credits : "",
          style: { marginLeft: "auto", color: "#9aa1ab", fontSize: "10px",
                   fontVariantNumeric: "tabular-nums" } }));
        r.appendChild(el("span", { text: c.final || "IP", style: {
          minWidth: "22px", textAlign: "right", fontWeight: c.final ? "700" : "400",
          color: c.final ? "#16191f" : "#8a6d3b" } }));
        box.appendChild(r);
      });
      wrap.appendChild(box);
    });
  });
  return wrap;
}

function focusStudent(s) {
  S.focus = s;
  renderMain();
  var nodes = [paneHeader(s.name, function () { setRightOpen(false); S.focus = null; renderMain(); })];

  var top = el("div", { style: { display: "flex", gap: "10px", marginBottom: "10px" } });
  top.appendChild(el("img", { src: s.photo || SILHOUETTE, style: {
    width: "78px", height: "78px", objectFit: "cover", borderRadius: "7px", border: "1px solid #d8dde5" } }));
  var facts = el("div", { style: { fontSize: "12px", lineHeight: "1.6", minWidth: "0" } });
  [["UIN", s.uin], ["Major", (s.majors || []).join(" / ")], ["College", s.college],
   ["Standing", s.standing], ["Admitted", s.admit], ["Email", s.email]]
    .forEach(function (kv) {
      if (!kv[1]) return;
      var r = el("div");
      r.appendChild(el("span", { text: kv[0] + ": ", style: { color: "#6b7280" } }));
      r.appendChild(el("span", { text: kv[1] }));
      facts.appendChild(r);
    });
  if (s.confidential)
    facts.appendChild(el("div", { text: "Directory information confidential",
      style: { color: "#b3261e", fontWeight: "600", marginTop: "2px" } }));
  top.appendChild(facts);
  nodes.push(top);

  var loading = el("div", { text: "Loading record…", style: { color: "#6b7280", fontSize: "12px" } });
  nodes.push(loading);
  showRight(nodes);

  taskBegin(null);
  hydrate([s], curTerm()).then(function () {
    idle(null);
    if (S.table) renderMain();
    var out = [nodes[0], nodes[1]];

    var now = (s.history || []).filter(function (c) { return c.termCode === curTerm(); });
    out.push(el("div", { text: "This term", style: {
      fontWeight: "700", fontSize: "12px", margin: "6px 0 4px", color: "#41556f" } }));
    if (!now.length) {
      out.push(el("div", { text: "Not registered this term",
        style: { color: "#9aa1ab", fontSize: "12px", fontStyle: "italic" } }));
    } else {
      var tbl = el("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: "11.5px" } });
      now.forEach(function (c) {
        var tr = el("tr");
        var td1 = el("td", { style: { padding: "3px 4px", borderBottom: "1px solid #eef1f5" } });
        td1.appendChild(el("b", { text: c.course || "" }));
        td1.appendChild(el("div", { text: c.title || "", style: { color: "#6b7280", fontSize: "10.5px" } }));
        var tdC = el("td", { text: c.credits != null && c.credits !== "" ? c.credits + " cr" : "",
          style: { padding: "3px 4px", borderBottom: "1px solid #eef1f5", color: "#6b7280",
                   whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums",
                   width: "42px" } });
        var td2 = el("td", { style: { padding: "3px 4px", borderBottom: "1px solid #eef1f5",
          color: "#41556f", whiteSpace: "nowrap" } });
        td2.innerHTML = (c.meetings || []).map(function (m) {
          return daysLabel(m.days) + " " + hhmm(m.begin) + "–" + hhmm(m.end) +
            (m.room ? "<br><span style='color:#6b7280'>" + esc((m.building || "") + " " + m.room) + "</span>" : "");
        }).join("<br>") || "—";
        tr.appendChild(td1); tr.appendChild(tdC); tr.appendChild(td2);
        tbl.appendChild(tr);
      });
      out.push(tbl);
      // The term total is the thing you actually check on an advising call.
      var termCr = now.reduce(function (a, c) { return a + (parseFloat(c.credits) || 0); }, 0);
      out.push(el("div", { text: termCr + " credits this term", style: {
        fontSize: "11px", color: "#6b7280", textAlign: "right", marginTop: "3px" } }));
    }

    out.push(el("div", { text: "Transcript", style: {
      fontWeight: "700", fontSize: "12px", margin: "14px 0 4px", color: "#41556f" } }));
    out.push(transcriptGrid(s));
    /* The only GPA here is the one these grades add up to. Banner's official
     * number lives on the student host, which is a different origin and
     * unreadable from this page; the profile button below is the way to it. */
    var all = gpaOf(s.history);
    if (all) {
      out.push(el("div", { text: "Cumulative GPA " + all.gpa.toFixed(2) + " over " + all.hours + " credits",
        style: { borderTop: "2px solid #222", marginTop: "6px", paddingTop: "4px",
                 fontSize: "12px", fontWeight: "600" } }));
      out.push(el("div", {
        text: "Computed from the letter grades above — blind to repeats, grade " +
              "forgiveness and transfer credit, so it can disagree with Banner.",
        style: { fontSize: "10.5px", color: "#9aa1ab", marginTop: "2px", lineHeight: "1.4" } }));
    }

    // Two ways out of the console: Banner's own record, and the planner.
    var links = el("div", { style: { display: "flex", gap: "6px", marginTop: "10px" } });
    if (s.uin) {
      var prof = btn("Banner profile \u2197");
      prof.title = "Opens this student's profile on the student self-service host, " +
        "where Banner keeps GPA, holds and test scores.";
      prof.style.flex = "1";
      prof.onclick = function () { window.open(profileURL(s.uin, curTerm()), "_blank"); };
      links.appendChild(prof);
    }

    var pbtn = btn("Semester Planner \u2197", true);
    pbtn.style.flex = "1";
    pbtn.onclick = function () {
      var text = plannerText(s);
      function go() { window.open(PLANNER_URL, "_blank"); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          pbtn.textContent = "Transcript copied \u2014 paste it there";
          go();
        }, function () { console.log(text); go(); });
      } else { console.log(text); go(); }
    };
    links.appendChild(pbtn);
    out.push(links);
    out.push(el("div", { text: "Planner: copies the transcript, then opens it to paste into.",
      style: { fontSize: "10.5px", color: "#9aa1ab", marginTop: "3px" } }));

    showRight(out);
  }).catch(function (e) {
    loading.textContent = "Couldn't load record: " + (e.message || e);
    loading.style.color = "#b3261e";
  });
}
