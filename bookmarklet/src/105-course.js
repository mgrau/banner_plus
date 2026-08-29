/* ---- The course pane ------------------------------------------------------
 *
 * A course code on a student's record is a question — what is this, who
 * teaches it, what does it want first — and answering it used to mean leaving
 * for the catalogue. Clicking one here opens a small window with what Banner
 * holds about that section.
 *
 * Floating rather than in the right-hand pane, because the right-hand pane is
 * the student. Reading a description is something you do *while* looking at
 * their record, not instead of it — a pane that replaced the transcript would
 * lose the row you clicked. It can be dragged out of the way and stays where
 * you put it.
 *
 * TURNED OFF.
 *
 * Clicking a course fanned six requests at courseDetails/* and one at
 * courseList/courseInfoAndEnrollmentCounts, and something in that upset Banner
 * itself rather than just this console. Until it is known which call does it
 * and why, no course code is clickable and nothing here can fire: COURSE_PANE
 * gates the only door in, which is courseLink().
 *
 * The leading suspect is the enrolment call. It is keyed by CRN and answers for
 * sections you teach, so the pane asks it about a student's other courses —
 * somebody else's class — and Banner has every reason to treat that as an
 * access violation rather than as an empty answer. The fan-out is the next
 * suspect: seven requests at once, from a page that is not the screen those
 * endpoints belong to.
 *
 * The way back in is one call at a time against a real session, in this order:
 * getCourseDescription for a section you teach, then for one you do not, then
 * the enrolment call for one you do not. Whichever breaks it is the answer.
 *
 * Everything below is left intact, because it works against the stub and the
 * fix is likely to be *which* calls are made rather than what is done with the
 * answers.
 */
var COURSE_PANE = false;

/* Banner's course detail arrives as HTML fragments meant for its own modal.
 * They are turned into lines of text rather than injected: an <img onerror>
 * inside a response would otherwise run inside this overlay, and nothing in a
 * course description needs markup to be readable. DOMParser is inert — it
 * loads nothing and runs nothing — which innerHTML on a detached div is not.
 */
function fragmentLines(html) {
  var doc;
  try { doc = new DOMParser().parseFromString(String(html || ""), "text/html"); }
  catch (e) { return []; }
  var out = [], buf = "";
  function flush() {
    var t = buf.replace(/\s+/g, " ").trim();
    // Banner labels its fragments — "Prerequisites: " — and the pane already
    // has a heading saying so.
    if (t && t !== ":") out.push(t);
    buf = "";
  }
  (function walk(n) {
    for (var k = n.firstChild; k; k = k.nextSibling) {
      if (k.nodeType === 3) { buf += k.nodeValue; continue; }
      if (k.nodeType !== 1) continue;
      var tag = k.tagName.toLowerCase();
      if (tag === "script" || tag === "style") continue;
      if (tag === "br") { flush(); continue; }
      var block = /^(p|div|li|tr|h[1-6]|section|table|ul|ol|dt|dd|blockquote)$/.test(tag);
      if (block) flush();
      walk(k);
      if (block) flush();
    }
  })(doc.body);
  flush();
  return out;
}

/* Anything with a CRN can open the pane. The dotted rule is the affordance:
 * a transcript is thirty course codes and painting them all blue would turn
 * the grid into a link farm, so the colour is held back for the hover. */
function courseLink(text, c, style) {
  var n = el("span", { text: text, style: style || {} });
  if (c && c.title) n.title = c.title;
  // Switched off, or nothing to ask about: plain text, and no promise of a
  // click that either cannot answer or must not be made.
  if (!COURSE_PANE || !c || !c.crn) return n;
  var was = n.style.color;
  n.style.cursor = "pointer";
  n.style.borderBottom = "1px dotted #b6bec9";
  // Keeps the title it already carried — in the transcript grid that tooltip
  // is the only place the course's name appears at all.
  n.title = c.title ? c.title + " — click for course detail" : "Course detail";
  n.onmouseenter = function () { n.style.color = "#2a78d6"; n.style.borderBottomColor = "#2a78d6"; };
  n.onmouseleave = function () { n.style.color = was; n.style.borderBottomColor = "#b6bec9"; };
  n.onclick = function (ev) {
    // The rows underneath open a student or select one; a course is neither.
    ev.stopPropagation();
    showCourse(c, ev);
  };
  return n;
}

var coursePane = null, courseTitle = null, courseSub = null, courseBody = null;
var coursePos = null;            // survives a close, so it reopens where you left it
var courseShown = null;          // term:crn currently drawn, or null

