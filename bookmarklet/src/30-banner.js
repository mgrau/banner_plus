/* ---- Reading records out of Banner ----------------------------------------
 *
 * One function per endpoint, each returning plain objects with the field names
 * this console uses. Banner's own field names are inconsistent between
 * endpoints — subject vs subjectCode, sequenceNumber vs courseSection — so the
 * translation happens here and nothing downstream has to know.
 *
 * Nothing in this file touches the DOM.
 */

var SEARCH_TYPES = ["Advisee", "Student", "advisee", "student", "MyStudents", ""];

/* Where the student self-service host lives. The console cannot read that
 * origin, but it can send you to it, which is the manual answer for anything
 * Banner keeps over there — GPA, holds, test scores. Banner reports the URL
 * itself, which beats guessing at a hostname by string surgery on this one. */
var PROFILE_HOST = null;

apiGet("searchStudent/getProfileDetails").then(function (j) {
  if (j && j.studentProfileUrl) {
    try { PROFILE_HOST = new URL(j.studentProfileUrl).origin; } catch (e) {}
    if (DEBUG) console.log("[console] student profile host:", PROFILE_HOST);
  }
}).catch(function () {});

function profileURL(uin, term) {
  var host = PROFILE_HOST || location.origin.replace("facultyssb", "studentssb");
  return host + "/StudentSelfService/ssb/studentProfile?studentId=" +
    encodeURIComponent(uin) + "&term=" + encodeURIComponent(term);
}

/* Standard terms only. Banner lists every part-of-term Banner knows about —
 * "Fall 2026 Second Eight Weeks", medical-school sessions, and so on — which
 * buries the three terms anyone actually teaches in. A standard term's code
 * ends 10/20/30 AND its description is exactly a season and a year; requiring
 * both means an unfamiliar sub-term has to defeat two rules to slip through. */
function isStandardTerm(t) {
  return /^\d{4}(10|20|30)$/.test(String(t.code)) &&
         /^(Spring|Summer|Fall)\s+\d{4}$/.test(String(t.description).trim());
}

function fetchTerms() {
  return apiGet("studentPagesCommonSearch/fetchTerms").then(function (j) {
    return (Array.isArray(j) ? j : []).map(function (t) {
      return { code: String(t.code), description: String(t.description || t.termDescription || t.code) };
    }).filter(function (t) { return t.code; });
  }).catch(function () { return []; });
}

var sectionDiag = { keys: null, count: 0, warmed: null };

/* Waking the class-list app up.
 *
 * The class list is an application, not a page, and courseList is its endpoint.
 * Clicked anywhere else in Faculty Self-Service, that call comes back 401 or
 * empty: the session has no class-list context yet, and this page's
 * synchronizer token — where it has one at all — was issued for a different
 * app. Which is why the console used to need one manual visit to Faculty Class
 * List before any classes would appear.
 *
 * Fetching the class-list page is that visit, without the navigation. Banner
 * sets up the session while serving it, and the HTML it returns carries the
 * token the endpoint wants, so both halves are fixed by one request.
 *
 * Memoised: one warm-up per session, not one per term.
 */
var warmed = null;

