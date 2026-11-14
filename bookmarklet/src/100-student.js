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
        // The code opens the course pane; see 105-course.js. A row with no CRN
        // — Banner does occasionally hand one back — stays plain text rather
        // than offering a click that cannot go anywhere.
        r.appendChild(courseLink(c.course || "", c,
          { fontWeight: "600", whiteSpace: "nowrap" }));
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

/* The two ways out of the console, for one student: Banner's own record, and
 * the degree planner.
 *
 * Directly under the photograph rather than at the foot of the pane. They are
 * not a conclusion you reach after reading the transcript — they are where you
 * go when this pane does not have what you came for, and finding that out
 * should not cost a scroll past everything it does have.
 *
 * What each does is in its tooltip. A line of explanatory text under two
 * buttons is fine at the bottom of a pane and clutter at the top of one.
 */
function exitLinks(s) {
  var links = el("div", { style: { display: "flex", gap: "6px", margin: "0 0 12px" } });

  if (s.uin) {
    var prof = btn("Banner profile ↗");
    prof.title = "Opens this student's profile on the student self-service host, " +
      "where Banner keeps the official GPA, holds and test scores.";
    prof.style.flex = "1";
    prof.onclick = function () { window.open(profileURL(s.uin, curTerm()), "_blank"); };
    links.appendChild(prof);
  }

  /* The whole record travels in the link's fragment — see 55-planner.js.
   * Nothing to paste, and nothing to parse at the far end. */
  var pbtn = btn("Semester Planner ↗", true);
  pbtn.title = "Opens the planner with this student's terms and coursework " +
    "already filled in. Nothing is uploaded: the record travels in the link.";
  pbtn.style.flex = "1";
  pbtn.onclick = function () { window.open(plannerLink(s), "_blank"); };
  links.appendChild(pbtn);

  return links;
}

/* Majors by term, newest first, like the transcript. The Major line in the
 * facts is the selected term's; this is where a change of major shows.
 *
 * Fills in after the pane is drawn: it is one request per term, and the
 * schedule should not wait for it. A single run is still shown, because
 * "Physics, Fall 2023 to Fall 2026" is an answer and a blank is not. */
function majorHistoryBox(s) {
  var box = el("div", { style: { margin: "0 0 10px", fontSize: "12px" } });
  box.appendChild(el("div", { text: "Major by term",
    title: "The primary major Banner had on file in each term of the record.",
    style: { fontWeight: "700", fontSize: "12px", margin: "6px 0 4px", color: "#41556f" } }));
  var body = el("div", { text: "Loading…", style: { color: "#9aa1ab", fontSize: "11.5px" } });
  box.appendChild(body);

  fetchMajorHistory(s).then(function (rows) {
    var runs = majorRuns(rows);
    body.innerHTML = "";
    if (!runs.length) {
      body.textContent = "Banner didn't name a major for any term on record";
      body.style.fontStyle = "italic";
      return;
    }
    body.style.color = "#16191f";
    body.style.fontSize = "12px";
    runs.slice().reverse().forEach(function (r, i) {
      var line = el("div", { style: { display: "flex", gap: "8px", alignItems: "baseline",
        padding: "1px 0" } });
      // The current one in bold; earlier ones read as history.
      line.appendChild(el("span", { text: r.major, style: {
        fontWeight: i ? "400" : "600", color: i ? "#41556f" : "#16191f" } }));
      line.appendChild(el("span", { text: r.from === r.to ? r.from : r.from + " – " + r.to,
        style: { marginLeft: "auto", color: "#6b7280", fontSize: "11px", whiteSpace: "nowrap" } }));
      body.appendChild(line);
    });
  });
  return box;
}

/* The registrar's GPA, under the one computed here, so the two can be read
 * against each other. It comes through the bridge (65-bridge.js); without a
 * connected tab the box offers Fetch, which opens the tab the bridge runs in.
 *
 * Shown as Banner labels it until the real field names are known — see
 * fetchOfficialGPA. Figures already fetched stay on screen if the tab goes
 * away, because they were true a minute ago and refetching them costs Banner
 * a request. */
var gpaShown = null;           // { s, box } for the student on screen

function officialGPABox(s) {
  var box = el("div", { style: { marginTop: "12px", fontSize: "12px" } });
  gpaShown = { s: s, box: box };
  drawOfficialGPA(box, s);
  return box;
}