var COURSE_W = 380;

function courseIsOpen() { return !!coursePane && coursePane.style.display !== "none"; }

function closeCourse() {
  if (coursePane) coursePane.style.display = "none";
  courseShown = null;
}

function clampCourse(left, top) {
  var w = Math.min(COURSE_W, window.innerWidth - 24);
  return { left: Math.max(12, Math.min(window.innerWidth - w - 12, left)),
           // Never over the toolbar, and never so low that only the header shows.
           top: Math.max(52, Math.min(window.innerHeight - 120, top)) };
}

/* Opens beside the click, not on top of it: the course you just clicked is in
 * the pane you are reading from, and a window that lands on the row you
 * pointed at hides the thing it is describing. Left of the pointer, because
 * the record being read is on the right. */
function courseHome(ev) {
  if (!ev) return clampCourse(window.innerWidth - COURSE_W - 40, 110);
  return clampCourse(ev.clientX - COURSE_W - 24, ev.clientY - 40);
}

function makeCoursePane() {
  if (coursePane) return coursePane;

  coursePane = el("div", { id: "bc-course", style: {
    position: "fixed", width: COURSE_W + "px", maxWidth: "92vw", maxHeight: "64vh",
    background: "#fff", color: "#16191f", border: "1px solid #d8dde5", borderRadius: "10px",
    boxShadow: "0 18px 44px rgba(15,18,25,.28)", zIndex: "25",
    display: "none", flexDirection: "column", overflow: "hidden" } });

  var head = el("div", { style: {
    display: "flex", alignItems: "flex-start", gap: "8px", flex: "0 0 auto",
    padding: "9px 11px", background: "#f4f6fa", borderBottom: "1px solid #e6eaf0",
    cursor: "move", userSelect: "none" } });
  var titles = el("div", { style: { minWidth: "0" } });
  courseTitle = el("div", { style: { fontWeight: "700", fontSize: "14px" } });
  courseSub = el("div", { style: { fontSize: "11.5px", color: "#6b7280", lineHeight: "1.35" } });
  titles.appendChild(courseTitle); titles.appendChild(courseSub);
  head.appendChild(titles);

  var x = el("button", { text: "×", title: "Close", style: {
    marginLeft: "auto", border: "0", background: "transparent", cursor: "pointer",
    fontSize: "19px", color: "#9aa1ab", lineHeight: "1", padding: "0 2px" } });
  x.onclick = closeCourse;
  head.appendChild(x);

  head.addEventListener("mousedown", function (ev) {
    if (ev.target === x) return;
    ev.preventDefault();
    var startX = ev.clientX, startY = ev.clientY;
    var from = coursePos || courseHome(null);
    function move(e) {
      coursePos = clampCourse(from.left + (e.clientX - startX), from.top + (e.clientY - startY));
      coursePane.style.left = coursePos.left + "px";
      coursePane.style.top = coursePos.top + "px";
    }
    function up() {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
    }
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  });
  coursePane.appendChild(head);

  courseBody = el("div", { style: {
    padding: "10px 12px 13px", overflowY: "auto", flex: "1 1 auto", fontSize: "12px" } });
  coursePane.appendChild(courseBody);

  app.appendChild(coursePane);
  return coursePane;
}

document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape" && courseIsOpen()) closeCourse();
}, true);

function courseHeading(text) {
  return el("div", { text: text, style: {
    fontSize: "10.5px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase",
    letterSpacing: ".04em", margin: "12px 0 3px" } });
}

function factRow(label, node) {
  var r = el("div", { style: { display: "flex", gap: "6px", padding: "1px 0", alignItems: "baseline" } });
  r.appendChild(el("span", { text: label, style: {
    color: "#6b7280", flex: "0 0 auto", minWidth: "62px" } }));
  r.appendChild(node);
  return r;
}

function factText(label, text) {
  return factRow(label, el("span", { text: text, style: { minWidth: "0" } }));
}

/* Who teaches it, with a way to write to them. The mailto is the only link in
 * here that leaves the browser, and it is the thing an advisor reaches for
 * next often enough to be worth the click. */
function instructorNode(people) {
  var wrap = el("span", { style: { minWidth: "0" } });
  people.forEach(function (p, i) {
    if (i) wrap.appendChild(document.createTextNode(", "));
    if (!p.email) { wrap.appendChild(el("span", { text: p.name })); return; }
    var a = el("a", { href: "mailto:" + p.email, text: p.name, title: p.email,
      style: { color: "#2a78d6", textDecoration: "none" } });
    wrap.appendChild(a);
  });
  return wrap;
}