function tokenIn(html) {
  var m = /<meta[^>]+name=["']synchronizerToken["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
          /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']synchronizerToken["']/i.exec(html) ||
          /["']synchronizerToken["']\s*[:=]\s*["']([^"']+)["']/.exec(html);
  return m ? m[1] : null;
}

function warmUp() {
  if (warmed) return warmed;

  // Already inside the class-list app with a token in hand: nothing to wake.
  if (/classListApp/i.test(location.href) && TOKEN) {
    sectionDiag.warmed = "not needed — already on the class list page";
    return (warmed = Promise.resolve(true));
  }

  warmed = withPrefix("classListApp/classListPage", function (p) {
    return fetch(base + p + "classListApp/classListPage", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
        return r.text();
      });
  }).then(function (html) {
    var t = tokenIn(html);
    if (t && t !== TOKEN) TOKEN = t;
    sectionDiag.warmed = t ? "ok, token from the class list page" : "ok, no token in the page";
    if (DEBUG) console.log("[console] warmed up the class list app;", sectionDiag.warmed);
    return true;
  }).catch(function (e) {
    // Not fatal. If the session was already good, the call below still works.
    sectionDiag.warmed = "failed: " + (e.message || e);
    if (DEBUG) console.log("[console] warm-up failed:", e);
    return false;
  });
  return warmed;
}

function fetchMySections(term) {
  return warmUp().then(function () { return courseListOnce(term); });
}

function courseListOnce(term) {
  return apiGet("courseList/courseList", "term=" + encodeURIComponent(term) +
    "&filterText=&sortColumn=&sortDirection=asc&max=200&offset=0").then(function (j) {
    sectionDiag.keys = j && typeof j === "object" ? Object.keys(j).join(", ") : String(typeof j);
    var rows = j.result || j.data || j.rows || j.courseList ||
               (Array.isArray(j) ? j : null);
    if (!rows || !rows.length) rows = biggestArray(j);
    if (DEBUG) console.log("[console] courseList envelope:", sectionDiag.keys, "->", rows.length, "rows", rows[0]);
    sectionDiag.count = rows.length;
    return rows.map(function (r) {
      // courseList and courseInfoAndEnrollmentCounts both use subjectCode and
      // courseSection; other Banner payloads use subject and sequenceNumber.
      var subj = r.subject || r.subjectCode || "";
      var num = r.courseNumber || r.courseDisplayValue || "";
      var sect = String(r.sequenceNumber || r.courseSection || "");
      // Section "0" is ODU's default and adds nothing to a label.
      var label = [subj, num].filter(Boolean).join(" ");
      if (sect && sect !== "0") label += "-" + sect;
      return {
        crn: String(r.courseReferenceNumber || r.crn || ""),
        label: label || String(r.formattedSubject || r.courseTitle || ""),
        title: r.courseTitle || "",
        // The same call already carries enrolment, so the sidebar can show
        // which classes actually have anyone in them without asking again.
        enrolled: r.courseEnrolmentCount != null ? String(r.courseEnrolmentCount) : null,
        rosterable: r.classlistEnabled !== false,
        subj: subj, num: String(num)
      };
    }).filter(function (x) { return x.crn; }).sort(function (a, b) {
      return a.subj.localeCompare(b.subj) || a.num.localeCompare(b.num, undefined, { numeric: true });
    });
  }).catch(function (e) {
    sectionDiag.keys = "request failed: " + (e.message || e);
    // classListApp/courses answers the same question as a form-encoded POST
    // and returns a bare array. Worth trying before reporting nothing.
    return fetch(base + "/ssb/classListApp/courses", {
      method: "POST", credentials: "same-origin",
      headers: apiHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: "filterText=&page=1&max=200&term=" + encodeURIComponent(term)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var rows = Array.isArray(j) ? j : biggestArray(j);
      if (!rows.length) throw new Error("empty");
      sectionDiag.keys += " (fell back to classListApp/courses)";
      return rows.map(function (r) {
        var label = [r.subjectCode, r.courseNumber || r.courseDisplayValue]
          .filter(Boolean).join(" ");
        return {
          crn: String(r.courseReferenceNumber || ""),
          label: label, title: r.courseTitle || "",
          enrolled: null, rosterable: r.classlistEnabled !== false,
          subj: r.subjectCode || "", num: String(r.courseNumber || "")
        };
      }).filter(function (x) { return x.crn; });
    }).catch(function () { return []; });
  });
}

/* Every major a curriculum payload names — primary first, then any secondary
 * curricula. Two endpoints return this same nested shape, and reading it two
 * different ways is how a double major ends up listed in one view and not the
 * other. */
function majorsIn(d) {
  var pc = d.primaryCurriculum || {};
  var majors = (pc.majorFieldsOfStudy || []).map(function (f) { return f.major; }).filter(Boolean);
  (d.secondaryCurricula || []).forEach(function (c) {
    (c.majorFieldsOfStudy || []).forEach(function (f) { if (f.major) majors.push(f.major); });
  });
  return majors;
}

function fetchRoster(term, crn) {
  return apiGet("classList/classListDetail", "term=" + encodeURIComponent(term) +
    "&crn=" + encodeURIComponent(crn) +
    "&filterText=&sortColumn=studentName&sortDirection=asc&max=500&offset=0")
    .then(function (j) {
      var detail = j.classlistDetail || j.classListDetail || j.data || [];
      var summary = j.classlistSummary || j.classListSummary || [];
      var n = Math.max(detail.length, summary.length), out = [];
      for (var i = 0; i < n; i++) {
        var d = detail[i] || {}, s = summary[i] || {};
        var pidm = d.pidm || s.studentPidm || s.pidm;
        var pc = d.primaryCurriculum || {};
        var majors = majorsIn(d);
        out.push({
          key: String(pidm || s.bannerId || i),
          uin: s.bannerId || "", pidm: pidm, xyz: pidm ? btoa(String(pidm)) : null,
          raw: s.studentName || "", name: normName(s.studentName || ""),
          majors: majors.length ? majors : ["Undeclared"],
          college: pc.college || "", admit: pc.termAdmit || "",
          standing: s.classDescription || d.classDescription || "",
          confidential: s.confidentialIndicator === true,
          email: s.emailAddress || "", crn: String(crn), term: String(term),
          photo: null, history: null
        });
      }
      return out;
    });
}

/* Photo outcomes are recorded because a missing face gives no error anywhere:
 * every failure path here resolves to null so one bad photo cannot fail a
 * roster, which also means a systematic failure looks identical to a student
 * simply having no picture on file. The counters make the difference visible. */
var photoDiag = { tried: 0, ok: 0, noId: 0, lastURL: null, lastStatus: null, lastType: null };

/* Photos come from studentContactCardPicture/picture?bannerId=…
 *
 * That endpoint takes a bannerId and nothing else — no CRN, no term — which
 * is what makes a photo possible for someone who is not in one of your
 * sections. classListPicture, the one the class list uses, demands a CRN, so
 * a pasted group of research students came back faceless.
 *
 * Found by reading what Registration Overrides requested while showing a
 * student card. Five guesses at the name all 404'd first; the page's own
 * request list had it.
 *
 * classListPicture stays as a fallback for a roster, where a CRN is in hand
 * and the endpoint is known to work. */
function photoAttempts(s) {
  var a = [{ family: "studentContactCardPicture/picture",
             qs: "bannerId=" + encodeURIComponent(s.uin) }];
  if (s.crn) a.push({ family: "classListPicture/picture",
                      qs: "bannerId=" + encodeURIComponent(s.uin) +
                          "&crn=" + encodeURIComponent(s.crn) +
                          "&term=" + encodeURIComponent(s.term) });
  return a;
}

function fetchPhotoAt(attempt) {
  var qs = attempt.qs, family = attempt.family;
  return withPrefix(family, function (pre) {
    var url = base + pre + family + "?" + qs;
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        photoDiag.lastURL = url;
        photoDiag.lastStatus = r.status;
        photoDiag.lastType = ct;
        if (!r.ok) throw new Error("HTTP " + r.status);
        /* A 200 that is not an image means the wrong route — the app shell or
         * a login page — not a student without a picture. Rejecting it here
         * keeps it out of the resolver's cache.
         *
         * This is why photos failed wholesale: this endpoint 404s for a
         * student with no photo on file, so if the first face fetched was one
         * of those, the resolver read a *data* 404 as a *routing* 404, fell
         * back, got the app shell with a 200, and cached the wrong prefix for
         * every remaining student. */
        if (ct.indexOf("image") !== 0) throw new Error("not an image (" + ct + ")");
        return r.blob();
      });
  });
}