function drawOfficialGPA(box, s) {
  box.innerHTML = "";
  box.appendChild(el("div", { text: "Registrar's GPA", style: {
    fontWeight: "700", fontSize: "12px", margin: "0 0 4px", color: "#41556f" } }));

  if (!bridgeReady() && !gpaKnown[s.uin]) {
    box.appendChild(fetchRow(box, s, "then click Banner Plus in the tab it opens"));
    return;
  }

  // A tab coming or going redraws the box while a question is out; the
  // answer to the old one then has nowhere to go.
  var body = el("div", { text: "Asking Banner…", style: { color: "#6b7280", fontSize: "11.5px" } });
  box.appendChild(body);
  fetchOfficialGPA(s, curTerm()).then(function (rows) {
    if (!box.contains(body)) return;
    body.innerHTML = "";
    body.style.color = "#16191f";
    body.style.fontSize = "12px";
    if (!rows.length) {
      body.textContent = "Banner has no GPA on file for this student.";
      body.style.color = "#9aa1ab";
      return;
    }
    rows.forEach(function (r) {
      var line = el("div", { style: { padding: "1px 0", lineHeight: "1.5" } });
      r.forEach(function (kv, i) {
        if (i) line.appendChild(el("span", { text: " · ", style: { color: "#c2c8d2" } }));
        line.appendChild(el("span", { text: kv[0] + " ", style: { color: "#6b7280" } }));
        line.appendChild(el("span", { text: kv[1], style: { fontWeight: "600" } }));
      });
      body.appendChild(line);
    });
    box.appendChild(el("div", {
      text: "As Banner labels it, from the student profile, through the tab you connected.",
      style: { fontSize: "10.5px", color: "#9aa1ab", marginTop: "2px", lineHeight: "1.4" } }));
  }, function (e) {
    if (!box.contains(body)) return;
    body.textContent = "Banner wouldn't answer: " + (e.message || e);
    body.style.color = "#b3261e";
    box.appendChild(fetchRow(box, s, ""));
  });
}

/* Fetch does whatever getting the figure takes. With a tab connected that is
 * the question again; without one, it opens the tab the bridge runs in. The
 * bookmark click there stays the user's, because no page can make it — see
 * 65-bridge.js. */
function fetchRow(box, s, hint) {
  var row = el("div", { style: { display: "flex", alignItems: "center", gap: "8px",
    marginTop: "2px" } });
  var b = btn("Fetch");
  b.title = "Opens this student's Banner profile in a new tab. Click Banner Plus " +
    "there, and that tab fetches the registrar's GPA for every student you open " +
    "while it stays open. Or click Banner Plus in any Student Self-Service tab: " +
    "it finds this console by itself. If the bookmark there only offers to open " +
    "Faculty Self-Service, it was dragged before this existed: drag it again " +
    "from the install page.";
  var note = el("span", { text: hint, style: { color: "#9aa1ab", fontSize: "11.5px" } });
  b.onclick = function () {
    if (bridgeReady()) { drawOfficialGPA(box, s); return; }
    openBridgeTab(profileURL(s.uin, curTerm()));
    note.textContent = "Now click Banner Plus in that tab.";
  };
  row.appendChild(b);
  row.appendChild(note);
  return row;
}

// A tab connecting or going away redraws the box for whoever is on screen.
onBridge(function () {
  if (gpaShown && document.contains(gpaShown.box)) drawOfficialGPA(gpaShown.box, gpaShown.s);
});

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
    var out = [nodes[0], nodes[1], exitLinks(s), majorHistoryBox(s)];

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
        var code = el("b");
        code.appendChild(courseLink(c.course || "", c));
        td1.appendChild(code);
        td1.appendChild(el("div", { text: c.title || "", style: { color: "#6b7280", fontSize: "10.5px" } }));
        /* Who is teaching it. Written as "with X" rather than as a bare name
         * because this table has no headings: under a course title, a name on
         * its own could be read as part of the title. It comes from the same
         * call as the meeting times, so it costs nothing extra. */
        if ((c.instructors || []).length)
          td1.appendChild(el("div", {
            text: "with " + c.instructors.map(function (p) { return p.name; }).join(", "),
            style: { color: "#6b7280", fontSize: "10.5px" } }));
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
    /* The GPA these grades add up to, and so only approximate; why is in the
     * tooltip. The registrar's own figure follows it, through the bridge. */
    var all = gpaOf(s.history);
    if (all) {
      out.push(el("div", { text: "Cumulative GPA " + all.gpa.toFixed(2) + " over " + all.hours + " credits",
        style: { borderTop: "2px solid #222", marginTop: "6px", paddingTop: "4px",
                 fontSize: "12px", fontWeight: "600" } }));
      out.push(el("div", {
        text: "Approximate — computed from letter grades above",
        title: "Blind to repeats, grade forgiveness and transfer credit, so it can " +
               "disagree with the registrar.",
        style: { fontSize: "10.5px", color: "#9aa1ab", marginTop: "2px", lineHeight: "1.4" } }));
    }
    if (s.uin) out.push(officialGPABox(s));

    showRight(out);
  }).catch(function (e) {
    loading.textContent = "Couldn't load record: " + (e.message || e);
    loading.style.color = "#b3261e";
  });
}