function seatsLine(s) {
  var bits = [];
  if (s.enrolled != null)
    bits.push(s.max != null ? s.enrolled + " of " + s.max + " enrolled" : s.enrolled + " enrolled");
  if (s.avail != null) bits.push(s.avail + " seat" + (s.avail === 1 ? "" : "s") + " open");
  if (s.waiting) bits.push(s.waiting + " waiting");
  return bits.join(" · ");
}

function renderCourse(c, sec, detail) {
  courseBody.innerHTML = "";

  var facts = el("div", { style: { lineHeight: "1.6" } });
  var when = [c.term || c.termCode, "CRN " + c.crn];
  if (c.credits != null && c.credits !== "") when.push(c.credits + " cr");
  facts.appendChild(factText("Term", when.join(" · ")));

  if ((sec.meetings || []).length) {
    sec.meetings.forEach(function (m, i) {
      var txt = daysLabel(m.days) + " " + hhmm(m.begin) + "–" + hhmm(m.end);
      var room = ((m.building || "") + " " + (m.room || "")).trim();
      if (room) txt += " · " + room;
      facts.appendChild(factText(i ? "" : "Meets", txt));
    });
  } else {
    facts.appendChild(factText("Meets", "no times on file"));
  }

  if ((sec.instructors || []).length)
    facts.appendChild(factRow(sec.instructors.length > 1 ? "Taught by" : "Instructor",
      instructorNode(sec.instructors)));

  if (detail.seats) {
    var line = seatsLine(detail.seats);
    if (line) facts.appendChild(factText("Seats", line));
  }
  if (c.final) facts.appendChild(factText("Grade", c.final));
  courseBody.appendChild(facts);

  var drew = 0;
  detail.parts.forEach(function (p) {
    /* Banner labels its own fragments — "Prerequisites: MATH 162M" — and the
     * heading directly above already says that. The section block also opens
     * by repeating the term and CRN, which are three lines up in the facts.
     * Both are Banner assembling a standalone modal; here they are noise. */
    var label = new RegExp("^" + p.label + "\\s*:\\s*", "i");
    var lines = fragmentLines(p.html).map(function (t) {
      return t.replace(label, "");
    }).filter(function (t) {
      return t && !(p.label === "Section details" && /^(associated term|crn)\s*:/i.test(t));
    });
    if (!lines.length) return;
    drew++;
    courseBody.appendChild(courseHeading(p.label));
    lines.forEach(function (t) {
      courseBody.appendChild(el("div", { text: t, style: {
        lineHeight: "1.5", margin: "0 0 2px", color: "#16191f" } }));
    });
  });

  /* Nothing came back. Which of the two reasons it was matters: a course with
   * no prerequisites on file is an answer, and a campus that does not serve
   * these routes at all is a porting note. */
  if (!drew) {
    courseBody.appendChild(el("div", {
      text: detail.failed === detail.tried
        ? "Banner would not answer for course detail here — see ENDPOINTS.md if " +
          "this campus names those routes differently."
        : "Banner has no catalogue detail on file for this section.",
      style: { color: "#9aa1ab", fontStyle: "italic", marginTop: "10px", lineHeight: "1.45" } }));
  }
}

function showCourse(c, ev) {
  if (!c || !c.crn) return;
  var pane = makeCoursePane();
  var key = c.termCode + ":" + c.crn;

  if (!coursePos) coursePos = courseHome(ev);
  pane.style.left = coursePos.left + "px";
  pane.style.top = coursePos.top + "px";
  pane.style.display = "flex";

  if (courseShown === key) return;        // already on screen; just raised
  courseShown = key;

  courseTitle.textContent = c.course || ("CRN " + c.crn);
  courseSub.textContent = c.title || "";
  courseBody.innerHTML = "";
  courseBody.appendChild(el("div", { text: "Loading course detail…",
    style: { color: "#6b7280" } }));

  Promise.all([fetchSectionTimes(c.termCode, c.crn), fetchCourseDetail(c.termCode, c.crn)])
    .then(function (r) {
      // A second course clicked while this one was in flight owns the pane now.
      if (courseShown !== key) return;
      renderCourse(c, r[0], r[1]);
    })
    .catch(function (e) {
      if (courseShown !== key) return;
      courseBody.innerHTML = "";
      courseBody.appendChild(el("div", { text: "Couldn't load course detail: " + (e.message || e),
        style: { color: "#b3261e", lineHeight: "1.45" } }));
    });
}