function fetchPhoto(s) {
  if (!s.uin) { photoDiag.noId++; return Promise.resolve(null); }
  photoDiag.tried++;
  var attempts = photoAttempts(s), i = 0;
  function next() {
    if (i >= attempts.length) return Promise.resolve(null);
    return fetchPhotoAt(attempts[i++]).then(function (b) { return b; }, function () { return next(); });
  }
  return next()
    .then(function (b) {
      // A response that is not an image is a wrong endpoint or a login
      // redirect, not a student without a photo — do not turn it into a
      // data: URI and hand an <img> something it cannot draw.
      if (!b || b.size < 64) return null;
      if (b.type && b.type.indexOf("image") !== 0) {
        photoDiag.lastType = b.type;
        return null;
      }
      photoDiag.ok++;
      return new Promise(function (res) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.onerror = function () { res(null); };
        fr.readAsDataURL(b);
      });
    }).catch(function () { return null; });
}

var searchType = null, probeChain = Promise.resolve(null);
function probeOnce(uin, term) {
  var i = 0;
  function attempt() {
    if (i >= SEARCH_TYPES.length) return Promise.resolve(null);
    var t = SEARCH_TYPES[i++];
    return postJSON("studentPagesCommonSearch/searchResults",
      { term: term, id: uin, firstName: "", lastName: "", searchType: t })
      .then(function (j) { return (j && j.result && j.result.length) ? t : attempt(); }, attempt);
  }
  return attempt();
}
/* Serialised, and failures are never cached: an empty probe is ambiguous
 * between "wrong searchType" and "no such UIN", so one bad UIN at the top of a
 * pasted list must not condemn the endpoint for the rest. */
