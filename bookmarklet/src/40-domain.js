/* ---- What the data means --------------------------------------------------
 *
 * The arithmetic behind the views: which majors earn a colour, what a set of
 * grades adds up to, and when a group of students is collectively in class.
 * No DOM, no fetching — the screen and the printed sheet both call in here so
 * they cannot drift apart.
 */

function autoCategories(students) {
  var counts = {};
  students.forEach(function (s) {
    (s.majors || []).forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
  });
  var ranked = Object.keys(counts).sort(function (a, b) {
    return counts[b] - counts[a] || a.localeCompare(b);
  });
  var cats = {};
  ranked.slice(0, MAX_CATEGORIES).forEach(function (m, i) {
    cats[m] = { label: m, color: CAT[i % CAT.length] };
  });
  return cats;
}

function categoryFor(majors, cats) {
  for (var i = 0; i < (majors || []).length; i++) if (cats[majors[i]]) return cats[majors[i]];
  return { label: "Other", color: OTHER_COLOR };
}

/* A GPA from the letter grades on the transcript.
 *
 * Blind to repeats, grade forgiveness and transfer credit, so it can disagree
 * with the registrar's number — the views that show it say so. Banner's
 * official GPA is on the student self-service host, a different origin this
 * page cannot read. */
var POINTS = { "A+": 4, A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2,
               "C-": 1.7, "D+": 1.3, D: 1, "D-": 0.7, F: 0 };

function gpaOf(courses) {
  var p = 0, h = 0;
  (courses || []).forEach(function (c) {
    var g = String(c.final || "").trim().toUpperCase(), cr = parseFloat(c.credits);
    if (!(g in POINTS) || !isFinite(cr)) return;
    p += POINTS[g] * cr; h += cr;
  });
  return h ? { gpa: p / h, hours: h } : null;
}

/* Students with at least one meeting time this term. Everyone else is left out
 * of the free-time picture entirely rather than counted as free all week —
 * "no schedule on file" and "free" are not the same claim, and treating them
 * alike would quietly inflate every window. Both the pane and the printed
 * sheet name who was dropped. */
function withMeetings(students, termCode) {
  return students.filter(function (s) {
    return (s.history || []).some(function (c) {
      return c.termCode === termCode && (c.meetings || []).length;
    });
  });
}

/* For each day and half-hour slot, the indices of the students who are in a
 * class. Indices rather than students so the callers can name them. */
function busyMap(students, termCode, nDays) {
  var g = [], d, s;
  for (d = 0; d < nDays; d++) { g[d] = []; for (s = 0; s < N_SLOTS; s++) g[d][s] = []; }
  students.forEach(function (stu, si) {
    (stu.history || []).forEach(function (c) {
      if (c.termCode !== termCode) return;
      (c.meetings || []).forEach(function (m) {
        var b = mins(m.begin), e = mins(m.end);
        if (b == null || e == null) return;
        m.days.forEach(function (on, dd) {
          if (!on || dd >= nDays) return;
          for (var ss = 0; ss < N_SLOTS; ss++) {
            var s0 = DAY_START + ss * SLOT;
            if (s0 < e && s0 + SLOT > b && g[dd][ss].indexOf(si) < 0) g[dd][ss].push(si);
          }
        });
      });
    });
  });
  return g;
}

/* Which step of the ramp a slot earns. Everybody-free gets the darkest step to
 * itself, so "all of them" is distinguishable at a glance from "all but one" —
 * which is the difference between scheduling a meeting and not. */
function rampStep(free, total) {
  if (free === total) return RAMP.length - 1;
  return Math.max(0, Math.min(RAMP.length - 2,
    Math.floor(free / total * (RAMP.length - 1))));
}
