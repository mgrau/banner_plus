/* ---- Handing a student to the Semester Planner ----------------------------
 *
 * The planner is a separate app at mgrau.github.io/semester-planner. It holds
 * a student's whole degree path; Banner holds what they have actually taken.
 * This builds the second into a link that opens the first.
 *
 * IN THE FRAGMENT, NOT THE QUERY STRING
 *
 * Everything after "#" stays in the browser — it is not sent in the HTTP
 * request, so it never reaches GitHub's servers and never lands in a log. The
 * payload is a named student's transcript, so that is the whole reason for the
 * choice.
 *
 * WHY NOT THE CLIPBOARD
 *
 * This used to copy a plain-text transcript and open the planner for you to
 * paste into. Two steps, a parser at the far end guessing at columns, and
 * nothing carried but course codes and grades — no identity, no term
 * structure. A link carries the whole record exactly as Banner reported it,
 * and arrives already parsed.
 *
 * THE FORMAT IS A CONTRACT WITH ANOTHER REPOSITORY
 *
 * The reader is semester-planner's src/lib/import/bannerPlus.ts, where the
 * payload is a set of TypeScript interfaces and the version is checked on
 * arrival. Nothing here is validated by anything there at build time — the two
 * apps deploy separately — so a change to the shape below is a change to that
 * file, and `v` exists so that a mismatch says so instead of misreading.
 */

var PLANNER_URL = "https://mgrau.github.io/semester-planner/";
var PLANNER_FORMAT = 1;

/* "LAST, FIRST M" is the shape Banner reports, and it is the one worth
 * splitting: everything before the comma is the surname, so a compound one
 * survives. Falling back to splitting a display name on its last space gets
 * "Van Der Berg" wrong, but it is only reached when the raw name is missing. */
function splitName(s) {
  var raw = String(s.raw || "");
  if (raw.indexOf(",") > -1) {
    var parts = raw.split(",");
    return { last: normName(parts[0] + ","), first: normName("," + parts.slice(1).join(",")) };
  }
  var bits = String(s.name || "").trim().split(/\s+/);
  if (bits.length < 2) return { first: "", last: bits[0] || "" };
  return { last: bits.pop(), first: bits.join(" ") };
}

/* The calendar season and year a registration belongs to.
 *
 * The printed description is authoritative where there is one. The fallback
 * decodes ODU's term code: YYYY plus a part-of-term whose first digit is the
 * season, where YYYY is the ACADEMIC year — so Fall 2026, Spring 2027 and
 * Summer 2027 all carry the prefix 2026, and spring and summer have to be
 * moved on a year to land in the calendar. Getting this wrong shifts two
 * thirds of a transcript by a year. */
var PLANNER_SEASONS = { "1": "fall", "2": "spring", "3": "summer" };

function plannerTerm(c) {
  var m = /(Spring|Summer|Fall|Winter)\s+(\d{4})/i.exec(c.term || "");
  if (m) return { season: m[1].toLowerCase(), year: +m[2] };
  var k = /^(\d{4})(\d)/.exec(String(c.termCode || ""));
  if (!k) return null;
  var season = PLANNER_SEASONS[k[2]];
  if (!season) return null;
  return { season: season, year: +k[1] + (season === "fall" ? 0 : 1) };
}

/* completed / in-progress / withdrawn.
 *
 * A withdrawal is not a course taken and not one in progress, and reporting it
 * as either would put credit on a plan that was never earned. Banner marks it
 * in two places and does not always agree with itself, so both are checked. */
function plannerStatus(c) {
  var grade = String(c.final || "").trim().toUpperCase();
  if (/^W/.test(grade) || /withdraw|drop/i.test(String(c.status || ""))) return "withdrawn";
  return grade ? "completed" : "in-progress";
}

function plannerPayload(s) {
  var name = splitName(s);
  var admit = null;
  var am = /(Spring|Summer|Fall|Winter)\s+(\d{4})/i.exec(s.admit || "");
  if (am) admit = { season: am[1].toLowerCase(), year: +am[2] };

  // Group registrations by term, keeping the terms in chronological order.
  var byKey = {}, terms = [];
  (s.history || []).forEach(function (c) {
    var t = plannerTerm(c);
    if (!t || !c.course) return;
    var key = t.season + ":" + t.year;
    if (!byKey[key]) {
      byKey[key] = { season: t.season, year: t.year, code: String(c.termCode || ""), courses: [] };
      terms.push(byKey[key]);
    }
    var credits = parseFloat(c.credits);
    byKey[key].courses.push({
      // Verbatim. The suffix on PHYS 101N is not decoration — at ODU it marks
      // a lab science, and the catalog lists it as its own course.
      code: String(c.course).trim(),
      title: c.title || undefined,
      credits: isFinite(credits) ? credits : 0,
      grade: String(c.final || "").trim() || undefined,
      status: plannerStatus(c),
      crn: c.crn || undefined
    });
  });
  terms.sort(function (a, b) {
    return a.year - b.year || ["spring", "summer", "fall", "winter"].indexOf(a.season) -
                              ["spring", "summer", "fall", "winter"].indexOf(b.season);
  });

  return {
    v: PLANNER_FORMAT,
    source: "banner-plus",
    generated: new Date().toISOString(),
    student: {
      uin: s.uin || undefined,
      firstName: name.first || undefined,
      lastName: name.last || undefined,
      email: s.email || undefined,
      // Banner's own words, unmapped: only the planner knows its catalog well
      // enough to turn "Physics & Electrical Engn" into a program id.
      majors: (s.majors || []).filter(function (m) { return m && m !== "—"; }),
      college: s.college || undefined,
      standing: s.standing || undefined,
      admitTerm: admit || undefined,
      confidential: !!s.confidential
    },
    terms: terms
  };
}

/* base64url over the UTF-8 bytes. Plain base64 is not safe in a fragment:
 * "+" and "/" survive round-trips badly and a trailing "=" invites something
 * downstream to treat it as a key/value separator. */
function b64url(text) {
  var bytes = new TextEncoder().encode(text), bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function plannerLink(s) {
  return PLANNER_URL + "#import=" + b64url(JSON.stringify(plannerPayload(s)));
}