function resolveSearchType(uin, term) {
  if (searchType !== null) return Promise.resolve(searchType);
  probeChain = probeChain.then(function () {
    if (searchType !== null) return searchType;
    return probeOnce(uin, term).then(function (t) {
      if (t !== null) { searchType = t; if (DEBUG) console.log("[console] searchType =", JSON.stringify(t)); }
      return searchType;
    });
  });
  return probeChain.then(function (t) {
    if (t === null) throw new Error("not found (or search unavailable)");
    return t;
  });
}

function lookupByUIN(uin, term) {
  return resolveSearchType(uin, term).then(function (st) {
    return postJSON("studentPagesCommonSearch/searchResults",
      { term: term, id: uin, firstName: "", lastName: "", searchType: st });
  }).then(function (j) {
    var rows = (j && j.result) || [];
    var hit = rows.filter(function (r) {
      return String(r.id || "").replace(/^0+/, "") === String(uin).replace(/^0+/, "");
    })[0];
    if (!hit || !hit.xyz) throw new Error("not found");
    return {
      key: hit.xyz, uin: uin, xyz: hit.xyz,
      raw: hit.name || "", name: normName(hit.name || "") ||
        [hit.firstName, hit.lastName].filter(Boolean).join(" "),
      majors: ["—"], college: "", admit: "", standing: "", confidential: false,
      email: "", crn: null, term: String(term), photo: null, history: null
    };
  });
}

/* Majors, college and admit term for a student who did not come from a roster.
 * A roster row carries its own curriculum; a search result carries a name and
 * a record handle and nothing else, which is why a pasted group showed blank
 * columns. This is the call the class-list page makes for its detail row, and
 * it is keyed by CRN — so it only works once the student's own registration
 * has supplied one. */
function fetchCurriculum(s, term) {
  if (!s.uin || !s.crn) return Promise.resolve(null);
  return apiGet("studentDetails/curriculum", "term=" + encodeURIComponent(term) +
    "&crn=" + encodeURIComponent(s.crn) + "&bannerId=" + encodeURIComponent(s.uin))
    .then(function (j) {
      var d = (j && j.data) || j || {};
      var pc = d.primaryCurriculum || {};
      var majors = majorsIn(d);
      if (majors.length) s.majors = majors;
      if (pc.college) s.college = pc.college;
      if (pc.termAdmit) s.admit = pc.termAdmit;
      if (pc.level && !s.standing) s.standing = pc.level;
      return d;
    }).catch(function () { return null; });
}

/* studentContactCard/retrieveData?bannerId=…&termCode=… — also CRN-free.
 *
 * The curriculum call above needs a CRN, so it can only describe a student
 * who is in one of your sections. This one answers for anybody, which is what
 * a pasted group needs. It returns less — one primary major rather than every
 * curriculum — so it fills gaps rather than replacing the richer call.
 *
 * The payload also carries a home address and phone number. Those are read
 * past, not stored: the console has no screen that wants them. */
function fetchContactCard(s, term) {
  if (!s.uin) return Promise.resolve(null);
  return apiGet("studentContactCard/retrieveData", "bannerId=" + encodeURIComponent(s.uin) +
    "&termCode=" + encodeURIComponent(term))
    .then(function (j) {
      var c = (j && j.data && j.data.contactCard) || (j && j.contactCard) || null;
      if (!c) return null;
      if (c.primaryMajor && (!s.majors || !s.majors.length || s.majors[0] === "—"))
        s.majors = [c.primaryMajor];
      if (c.primaryProgram && !s.college) s.college = c.primaryProgram;
      if (c.emailAddress && !s.email) s.email = c.emailAddress;
      if (c.isConfidentialStudent === true) s.confidential = true;
      if (!s.name && c.displayName) s.name = normName(c.displayName);
      return c;
    }).catch(function () { return null; });
}

var historyCache = {};
function fetchHistory(s, term) {
  if (s.history) return Promise.resolve(s.history);
  if (historyCache[s.xyz]) { s.history = historyCache[s.xyz]; return Promise.resolve(s.history); }
  return postJSON("registrationHistory/fetchRegistrationHistory",
    { term: term, xyz: s.xyz }).then(function (j) {
    var grid = (j && j.registrationGrid) || {};
    var courses = (grid.result || []).map(function (c) {
      return {
        term: c.term, termCode: String(c.termCode || ""), crn: String(c.crn || ""),
        course: c.course, title: c.courseTitle, credits: c.credits,
        status: c.status, midterm: c.midtermGrade, final: c.finalGrade, meetings: []
      };
    });
    historyCache[s.xyz] = courses;
    s.history = courses;
    return courses;
  });
}

/* When a section meets, and who teaches it — one call answers both.
 *
 * getFacultyMeetingTimes returns fmt[], and each entry carries a meetingTime
 * *and* the faculty assigned to it. The console read only the times for a long
 * while, so the instructor was fetched, parsed and thrown away on every
 * schedule it drew.
 *
 * The two halves are independent: a section can have an instructor and no
 * times on file (an independent study), or times and no instructor (staff).
 * Both are normal, so neither is required for the answer to count. */
var sectionCache = {};

function fetchSectionTimes(termCode, crn) {
  var key = termCode + ":" + crn;
  if (sectionCache[key]) return Promise.resolve(sectionCache[key]);
  return apiGet("sectionDetails/getFacultyMeetingTimes",
    "term=" + encodeURIComponent(termCode) +
    "&courseReferenceNumber=" + encodeURIComponent(crn))
    // A section with nothing on file is a normal answer, not a failure: the
    // caller gets empty lists either way and the cache remembers it.
    .catch(function () { return null; })
    .then(function (j) {
      var fmt = (j && j.fmt) || [];
      var meetings = fmt.map(function (f) {
        var m = f.meetingTime || {};
        return { days: DAYS.map(function (d) { return !!m[d]; }), begin: m.beginTime, end: m.endTime,
                 building: m.buildingDescription || m.building, room: m.room };
      }).filter(function (m) { return m.begin && m.days.some(Boolean); });

      // One name per person, however many meeting patterns they are listed
      // against — a Monday lecture and a Wednesday lab are one instructor.
      var seen = {}, instructors = [];
      fmt.forEach(function (f) {
        (f.faculty || []).forEach(function (p) {
          var name = normName(p.displayName || p.name || "");
          if (!name || seen[name]) return;
          seen[name] = 1;
          instructors.push({ name: name, email: p.emailAddress || "",
                             primary: p.primaryIndicator === true });
        });
      });
      /* Primary first. Banner promises no order, and a section whose lab
       * assistant happens to be listed first would otherwise name the wrong
       * person in a one-line schedule. */
      instructors.sort(function (a, b) { return (b.primary ? 1 : 0) - (a.primary ? 1 : 0); });

      var out = { meetings: meetings, instructors: instructors };
      sectionCache[key] = out;
      return out;
    });
}

/* What Banner holds about a course, for the floating pane.
 *
 * These endpoints answer with HTML fragments — Banner assembles its own modal
 * out of them — so what arrives here is a string and stays one. Turning it
 * into something readable needs a DOM, which this file does not have.
 *
 * Every part is optional and failure is per-part: a course with no
 * prerequisites and a campus that does not serve getRestrictions at all
 * produce the same empty answer, and neither should cost the description. */
var COURSE_PARTS = [
  { family: "courseDetails/getCourseDescription", label: "Description" },
  { family: "courseDetails/getPrerequisites", label: "Prerequisites" },
  { family: "courseDetails/getCorequisites", label: "Corequisites" },
  { family: "courseDetails/getRestrictions", label: "Restrictions" },
  { family: "courseDetails/getCourseAttributes", label: "Attributes" },
  { family: "sectionDetails/getClassDetails", label: "Section details" }
];

/* Seats, from the call the sidebar already uses for enrolment counts. Keyed by
 * CRN and term, and it answers for sections you teach — a student's other
 * courses are somebody else's class, so an empty answer here is expected
 * rather than broken. */
function seatsIn(j) {
  var d = (j && (j.data || j.result || j)) || null;
  if (Array.isArray(d)) d = d[0];
  if (!d || d.courseEnrolmentCount == null) return null;
  function num(v) { return v == null || v === "" ? null : +v; }
  return { enrolled: num(d.courseEnrolmentCount), max: num(d.maxEnrollmentCount),
           avail: num(d.seatsAvailCount), waiting: num(d.waitListCount) };
}

var courseCache = {};

function fetchCourseDetail(termCode, crn) {
  var key = termCode + ":" + crn;
  if (courseCache[key]) return Promise.resolve(courseCache[key]);
  var qs = "term=" + encodeURIComponent(termCode) +
           "&courseReferenceNumber=" + encodeURIComponent(crn);

  var jobs = COURSE_PARTS.map(function (p) {
    return apiText(p.family, qs).then(function (t) {
      var s = String(t == null ? "" : t).trim();
      return s ? { label: p.label, html: s } : null;
    }, function (e) {
      if (DEBUG) console.log("[console] " + p.family + ": " + (e.message || e));
      return "failed";
    });
  });
  jobs.push(apiGet("courseList/courseInfoAndEnrollmentCounts",
    "crn=" + encodeURIComponent(crn) + "&term=" + encodeURIComponent(termCode))
    .then(seatsIn, function () { return null; }));

  return Promise.all(jobs).then(function (r) {
    var seats = r.pop();
    var out = {
      parts: r.filter(function (x) { return x && x !== "failed"; }),
      // Told apart so the pane can say "nothing on file" for this course
      // rather than "these endpoints are not here", which are different
      // problems with different answers.
      failed: r.filter(function (x) { return x === "failed"; }).length,
      tried: r.length, seats: seats
    };
    courseCache[key] = out;
    return out;
  });
}

/* Everything the scheduling and detail views need for one student: history,
 * then times and instructors for that term's sections. Section detail is
 * shared, so the cache means a class of 80 costs a handful of extra calls,
 * not 80. */
function hydrate(students, term, onProgress) {
  return pool(students, CONCURRENCY, function (s) {
    return fetchHistory(s, term).catch(function () { return []; });
  }, onProgress).then(function () {
    var want = {}, jobs = [];
    students.forEach(function (s) {
      (s.history || []).forEach(function (c) {
        if (c.termCode !== term || !c.crn) return;
        var k = c.termCode + ":" + c.crn;
        if (!want[k]) { want[k] = 1; jobs.push(c); }
      });
    });
    return pool(jobs, CONCURRENCY, function (c) { return fetchSectionTimes(c.termCode, c.crn); })
      .then(function () {
        students.forEach(function (s) {
          (s.history || []).forEach(function (c) {
            var sec = sectionCache[c.termCode + ":" + c.crn];
            c.meetings = (sec && sec.meetings) || [];
            c.instructors = (sec && sec.instructors) || [];
          });
        });
        return students;
      });
  });
}
