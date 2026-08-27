/* Banner Plus — classes, rosters, student records and scheduling in one place.
 *
 * GENERATED FILE. Built from bookmarklet/src/*.js by bookmarklet/build.py.
 * Edit the sources, not this.
 *
 * Click the bookmarklet on any Banner Faculty Self-Service page. It runs in
 * that page, on the session you are already signed in to; nothing is uploaded
 * and nothing is installed.
 *
 *   sidebar   your sections for a term, plus saved groups of students
 *   middle    the roster, as a grid of faces or as a table
 *   right     the focused student — schedule and transcript — or, for a
 *             selection, a heatmap of when they are collectively free
 *
 * WHY THIS EXISTS
 *
 * Banner shows one record at a time, because that is what a record-management
 * system does. Everything worth having here is a join it will not do: a roster
 * as one sheet of faces, a group's schedules overlaid to find a free hour, a
 * term's sections in one list. The point is not a prettier Banner.
 *
 * THE SOURCE, IN LOADING ORDER
 *
 *   10-core         constants, DOM and formatting helpers
 *   20-api          headers, the /ssb prefix resolver, GET and POST
 *   30-banner       one function per endpoint; no DOM
 *   40-domain       categories, GPA arithmetic, the free/busy map
 *   50-print        the photo roster and free-time sheets
 *   60-groups       artificial classes, stored in localStorage
 *   70-shell        the overlay: toolbar, progress, drawer, panes
 *   80-sidebar      sections and groups, and the group editor
 *   90-roster       the middle pane, as photos or as a table
 *   100-student     the student pane and the transcript grid
 *   110-scheduling  shared free time
 *   120-load        opening a section or a group
 *   130-boot        terms, and starting up
 *
 * Files 10-60 touch no DOM and 70 onwards draw; the split falls there because
 * a change to how Banner answers should never be a change to how anything
 * looks. Order matters only for the files that have side effects: 20 reads the
 * synchronizer token, 30 asks Banner where the student host is, 70 puts the
 * window on screen, and 130 starts the first fetch.
 *
 * ENDPOINTS
 *
 * Documented in ENDPOINTS.md, including what each is keyed by and the traps.
 * Banner mixes its path conventions — some endpoints sit under /ssb and some
 * directly under /FacultySelfService — so the prefix is resolved per family at
 * runtime rather than written down. Hardcoding it is what made an early build
 * find no classes at all.
 */

(function () {
  "use strict";

  // ---- src/10-core.js ----------------------------------------------------
  /* ---- Constants and small helpers ------------------------------------------
   *
   * The vocabulary the rest of the console is written in: the shape of a week,
   * the colours, and the handful of functions that build a node, throttle a fan
   * of requests, and turn Banner's formats into readable ones.
   *
   * Nothing here knows anything about Banner or about the screen.
   */

  var DEBUG = /[?&]debug/.test(location.href);

  var DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  var DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var DAY_LETTER = ["M", "T", "W", "R", "F", "S", "U"];
  var CONCURRENCY = 6;

  var PLANNER_URL = "https://mgrau.github.io/semester-planner/";

  // Free-time heatmap geometry.
  var SLOT = 30, DAY_START = 8 * 60, DAY_END = 20 * 60;
  var N_SLOTS = (DAY_END - DAY_START) / SLOT;

  /* Sequential blue for the heatmap: one magnitude (how many are free), so one
   * hue, light to dark. Ink flips to white at step 500 where dark ink drops
   * below 4.5:1 on the fill. */
  var RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"];
  var RAMP_INK = ["#16191f", "#16191f", "#16191f", "#16191f", "#ffffff", "#ffffff"];

  // Categorical hues for major badges, in fixed order — never cycled past the end.
  var CAT = ["#2a78d6", "#1baf7a", "#4a3aa7", "#e34948", "#eb6834", "#008300"];
  var OTHER_COLOR = "#8a6d3b";
  var MAX_CATEGORIES = 6;

  // ---- helpers -------------------------------------------------------------

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    for (var k in props || {}) {
      if (k === "style") { for (var s in props[k]) n.style[s] = props[k][s]; }
      else if (k === "text") { n.textContent = props[k]; }
      else if (k === "html") { n.innerHTML = props[k]; }
      else n.setAttribute(k, props[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function pool(items, limit, worker, onProgress) {
    return new Promise(function (resolve) {
      var out = new Array(items.length), i = 0, done = 0;
      if (!items.length) return resolve(out);
      function next() {
        if (i >= items.length) return;
        var idx = i++;
        Promise.resolve(worker(items[idx], idx))
          .then(function (v) { out[idx] = v; }, function () { out[idx] = null; })
          .then(function () {
            done++;
            if (onProgress) onProgress(done, items.length);
            if (done === items.length) resolve(out); else next();
          });
      }
      for (var c = 0; c < Math.min(limit, items.length); c++) next();
    });
  }

  function mins(t) {
    if (!t || String(t).length < 3) return null;
    t = String(t);
    return (+t.slice(0, t.length - 2)) * 60 + (+t.slice(-2));
  }
  function hhmm(t) {
    if (!t || String(t).length < 3) return "";
    t = String(t);
    var h = +t.slice(0, t.length - 2), m = t.slice(-2);
    var ap = h >= 12 ? "pm" : "am";
    return (h % 12 || 12) + ":" + m + ap;
  }
  function clock(x) {
    var h = Math.floor(x / 60), m = x % 60, ap = h >= 12 ? "pm" : "am";
    return (h % 12 || 12) + (m ? ":" + ("0" + m).slice(-2) : "") + ap;
  }
  function daysLabel(d) {
    return d.map(function (on, i) { return on ? DAY_LETTER[i] : ""; }).join("") || "—";
  }

  function normName(raw) {
    if (!raw) return "";
    var p = String(raw).split(","), last = p[0] || "", first = p.slice(1).join(",") || "";
    function tc(s) {
      return s.split(/(-|'|\s+|\.)/).map(function (x) {
        if (!x || x === "-" || x === "'" || x === "." || /^\s+$/.test(x)) return x;
        return x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
      }).join("");
    }
    return (tc(first.trim()) + " " + tc(last.trim())).trim();
  }

  function parseTerm(t) {
    var m = /(Spring|Summer|Fall|Winter)\s+(\d{4})/i.exec(t || "");
    if (!m) return null;
    var s = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return { season: s === "Winter" ? "Spring" : s, year: +m[2] };
  }

  function semesterNum(admit, ref) {
    var a = parseTerm(admit);
    if (!a || !ref) return "?";
    var ae = a.season === "Summer" ? "Fall" : a.season;
    var re = ref.season === "Summer" ? "Fall" : ref.season;
    var n = 1 + 2 * (ref.year - a.year);
    if (re === "Fall" && ae === "Spring") n += 1;
    else if (re === "Spring" && ae === "Fall") n -= 1;
    return n < 1 ? 1 : n;
  }

  function tint(hex) {
    var h = hex.replace("#", "");
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    function hx(n) { return ("0" + Math.round(n).toString(16)).slice(-2); }
    return { bg: "#" + hx(r + (255 - r) * .88) + hx(g + (255 - g) * .88) + hx(b + (255 - b) * .88),
             fg: "#" + hx(r * .62) + hx(g * .62) + hx(b * .62) };
  }

  var SILHOUETTE = "data:image/svg+xml;base64," + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#e8eaee"/><circle cx="50" cy="38" r="17" fill="#c2c8d2"/>' +
    '<path d="M18 92c0-19 14-30 32-30s32 11 32 30z" fill="#c2c8d2"/></svg>');

  // ---- src/20-api.js -----------------------------------------------------
  /* ---- Talking to Banner ----------------------------------------------------
   *
   * Every call goes through here, so the two things Banner is inconsistent about
   * — which headers it wants and whether an endpoint lives under /ssb — are
   * settled once rather than at each call site.
   */

  var base = location.origin + "/FacultySelfService";

  /* Look like Banner's own AJAX. Its recorded requests carry
   * X-Requested-With and, on several endpoints, X-Synchronizer-Token; without
   * them courseList/courseList answers 401 even though the session is valid and
   * the path is right. The token is only sent when one was found on the page —
   * inventing a value would be worse than omitting it. */
  function apiHeaders(extra) {
    var h = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };
    if (TOKEN) h["X-Synchronizer-Token"] = TOKEN;
    for (var k in extra || {}) h[k] = extra[k];
    return h;
  }

  /* A 401 or 403 can mean the headers were wrong rather than the caller being
   * unwelcome, so a rejected request is retried bare once. Which one worked is
   * remembered per family, the same way the path prefix is. */
  var bareFor = {};

  function fetchJSON(family, url) {
    function go(bare) {
      return fetch(url, {
        credentials: "same-origin",
        headers: bare ? { Accept: "application/json" } : apiHeaders()
      }).then(function (r) {
        if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
        return r.json();
      });
    }
    /* A 401 here has been seen to be transient — the identical request, bare,
     * succeeded moments later — so it is retried rather than treated as a
     * refusal. Order: with headers, bare, then bare once more after a pause.
     * Banner answers 404 for a URL it does not serve, so a 401 never means the
     * endpoint is wrong. */
    function pause(ms) {
      return new Promise(function (r) { setTimeout(r, ms); });
    }
    function transient(e) { return e.status === 401 || e.status === 403; }

    if (bareFor[family]) return go(true);
    return go(false).catch(function (e) {
      if (!transient(e)) throw e;
      return go(true).then(function (j) {
        bareFor[family] = true;
        if (DEBUG) console.log("[console] " + family + " prefers no custom headers");
        return j;
      }, function (e2) {
        if (!transient(e2)) throw e2;
        if (DEBUG) console.log("[console] " + family + " " + e2.message + " — retrying once");
        return pause(600).then(function () { return go(true); });
      });
    });
  }

  /* Banner mixes its path conventions. Recordings show
   * ssb/registrationHistory and ssb/studentPagesCommonSearch under /ssb, while
   * sectionDetails and courseDetails sit directly under the app root; classList
   * and courseList are reached as "../classList/…" from /ssb/classListApp/,
   * so they are under /ssb too.
   *
   * Encoding that as a table invites exactly the bug it is meant to prevent —
   * omitting /ssb for courseList is what made this find no classes at all. So
   * each family tries /ssb first, falls back to the bare root, and the winner is
   * remembered for the session. A wrong prefix 404s, which is a clean signal. */
  var prefixFor = {};

  function withPrefix(family, run) {
    var order = prefixFor[family] ? [prefixFor[family]] : ["/ssb/", "/"];
    var i = 0;
    function attempt() {
      if (i >= order.length) {
        return Promise.reject(new Error(family + ": not found under /ssb/ or /"));
      }
      var p = order[i++];
      return run(p).then(function (j) {
        if (!prefixFor[family]) {
          prefixFor[family] = p;
          if (DEBUG) console.log("[console] " + family + " -> " + p);
        }
        return j;
      }, function (e) {
        if (i < order.length) return attempt();
        throw e;
      });
    }
    return attempt();
  }

  function apiGet(family, qs) {
    return withPrefix(family, function (p) {
      return fetchJSON(family, base + p + family + (qs ? "?" + qs : ""));
    });
  }

  function postJSON(family, body) {
    return withPrefix(family, function (p) {
      return fetch(base + p + family, {
        method: "POST", credentials: "same-origin",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " " + family);
        return r.json();
      });
    });
  }

  function findToken() {
    var sels = ['meta[name="synchronizerToken"]', 'meta[name="_csrf"]', 'meta[name="csrf-token"]',
                'input[name="synchronizerToken"]', 'input[name="_csrf"]'];
    for (var i = 0; i < sels.length; i++) {
      var n = document.querySelector(sels[i]);
      if (n && (n.content || n.value)) return n.content || n.value;
    }
    for (var k in window) {
      try {
        if (/synchronizer|csrf/i.test(k) && typeof window[k] === "string" && window[k].length > 8)
          return window[k];
      } catch (e) {}
    }
    return null;
  }

  /* Read once, at load. The token is stamped into the page Banner served and
   * nothing here navigates, so it cannot go stale underneath us. */
  var TOKEN = findToken();
  if (DEBUG) console.log("[console] synchronizer token:", TOKEN ? "found" : "NOT FOUND");

  /* The longest array of objects anywhere in a payload is the list.
   * Banner's envelope key has already differed from its endpoint name once
   * (classlistDetail, lowercase l) and its sibling classListSummary answers
   * under "result", so guessing a key by name is how this keeps breaking. */
  function biggestArray(obj, best, seen) {
    best = best || []; seen = seen || [];
    if (!obj || typeof obj !== "object" || seen.indexOf(obj) > -1) return best;
    seen.push(obj);
    if (Array.isArray(obj)) {
      if (obj.length > best.length && obj[0] && typeof obj[0] === "object") best = obj;
      return best;
    }
    Object.keys(obj).forEach(function (k) { best = biggestArray(obj[k], best, seen); });
    return best;
  }

  // ---- src/30-banner.js --------------------------------------------------
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

  var meetingCache = {};
  function fetchMeetings(termCode, crn) {
    var key = termCode + ":" + crn;
    if (meetingCache[key]) return Promise.resolve(meetingCache[key]);
    return apiGet("sectionDetails/getFacultyMeetingTimes",
      "term=" + encodeURIComponent(termCode) +
      "&courseReferenceNumber=" + encodeURIComponent(crn))
      // A section with no times on file is a normal answer, not a failure: the
      // caller gets an empty list either way and the cache remembers it.
      .catch(function () { return null; })
      .then(function (j) {
        var out = ((j && j.fmt) || []).map(function (f) {
          var m = f.meetingTime || {};
          return { days: DAYS.map(function (d) { return !!m[d]; }), begin: m.beginTime, end: m.endTime,
                   building: m.buildingDescription || m.building, room: m.room };
        }).filter(function (m) { return m.begin && m.days.some(Boolean); });
        meetingCache[key] = out;
        return out;
      });
  }

  /* Everything the scheduling and detail views need for one student: history,
   * then meeting times for that term's sections. Section times are shared, so
   * the cache means a class of 80 costs a handful of extra calls, not 80. */
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
      return pool(jobs, CONCURRENCY, function (c) { return fetchMeetings(c.termCode, c.crn); })
        .then(function () {
          students.forEach(function (s) {
            (s.history || []).forEach(function (c) {
              c.meetings = meetingCache[c.termCode + ":" + c.crn] || [];
            });
          });
          return students;
        });
    });
  }

  // ---- src/40-domain.js --------------------------------------------------
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

  // ---- src/50-print.js ---------------------------------------------------
  /* ---- Printable sheets -----------------------------------------------------
   *
   * Two documents: a photo roster and a free-time sheet. Each is a whole HTML
   * page built as a string and opened in its own window, rather than a print
   * stylesheet over the console — a sheet meant for paper wants a different
   * layout, not the same layout with things hidden.
   *
   * They go out as blob: URLs with an explicit charset. document.write into an
   * iframe inherits the parent page's encoding, which turned every em dash into
   * mojibake.
   */

  function pageCSS() {
    return "@page{size:letter portrait;margin:.5in}*{box-sizing:border-box}" +
      "body{font:11pt/1.42 -apple-system,Helvetica Neue,Arial,sans-serif;margin:0;color:#16191f;background:#fff}" +
      "header{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:.05in .3in;" +
      "border-bottom:1.5px solid #222;padding-bottom:.06in;margin-bottom:.12in}" +
      "h1{font-size:13pt;margin:0;white-space:nowrap}" +
      ".sub{font-size:7.3pt;color:#5b6675;flex:1 1 auto;min-width:3in}" +
      ".legend{display:flex;flex-wrap:wrap;gap:.14in;font-size:7.3pt}" +
      ".li{display:flex;align-items:center;gap:.04in;white-space:nowrap}" +
      ".sw{width:9px;height:9px;border-radius:2px;border:1.3px solid;display:inline-block}" +
      ".grid-row{display:flex;gap:.1in;align-items:flex-start;break-inside:avoid;page-break-inside:avoid}" +
      ".grid-row+.grid-row{margin-top:.11in}" +
      ".card{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0}" +
      ".photo{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:6px;border:1px solid #ccc;display:block;background:#eee}" +
      ".nm{font-size:8.3pt;font-weight:600;line-height:1.15;margin-top:.04in}" +
      ".sem{font-weight:400;color:#666}" +
      ".conf{font-size:6.4pt;font-weight:700;color:#fff;background:#b3261e;border-radius:2px;padding:0 2.5px}" +
      // Tabular figures so a column of UINs lines up digit for digit, which is
      // what makes one scannable against a list you are holding.
      ".uin{font-size:6.9pt;color:#5b6675;font-variant-numeric:tabular-nums;line-height:1.25}" +
      ".mj{font-size:7.3pt;margin-top:.035in;padding:.02in .05in;border-radius:4px;border:1px solid;display:inline-block;line-height:1.2}" +
      ".hm{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;font-size:8pt}" +
      ".hm th{font-size:7.6pt;color:#5b6675;font-weight:600;padding:2px;text-align:center}" +
      ".hm td{padding:0}.hm .tl{width:.56in;font-size:7pt;color:#5b6675;text-align:right;padding-right:5px}" +
      ".cell{height:.19in;border:.5px solid #fff;border-radius:2px;text-align:center;font-size:6.8pt;line-height:1.6;font-variant-numeric:tabular-nums}" +
      ".lg{display:flex;align-items:center;gap:.04in;font-size:7.6pt;color:#5b6675;margin-top:.1in}" +
      ".lg i{display:inline-block;width:.19in;height:.1in;border-radius:2px;border:.5px solid #d8dde5}" +
      ".best{margin-top:.14in;font-size:9pt}.best ol{margin:.04in 0 0;padding-left:.22in}" +
      ".note{font-size:8pt;color:#5b6675;margin-top:.1in;line-height:1.35}";
  }

  function wrapDoc(title, body) {
    return "<!doctype html><html><head><meta charset=utf-8><title>" + esc(title) +
      "</title><style>" + pageCSS() + "</style></head><body>" + body + "</body></html>";
  }

  function photoRosterDoc(students, title, termLabel, cols) {
    var ref = parseTerm(termLabel);
    var cats = autoCategories(students);
    var counts = {}, cells = students.map(function (s) {
      var info = categoryFor(s.majors, cats);
      counts[info.label] = (counts[info.label] || 0) + 1;
      var t = tint(info.color);
      var sem = s.admit ? semesterNum(s.admit, ref) : "?";
      return '<div class="card" style="flex:0 0 calc((100% - ' + (cols - 1) + ' * .1in) / ' + cols + ')">' +
        '<img class="photo" src="' + (s.photo || SILHOUETTE) + '" alt="' + esc(s.name) + '">' +
        '<div class="nm">' + esc(s.name) + ' <span class="sem">(' + sem + "Y)</span>" +
        (s.confidential ? ' <span class="conf">C</span>' : "") + "</div>" +
        (s.uin ? '<div class="uin">' + esc(s.uin) + "</div>" : "") +
        '<div class="mj" style="background:' + t.bg + ";border-color:" + info.color + ";color:" + t.fg + '">' +
        esc((s.majors || []).join(" / ")) + "</div></div>";
    });
    var rows = "";
    for (var i = 0; i < cells.length; i += cols)
      rows += '<div class="grid-row">' + cells.slice(i, i + cols).join("") + "</div>";

    var items = Object.keys(cats).map(function (k) {
      return { label: cats[k].label, color: cats[k].color, n: counts[cats[k].label] || 0 };
    });
    items.push({ label: "Other", color: OTHER_COLOR, n: counts.Other || 0 });
    var legend = items.filter(function (i2) { return i2.n > 0; }).map(function (i2) {
      return '<span class="li"><span class="sw" style="background:' + tint(i2.color).bg +
        ";border-color:" + i2.color + '"></span>' + esc(i2.label) + " (" + i2.n + ")</span>";
    }).join("");

    var sub = students.length + " students &middot; (nY) = semester count from " + esc(termLabel) +
      (students.some(function (s) { return s.confidential; })
        ? ' &middot; <span class="conf">C</span> = directory information confidential' : "");
    return wrapDoc(title + " roster",
      "<header><h1>" + esc(title) + " &mdash; " + esc(termLabel) + '</h1><div class="sub">' + sub +
      '</div><div class="legend">' + legend + "</div></header>" + rows);
  }

  function freeTimeDoc(students, termCode, termLabel, nDays) {
    var scheduled = withMeetings(students, termCode);
    var missing = students.filter(function (s) { return scheduled.indexOf(s) < 0; });
    var total = scheduled.length;
    if (!total) return wrapDoc("Free time", "<header><h1>Shared free time</h1></header>" +
      '<div class="note">No meeting times on file for these students this term.</div>');

    var g = busyMap(scheduled, termCode, nDays);
    var rows = "", d, s;
    for (s = 0; s < N_SLOTS; s++) {
      var t0 = DAY_START + s * SLOT, cells = "";
      for (d = 0; d < nDays; d++) {
        var free = total - g[d][s].length, i = rampStep(free, total);
        cells += '<td><div class="cell" style="background:' + RAMP[i] + ";color:" + RAMP_INK[i] +
          '">' + (free || "") + "</div></td>";
      }
      rows += '<tr><td class="tl">' + (t0 % 60 === 0 ? clock(t0) : "") + "</td>" + cells + "</tr>";
    }
    var heads = "";
    for (d = 0; d < nDays; d++) heads += "<th>" + DAY_ABBR[d] + "</th>";

    var flat = [];
    for (d = 0; d < nDays; d++) for (s = 0; s < N_SLOTS; s++)
      flat.push({ d: d, s: s, free: total - g[d][s].length });
    var peak = Math.max.apply(null, flat.map(function (x) { return x.free; }));
    var runs = [], cur = null;
    flat.filter(function (x) { return x.free >= peak; })
      .sort(function (a, b) { return a.d - b.d || a.s - b.s; })
      .forEach(function (x) {
        if (cur && cur.d === x.d && x.s === cur.end + 1) { cur.end = x.s; return; }
        cur = { d: x.d, start: x.s, end: x.s }; runs.push(cur);
      });
    runs.sort(function (a, b) { return (b.end - b.start) - (a.end - a.start); });

    return wrapDoc("Free time — " + termLabel,
      "<header><h1>Shared free time &mdash; " + esc(termLabel) + '</h1><div class="sub">' +
      total + " students &middot; darker means more of them are free</div></header>" +
      '<table class="hm"><thead><tr><th></th>' + heads + "</tr></thead><tbody>" + rows +
      "</tbody></table>" +
      '<div class="lg"><span>none free</span>' +
      RAMP.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") +
      "<span>all " + total + " free</span></div>" +
      '<div class="best"><b>Best windows</b> &mdash; ' + peak + " of " + total + " free<ol>" +
      runs.slice(0, 6).map(function (r) {
        return "<li>" + DAY_ABBR[r.d] + " " + clock(DAY_START + r.start * SLOT) + "&ndash;" +
          clock(DAY_START + (r.end + 1) * SLOT) + "</li>";
      }).join("") + "</ol></div>" +
      '<div class="note">Counts students not in a scheduled class. It cannot see work or commutes, ' +
      "so read it as the ceiling on who could attend." +
      (missing.length ? " Not counted, no meeting times on file: " +
        esc(missing.map(function (m) { return m.name; }).join(", ")) + "." : "") + "</div>");
  }

  /* Open a generated sheet, and optionally raise the print dialog once it has
   * actually rendered. Printing immediately after window.open prints a blank
   * page — the document has not parsed yet — so this waits for readyState.
   * The blob is same-origin, so reaching into the new window is allowed. */
  function openDoc(html, andPrint) {
    var url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    var w = window.open(url, "_blank");
    if (!w) { alert("Popup blocked — allow popups for this site."); return null; }
    if (!andPrint) return w;
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var ready = false;
      try { ready = w.document && w.document.readyState === "complete"; }
      catch (e) { clearInterval(t); return; }          // window closed
      if (ready) {
        clearInterval(t);
        try { w.focus(); w.print(); } catch (e) {}
      } else if (tries > 80) {                          // ~8s, then give up quietly
        clearInterval(t);
      }
    }, 100);
    return w;
  }

  /* Plain-text transcript for mgrau.github.io/semester-planner, which accepts a
   * pasted transcript. The planner is a different origin, so its localStorage is
   * out of reach; the clipboard is the handoff that needs nothing from it. */
  function plannerText(s) {
    var byTerm = {};
    (s.history || []).forEach(function (c) {
      (byTerm[c.termCode] = byTerm[c.termCode] || { label: c.term, rows: [] }).rows.push(c);
    });
    var out = [s.name + "  " + s.uin, ""];
    Object.keys(byTerm).sort().forEach(function (code) {
      out.push(byTerm[code].label);
      byTerm[code].rows.forEach(function (c) {
        out.push("  " + (c.course || "") + "  " + (c.title || "") + "  " +
          (c.credits || "") + "  " + (c.final || "IP"));
      });
      out.push("");
    });
    return out.join("\n");
  }

  /* How many pages a roster will come to at a given width.
   *
   * Renders a candidate off-screen and walks the real row heights rather than
   * multiplying one card's, because a two-line name makes its row taller than
   * its neighbours. Only used to tell you what you are about to send to the
   * printer — the width itself is yours to choose, in settings. */
  function pageCount(html, cb) {
    var f = el("iframe", { style: { position: "fixed", left: "-10000px", top: "0",
      width: (8.5 - 1) * 96 + "px", height: (11 - 1) * 96 + "px", border: "0" } });
    document.body.appendChild(f);
    var d = f.contentDocument;
    d.open(); d.write(html); d.close();
    setTimeout(function () {
      var head = d.querySelector("header");
      var rows = [].map.call(d.querySelectorAll(".grid-row"), function (r) {
        return r.getBoundingClientRect().height;
      });
      var usable = (11 - 1) * 96, gap = 0.11 * 96, SLACK = 3;
      var pages = 1, y = head ? head.getBoundingClientRect().height : 40;
      rows.forEach(function (h, i) {
        if (i > 0) y += gap;
        if (y + h > usable + SLACK) { pages++; y = 0; }
        y += h;
      });
      f.remove();
      cb(pages);
    }, 40);
  }

  // ---- src/60-groups.js --------------------------------------------------
  /* ---- Groups ---------------------------------------------------------------
   *
   * An artificial class: a set of students who share no section — a research
   * group, a set of advisees, a cohort. Once built it behaves like a roster
   * everywhere else in the console.
   *
   * Groups live in this browser's localStorage and nowhere else. That is the
   * whole storage story: there is no server to keep them on.
   */

  var GROUP_KEY = "banner_console_groups";

  /* A group is {name, students:[{uin, name}]}.
   *
   * It used to be a bare list of UINs, which meant the edit screen could only
   * show numbers — you cannot check a membership list you cannot read. Names are
   * remembered as they are resolved, so the list is legible without a lookup
   * every time it opens. Older groups are migrated on read. */
  function loadGroups() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(GROUP_KEY)) || []; } catch (e) { return []; }
    return raw.map(function (g) {
      if (g.students) return g;
      return { name: g.name, students: (g.uins || []).map(function (u) {
        return { uin: String(u), name: "" };
      }) };
    });
  }
  function saveGroups(g) {
    try { localStorage.setItem(GROUP_KEY, JSON.stringify(g)); } catch (e) {}
  }
  function groupUins(g) {
    return (g.students || []).map(function (x) { return x.uin; }).filter(Boolean);
  }

  /* Search by name, for adding someone whose UIN you do not have. The same
   * endpoint that turns a UIN into a record handle takes firstName/lastName
   * instead; "Last, First" and "First Last" both land. */
  function searchByName(query, term) {
    var q = String(query || "").trim();
    if (q.length < 2) return Promise.resolve([]);
    var first = "", last = q;
    if (q.indexOf(",") > -1) {
      last = q.split(",")[0].trim();
      first = q.split(",").slice(1).join(",").trim();
    } else if (/\s/.test(q)) {
      var bits = q.split(/\s+/);
      last = bits.pop(); first = bits.join(" ");
    }
    return resolveSearchType("", term).catch(function () { return null; }).then(function (st) {
      return postJSON("studentPagesCommonSearch/searchResults",
        { term: term, id: "", firstName: first, lastName: last, searchType: st || "Student" });
    }).then(function (j) {
      return ((j && j.result) || []).map(function (r) {
        return { uin: String(r.id || ""), name: normName(r.name || "") ||
                 [r.firstName, r.lastName].filter(Boolean).join(" "), xyz: r.xyz };
      }).filter(function (x) { return x.uin; });
    }).catch(function () { return []; });
  }

  function parseUINs(raw) {
    var seen = {}, out = [];
    String(raw || "").split(/[\s,;]+/).forEach(function (u) {
      u = u.trim();
      if (u && !seen[u]) { seen[u] = 1; out.push(u); }
    });
    return out;
  }

  // ---- src/70-shell.js ---------------------------------------------------
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

  // ---- src/80-sidebar.js -------------------------------------------------
  /* ---- The sidebar and the group editor -------------------------------------
   *
   * Your sections for the selected term, then your groups. A group in this list
   * is also a drop target: select students in the roster and drag one of their
   * photos here to add them.
   *
   * The editor is a membership list, because that is what a group is. It
   * replaced a textarea of bare UINs, which was fine for creating a group in one
   * go and useless for checking one — a column of eight-digit numbers cannot be
   * read.
   */

  function renderSide() {
    side.innerHTML = "";
    side.appendChild(el("div", { text: "My classes",
      style: { fontSize: "11px", color: "#6b7280", fontWeight: "600", margin: "2px 0 6px" } }));

    if (!S.sections.length)
      side.appendChild(el("div", { text: "none this term",
        style: { fontSize: "12px", color: "#9aa1ab", padding: "4px 0" } }));

    S.sections.forEach(function (sec) {
      var on = S.source && S.source.kind === "section" && S.source.crn === sec.crn;
      var b = el("div", { style: {
        padding: "6px 8px", borderRadius: "6px", cursor: "pointer", marginBottom: "3px",
        background: on ? "#e7f0fd" : "transparent",
        borderLeft: on ? "3px solid #2a78d6" : "3px solid transparent"
      } });
      var head = el("div", { style: { display: "flex", alignItems: "baseline", gap: "5px" } });
      head.appendChild(el("div", { text: sec.label || sec.crn,
        style: { fontWeight: "600", fontSize: "12.5px" } }));
      if (sec.enrolled != null)
        head.appendChild(el("div", { text: sec.enrolled,
          title: sec.enrolled + " enrolled",
          style: { marginLeft: "auto", fontSize: "11px", fontWeight: "600",
                   color: sec.enrolled === "0" ? "#9aa1ab" : "#2a78d6" } }));
      b.appendChild(head);
      // Truncate the title, never the CRN — the CRN is the part you might need
      // to type somewhere else, and it was being eaten by the ellipsis.
      var subline = el("div", { style: { display: "flex", gap: "5px", fontSize: "11px",
        color: "#6b7280", alignItems: "baseline" } });
      subline.appendChild(el("div", { text: sec.title || "", style: {
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: "0" } }));
      subline.appendChild(el("div", {
        text: (S.term === ALL_TERMS_CODE && sec.termLabel ? sec.termLabel + " · " : "") + sec.crn,
        style: { marginLeft: "auto", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" } }));
      b.appendChild(subline);
      // An empty section is still worth listing — you may be checking whether
      // anyone has registered — but it should not look like a normal one.
      if (sec.enrolled === "0") b.style.opacity = ".62";
      b.onclick = function () { openSection(sec); };
      side.appendChild(b);
    });

    side.appendChild(el("div", { text: "Groups",
      style: { fontSize: "11px", color: "#6b7280", fontWeight: "600", margin: "14px 0 6px" } }));
    S.groups.forEach(function (grp, i) {
      var on = S.source && S.source.kind === "group" && S.source.name === grp.name;
      var wrap = el("div", { style: {
        display: "flex", alignItems: "center", gap: "4px", padding: "6px 8px", borderRadius: "6px",
        marginBottom: "3px", cursor: "pointer",
        background: on ? "#e7f0fd" : "transparent",
        borderLeft: on ? "3px solid #2a78d6" : "3px solid transparent" } });
      var lab = el("div", { style: { flex: "1 1 auto", minWidth: "0" } });
      lab.appendChild(el("div", { text: grp.name, style: { fontWeight: "600", fontSize: "12.5px" } }));
      lab.appendChild(el("div", { text: (grp.students || []).length + " students",
        style: { fontSize: "11px", color: "#6b7280" } }));
      lab.onclick = function () { openGroup(grp); };

      // Drop target. dataTransfer cannot be read during dragover, so the count
      // comes from a body attribute set at dragstart.
      wrap.addEventListener("dragover", function (ev) {
        if (!dragCarry) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        wrap.style.background = "#d7e8ff";
        wrap.style.borderLeft = "3px solid #2a78d6";
      });
      wrap.addEventListener("dragleave", function () {
        wrap.style.background = on ? "#e7f0fd" : "transparent";
        wrap.style.borderLeft = on ? "3px solid #2a78d6" : "3px solid transparent";
      });
      wrap.addEventListener("drop", function (ev) {
        ev.preventDefault();
        var carry = dragCarry;
        if (!carry) {
          try { carry = JSON.parse(ev.dataTransfer.getData("application/x-bc-students")); }
          catch (e) { carry = null; }
        }
        dragCarry = null;
        document.body.removeAttribute("data-bc-dragging");
        if (!carry || !carry.length) { renderSide(); return; }
        var n = addToGroup(i, carry);
        idle(n
          ? n + " added to " + grp.name
          : "already in " + grp.name + " — nothing added");
      });
      function iconBtn(glyph, title, fn) {
        var b = el("button", { text: glyph, title: title, style: {
          border: "0", background: "transparent", cursor: "pointer", color: "#9aa1ab",
          font: "inherit", fontSize: "13px", padding: "0 3px", lineHeight: "1" } });
        b.onclick = function (ev) { ev.stopPropagation(); fn(); };
        return b;
      }
      var edit = iconBtn("✎", "Edit group", function () { editGroup(i); });
      var del = iconBtn("×", "Delete group", function () {
        // Groups are typed by hand and only live in this browser, so deleting
        // one is not recoverable from anywhere.
        if (!confirm('Delete the group "' + grp.name + '"? This cannot be undone.')) return;
        S.groups.splice(i, 1);
        saveGroups(S.groups);
        if (S.source && S.source.kind === "group" && S.source.name === grp.name) {
          S.source = null; S.students = []; S.sel = {}; S.focus = null;
          setRightOpen(false);
          renderMain();
        }
        renderSide();
      });
      del.style.fontSize = "15px";
      wrap.appendChild(lab); wrap.appendChild(edit); wrap.appendChild(del);
      side.appendChild(wrap);
    });

    var add = el("button", { text: "+ New group from UINs", style: {
      width: "100%", marginTop: "6px", padding: "6px", borderRadius: "6px",
      border: "1px dashed #c7d0dd", background: "transparent", color: "#41556f",
      cursor: "pointer", font: "inherit", fontSize: "12px" } });
    add.onclick = newGroup;
    side.appendChild(add);
  }

  /* The group editor.
   *
   * A group is a membership list, so the screen is the list: names and UINs, one
   * row each, with a way to remove any of them. It replaced a textarea of bare
   * numbers, which was fine for creating a group in one go and useless for
   * checking or amending one — a list of eight-digit numbers cannot be read.
   *
   * Two ways in: search by name for someone whose UIN you do not have, and paste
   * UINs for when you do. Neither is the primary; people arrive with either.
   */
  function showGroupModal(opts) {
    var members = (opts.students || []).map(function (m) {
      return { uin: String(m.uin), name: m.name || "" };
    });

    var back = el("div", { style: {
      position: "absolute", top: "0", left: "0", right: "0", bottom: "0",
      background: "rgba(15,18,25,.55)", zIndex: "10",
      display: "flex", alignItems: "center", justifyContent: "center" } });

    var card = el("div", { style: {
      background: "#fff", borderRadius: "12px", padding: "18px 20px", width: "560px",
      maxWidth: "94%", maxHeight: "88vh", display: "flex", flexDirection: "column",
      boxShadow: "0 20px 50px rgba(0,0,0,.35)" } });
    card.onclick = function (ev) { ev.stopPropagation(); };

    card.appendChild(el("div", { text: opts.title || "New group",
      style: { fontWeight: "700", fontSize: "16px", marginBottom: "2px" } }));
    card.appendChild(el("div", {
      text: "An artificial class built from students — a research group, a set of advisees.",
      style: { fontSize: "12px", color: "#6b7280", marginBottom: "10px" } }));

    var fieldStyle = {
      width: "100%", padding: "7px 9px", borderRadius: "6px", border: "1px solid #c7d0dd",
      font: "inherit", color: "#16191f", background: "#fff" };
    function label(t) {
      return el("label", { text: t, style: {
        display: "block", fontSize: "11px", color: "#6b7280", fontWeight: "600",
        margin: "10px 0 3px" } });
    }

    var nameIn = el("input", { style: fieldStyle });
    nameIn.placeholder = "Research group";
    nameIn.value = opts.name || "";
    card.appendChild(label("Name"));
    card.appendChild(nameIn);

    var countLbl = label("Members");
    card.appendChild(countLbl);
    var listBox = el("div", { style: {
      border: "1px solid #c7d0dd", borderRadius: "6px", overflow: "auto",
      maxHeight: "220px", minHeight: "64px", flex: "0 1 auto" } });
    card.appendChild(listBox);

    function renderMembers() {
      listBox.innerHTML = "";
      countLbl.textContent = "Members (" + members.length + ")";
      if (!members.length) {
        listBox.appendChild(el("div", {
          text: "Empty — add students below, or save now and drag them in later.",
          style: { padding: "14px", color: "#9aa1ab", fontSize: "12px", fontStyle: "italic" } }));
        return;
      }
      var tbl = el("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: "12.5px" } });
      members.forEach(function (m, i) {
        var tr = el("tr");
        tr.appendChild(el("td", { text: m.name || "(name not loaded)", style: {
          padding: "5px 8px", borderBottom: "1px solid #eef1f5",
          color: m.name ? "#16191f" : "#9aa1ab", fontStyle: m.name ? "normal" : "italic" } }));
        tr.appendChild(el("td", { text: m.uin, style: {
          padding: "5px 8px", borderBottom: "1px solid #eef1f5", color: "#6b7280",
          fontVariantNumeric: "tabular-nums", width: "96px" } }));
        var td = el("td", { style: { padding: "2px 6px", borderBottom: "1px solid #eef1f5", width: "30px" } });
        var x = el("button", { text: "\u00d7", title: "Remove from group", style: {
          border: "0", background: "transparent", cursor: "pointer", color: "#9aa1ab",
          fontSize: "16px", lineHeight: "1", padding: "0 3px" } });
        x.onclick = function () { members.splice(i, 1); renderMembers(); };
        td.appendChild(x);
        tr.appendChild(td);
        tbl.appendChild(tr);
      });
      listBox.appendChild(tbl);
    }

    function addMember(uin, name) {
      uin = String(uin || "").trim();
      if (!uin) return false;
      var dupe = members.filter(function (m) {
        return m.uin.replace(/^0+/, "") === uin.replace(/^0+/, "");
      })[0];
      if (dupe) { if (name && !dupe.name) dupe.name = name; return false; }
      members.push({ uin: uin, name: name || "" });
      return true;
    }

    // ---- add by name ------------------------------------------------------
    card.appendChild(label("Add by name"));
    var searchIn = el("input", { style: fieldStyle });
    searchIn.placeholder = "Surname, or \u201cSurname, First\u201d";
    card.appendChild(searchIn);
    var results = el("div", { style: {
      border: "1px solid #eef1f5", borderRadius: "6px", marginTop: "4px",
      maxHeight: "132px", overflow: "auto", display: "none" } });
    card.appendChild(results);

    var searchTimer = null, searchSeq = 0;
    function runSearch() {
      var q = searchIn.value.trim();
      if (q.length < 2) { results.style.display = "none"; return; }
      var mine = ++searchSeq;
      results.style.display = "block";
      results.innerHTML = "";
      results.appendChild(el("div", { text: "Searching\u2026",
        style: { padding: "8px", fontSize: "12px", color: "#9aa1ab" } }));
      searchByName(q, curTerm()).then(function (rows) {
        if (mine !== searchSeq) return;       // a later keystroke already won
        results.innerHTML = "";
        if (!rows.length) {
          results.appendChild(el("div", { text: "No match in " + curLabel(),
            style: { padding: "8px", fontSize: "12px", color: "#9aa1ab" } }));
          return;
        }
        rows.slice(0, 25).forEach(function (r) {
          var already = members.filter(function (m) { return m.uin === r.uin; }).length > 0;
          var row = el("div", { style: {
            display: "flex", gap: "8px", alignItems: "center", padding: "5px 8px",
            cursor: already ? "default" : "pointer", fontSize: "12.5px",
            opacity: already ? ".5" : "1", borderBottom: "1px solid #f4f6fa" } });
          row.appendChild(el("div", { text: r.name, style: { flex: "1 1 auto", minWidth: "0",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }));
          row.appendChild(el("div", { text: r.uin, style: {
            color: "#6b7280", fontVariantNumeric: "tabular-nums" } }));
          row.appendChild(el("div", { text: already ? "in group" : "+ add", style: {
            color: already ? "#9aa1ab" : "#2a78d6", fontWeight: "600", width: "54px",
            textAlign: "right" } }));
          if (!already) row.onclick = function () {
            addMember(r.uin, r.name);
            renderMembers();
            runSearch();                       // refresh the "in group" marks
          };
          results.appendChild(row);
        });
      });
    }
    searchIn.oninput = function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 320);   // one request per pause, not per key
    };

    // ---- add by pasting UINs ---------------------------------------------
    card.appendChild(label("Or paste UINs"));
    var pasteRow = el("div", { style: { display: "flex", gap: "6px" } });
    var uinIn = el("input", { style: fieldStyle });
    uinIn.placeholder = "01234567 01234568 \u2026";
    var addBtn = btn("Add");
    addBtn.onclick = function () {
      var n = 0;
      parseUINs(uinIn.value).forEach(function (u) { if (addMember(u, "")) n++; });
      uinIn.value = "";
      renderMembers();
      if (n) status.textContent = "added " + n;
    };
    uinIn.onkeydown = function (ev) { if (ev.key === "Enter") { ev.preventDefault(); addBtn.onclick(); } };
    pasteRow.appendChild(uinIn); pasteRow.appendChild(addBtn);
    card.appendChild(pasteRow);

    // ---- buttons ----------------------------------------------------------
    var bar2 = el("div", { style: {
      display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "14px" } });
    var cancel = btn("Cancel");
    var save = btn(opts.submitLabel || "Create group", true);
    bar2.appendChild(cancel); bar2.appendChild(save);
    card.appendChild(bar2);
    back.appendChild(card);
    app.appendChild(back);

    function close() {
      document.removeEventListener("keydown", onKey, true);
      back.remove();
    }
    /* An empty group saves. Creating the container first and dragging people in
     * afterwards is a reasonable order to work in — and it is the order the
     * sidebar invites, since a group has to exist before it can be a drop
     * target. */
    function submit() {
      close();
      opts.onSave((nameIn.value || "").trim() || "Group", members);
    }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.stopPropagation(); close(); }
      else if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submit(); }
    }
    cancel.onclick = close;
    back.onclick = close;
    save.onclick = submit;
    document.addEventListener("keydown", onKey, true);

    renderMembers();
    if (members.length) searchIn.focus(); else nameIn.focus();
  }

  function newGroup() {
    showGroupModal({
      title: "New group",
      submitLabel: "Create group",
      onSave: function (name, students) {
        S.groups.push({ name: name, students: students });
        saveGroups(S.groups);
        renderSide();
        openGroup(S.groups[S.groups.length - 1]);
      }
    });
  }

  function editGroup(i) {
    var grp = S.groups[i];
    showGroupModal({
      title: "Edit group",
      submitLabel: "Save",
      name: grp.name,
      students: grp.students,
      onSave: function (name, students) {
        var wasOpen = S.source && S.source.kind === "group" && S.source.name === grp.name;
        S.groups[i] = { name: name, students: students };
        saveGroups(S.groups);
        renderSide();
        // Reload if the group being edited is the one on screen, so the roster
        // matches the list that was just saved.
        if (wasOpen) openGroup(S.groups[i]);
      }
    });
  }

  /* Dropping students onto a group in the sidebar.
   *
   * Adds only; a drop never removes anyone, so a mis-drop costs one trip to the
   * editor rather than losing a list. Returns how many were new, because "0
   * added, all 4 already there" and "4 added" should not look the same. */
  function addToGroup(i, students) {
    var grp = S.groups[i];
    if (!grp) return 0;
    grp.students = grp.students || [];
    var have = {};
    grp.students.forEach(function (m) { have[String(m.uin).replace(/^0+/, "")] = m; });
    var added = 0;
    students.forEach(function (s) {
      if (!s.uin) return;
      var k = String(s.uin).replace(/^0+/, "");
      if (have[k]) { if (s.name && !have[k].name) have[k].name = s.name; return; }
      var m = { uin: String(s.uin), name: s.name || "" };
      grp.students.push(m);
      have[k] = m;
      added++;
    });
    saveGroups(S.groups);
    renderSide();
    return added;
  }

  // ---- src/90-roster.js --------------------------------------------------
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
      // Tabular figures so a column of them lines up digit for digit.
      if (s.uin) card.appendChild(el("div", { text: s.uin, style: {
        fontSize: "10px", color: "#5b6675", lineHeight: "1.25",
        fontVariantNumeric: "tabular-nums" } }));
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

  // ---- src/100-student.js ------------------------------------------------
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

    var pbtn = btn("Semester Planner ↗", true);
    pbtn.title = "Copies this transcript to the clipboard and opens the planner, " +
      "which takes a pasted transcript.";
    pbtn.style.flex = "1";
    pbtn.onclick = function () {
      var text = plannerText(s);
      function go() { window.open(PLANNER_URL, "_blank"); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          // The button says what happened, since the clipboard gives no sign.
          pbtn.textContent = "Transcript copied — paste it there";
          go();
        }, function () { console.log(text); go(); });
      } else { console.log(text); go(); }
    };
    links.appendChild(pbtn);

    return links;
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
      var out = [nodes[0], nodes[1], exitLinks(s)];

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
       * unreadable from this page; the profile button at the top is the way to
       * it. */
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

      showRight(out);
    }).catch(function (e) {
      loading.textContent = "Couldn't load record: " + (e.message || e);
      loading.style.color = "#b3261e";
    });
  }

  // ---- src/110-scheduling.js ---------------------------------------------
  /* ---- Shared free time -----------------------------------------------------
   *
   * Select any set of students and see when they are collectively not in class.
   * Pointed at a roster it answers what office hours are really asking; pointed
   * at a research group it replaces opening twelve schedules side by side.
   *
   * Hovering a slot fills the panel below the grid with who is free and who is
   * not. That belongs in a panel rather than a tooltip: it is the question the
   * whole view exists to answer, and a tooltip vanishes the moment you look away
   * from it to think.
   */

  function openScheduling() {
    var group = selectedStudents();
    var nodes = [paneHeader("Scheduling", function () { setRightOpen(false); })];
    var info = el("div", { text: "Loading " + group.length + " schedules…",
      style: { color: "#6b7280", fontSize: "12px" } });
    nodes.push(info);
    showRight(nodes);

    taskBegin("Loading " + group.length + " schedules…");
    hydrate(group, curTerm(), function (d, t) {
      info.textContent = "Loading schedules… " + d + "/" + t;
      prog(null, d, t);
    })
      .then(function () {
        var out = [nodes[0]];
        var nDays = S.sat ? 6 : 5;
        var scheduled = withMeetings(group, curTerm());
        var total = scheduled.length;
        out.push(el("div", { text: total + " of " + group.length + " have scheduled classes",
          style: { fontSize: "12px", color: "#6b7280", marginBottom: "8px" } }));

        // idle(null) left "Loading 3 schedules…" on screen after it had finished.
        idle(total + " of " + group.length + " have scheduled classes");
        if (!total) { showRight(out); return; }
        var g = busyMap(scheduled, curTerm(), nDays);

        var tbl = el("table", { style: { width: "100%", borderCollapse: "separate",
          borderSpacing: "0", tableLayout: "fixed", fontSize: "10px" } });
        var hr = el("tr");
        hr.appendChild(el("th", { style: { width: "42px" } }));
        for (var d = 0; d < nDays; d++)
          hr.appendChild(el("th", { text: DAY_ABBR[d], style: {
            fontSize: "11px", color: "#6b7280", paddingBottom: "3px" } }));
        tbl.appendChild(hr);

        // Who is free, and who is not, for whatever cell the pointer is over.
        var detail = el("div", { style: {
          marginTop: "8px", padding: "8px 10px", border: "1px solid #e6eaf0",
          borderRadius: "7px", background: "#fafbfd", fontSize: "11.5px",
          minHeight: "76px", lineHeight: "1.5" } });

        function showSlot(d, sIdx) {
          detail.innerHTML = "";
          var t0 = DAY_START + sIdx * SLOT;
          var busyIdx = g[d][sIdx];
          var busySet = {};
          busyIdx.forEach(function (bi) { busySet[bi] = 1; });
          var freeNames = [], busyNames = [];
          scheduled.forEach(function (st, i2) {
            (busySet[i2] ? busyNames : freeNames).push(st.name);
          });

          var head = el("div", { style: { fontWeight: "700", marginBottom: "3px" } });
          head.appendChild(el("span", { text: DAY_ABBR[d] + " " + clock(t0) + "\u2013" +
            clock(t0 + SLOT) }));
          head.appendChild(el("span", { text: "  " + freeNames.length + " of " + total + " free",
            style: { color: "#2a78d6" } }));
          detail.appendChild(head);

          function nameRow(label, names, color) {
            if (!names.length) return;
            var row = el("div", { style: { display: "flex", gap: "5px", marginTop: "2px" } });
            row.appendChild(el("span", { text: label, style: {
              color: color, fontWeight: "600", flex: "0 0 auto", minWidth: "58px" } }));
            row.appendChild(el("span", { text: names.join(", "), style: {
              color: "#41556f", minWidth: "0" } }));
            detail.appendChild(row);
          }
          nameRow("Free", freeNames, "#1b7a4b");
          nameRow("In class", busyNames, "#b3261e");
        }

        function clearSlot() {
          detail.innerHTML = "";
          detail.appendChild(el("div", { text: "Hover a time to see who is free.",
            style: { color: "#9aa1ab", fontStyle: "italic" } }));
        }

        for (var s = 0; s < N_SLOTS; s++) {
          var t0 = DAY_START + s * SLOT;
          var tr = el("tr");
          tr.appendChild(el("td", { text: t0 % 60 === 0 ? clock(t0) : "",
            style: { fontSize: "10px", color: "#6b7280", textAlign: "right", paddingRight: "5px",
                     whiteSpace: "nowrap" } }));
          for (d = 0; d < nDays; d++) {
            var free = total - g[d][s].length;
            var i = rampStep(free, total);
            var cell = el("td", { style: { padding: "0" } });
            var box = el("div", {
              text: free || "",
              style: { height: "19px", lineHeight: "19px", textAlign: "center", borderRadius: "2px",
                       border: "1px solid #fff", background: RAMP[i], color: RAMP_INK[i],
                       fontSize: "10px", cursor: "default" }
            });
            (function (dd, ss, node) {
              node.onmouseenter = function () {
                node.style.outline = "2px solid #16191f";
                node.style.outlineOffset = "-2px";
                showSlot(dd, ss);
              };
              node.onmouseleave = function () { node.style.outline = "none"; };
            })(d, s, box);
            cell.appendChild(box);
            tr.appendChild(cell);
          }
          tbl.appendChild(tr);
        }
        out.push(tbl);
        clearSlot();
        out.push(detail);

        var lg = el("div", { style: { display: "flex", alignItems: "center", gap: "3px",
          fontSize: "10.5px", color: "#6b7280", marginTop: "6px" } });
        lg.appendChild(el("span", { text: "none" }));
        RAMP.forEach(function (c) {
          lg.appendChild(el("i", { style: { width: "16px", height: "9px", borderRadius: "2px",
            background: c, display: "inline-block", border: "1px solid #d8dde5" } }));
        });
        lg.appendChild(el("span", { text: "all " + total }));
        out.push(lg);

        var satLbl = el("label", { style: { display: "flex", alignItems: "center", gap: "5px",
          fontSize: "11.5px", color: "#41556f", marginTop: "8px", cursor: "pointer" } });
        var sb = el("input", { type: "checkbox" });
        sb.checked = S.sat;
        sb.onchange = function () { S.sat = sb.checked; openScheduling(); };
        satLbl.appendChild(sb); satLbl.appendChild(document.createTextNode("include Saturday"));
        out.push(satLbl);

        var pb = btn("Print free-time sheet", true);
        pb.style.width = "100%"; pb.style.marginTop = "8px";
        pb.onclick = function () {
          openDoc(freeTimeDoc(group, curTerm(), curLabel(), nDays), true);
        };
        out.push(pb);

        showRight(out);
      });
  }

  // ---- src/120-load.js ---------------------------------------------------
  /* ---- Putting students on screen -------------------------------------------
   *
   * Opening a section or a group ends here, in setStudents(). Both arrive with
   * different amounts already known — a roster row carries its curriculum, a
   * pasted UIN carries a name and nothing else — so this is where the gaps get
   * filled and the photos stream in.
   *
   * Fetching stays lazy on purpose. A roster is students and photographs;
   * registration history is fetched per student when you open one, or for a
   * selection when you ask for scheduling. Pulling eighty histories to show one
   * face would be slow for no reason and rude to a shared service.
   */

  function printPhotoRoster() {
    var group = selectedStudents();
    taskBegin("Laying out roster…");
    var html = photoRosterDoc(group, S.source.label, curLabel(), printCols);
    // Open first, then count. The page count is a courtesy in the status line
    // and should not stand between the click and the print dialog.
    openDoc(html, true);
    pageCount(html, function (pages) {
      idle(group.length + " students · " + printCols + " per row · " +
           pages + " page" + (pages === 1 ? "" : "s"));
    });
  }

  function setStudents(list, label, source, emptyMessage) {
    photoDiag = { tried: 0, ok: 0, noId: 0, lastURL: null, lastStatus: null, lastType: null };
    S.students = list; S.sel = {}; S.focus = null; S.source = source;
    S.source.label = label;
    setRightOpen(false);
    renderSide(); renderMain();

    /* Nobody to fetch anything for. Said here rather than by the caller: the
     * photo pass below ends in idle("0 students"), which would land after the
     * caller's own message and quietly replace it with a worse one. */
    if (!list.length) {
      idle(emptyMessage || "nobody in " + label);
      return;
    }

    // Students are in hand; photos are the long tail, so they own most of the bar.
    taskPhase("Photos… 0/" + list.length, 0.15, 1);
    // Photos stream in; the grid is usable before they land. Students who
    // arrived without curriculum — anyone from a pasted group — get it here,
    // now that their registration has supplied a CRN to ask with.
    var needCur = list.filter(function (s) {
      return !s.majors || !s.majors.length || s.majors[0] === "—";
    });
    if (needCur.length) {
      // Contact card first: it needs only a bannerId, so it answers for a
      // student who is in none of your sections. Curriculum adds college and
      // admit term on top, but only where a CRN exists to ask with.
      pool(needCur, CONCURRENCY, function (s) {
        return fetchContactCard(s, s.term || curTerm()).then(function () {
          if (s.crn && !s.admit) return fetchCurriculum(s, s.term || curTerm());
        });
      }).then(function () { renderMain(); });
    }

    pool(list, CONCURRENCY, function (s) {
      return fetchPhoto(s).then(function (uri) {
        s.photo = uri;
        if (uri && s._img) s._img.src = uri;
      });
    }, function (d, t) { prog("Photos… " + d + "/" + t, d, t); })
      .then(function () {
        var msg = list.length + " students";
        if (photoDiag.tried && !photoDiag.ok) {
          msg += " · no photos (HTTP " + photoDiag.lastStatus + ", " +
                 (photoDiag.lastType || "no content-type") + ")";
          console.warn("[console] photos failed. Last URL:", photoDiag.lastURL,
                       "status", photoDiag.lastStatus, "type", photoDiag.lastType);
        } else if (photoDiag.ok < photoDiag.tried) {
          msg += " · " + photoDiag.ok + "/" + photoDiag.tried + " photos";
        }
        if (photoDiag.noId)
          msg += " · " + photoDiag.noId + " with no ID";
        idle(msg);
      });
  }

  function openSection(sec) {
    taskBegin("Loading roster…");
    S.activeTerm = sec.term || S.term;
    S.activeLabel = sec.termLabel || S.termLabel;
    fetchRoster(S.activeTerm, sec.crn).then(function (list) {
      setStudents(list, sec.label || ("CRN " + sec.crn), { kind: "section", crn: sec.crn });
    }).catch(function (e) {
      idle("Roster failed: " + (e.message || e));
    });
  }

  function openGroup(grp) {
    // A group is not tied to a term, so under "All terms" it needs a concrete
    // one to resolve against; the newest standard term is the useful default.
    if (S.term === ALL_TERMS_CODE) {
      var t = newestStandard();
      S.activeTerm = t ? t.code : null;
      S.activeLabel = t ? t.description : "";
    } else {
      S.activeTerm = S.term; S.activeLabel = S.termLabel;
    }
    var uinList = groupUins(grp);
    if (!uinList.length) {
      // Select it anyway: an empty group still needs to be the highlighted drop
      // target, or there is nowhere to drag the first student to.
      setStudents([], grp.name, { kind: "group", name: grp.name },
                  grp.name + " is empty");
      return;
    }
    taskBegin("Resolving " + uinList.length + " UIN" + (uinList.length === 1 ? "" : "s") + "…");
    // Resolving UINs is the first half of building a group; photos follow.
    taskPhase(null, 0, 0.5);
    pool(uinList, CONCURRENCY, function (u) {
      return lookupByUIN(u, curTerm()).catch(function (e) {
        console.warn("[console] " + u + ": " + e.message);
        return null;
      });
    }, function (d, t) { prog("Resolving… " + d + "/" + t, d, t); })
      .then(function (r) {
        var list = r.filter(Boolean);
        if (!list.length) { idle("No students resolved."); return; }
        // Remember the names we just learned, so editing shows people not numbers.
        var byUin = {};
        list.forEach(function (x) { if (x.uin) byUin[x.uin] = x.name; });
        var changed = false;
        (grp.students || []).forEach(function (m) {
          if (byUin[m.uin] && m.name !== byUin[m.uin]) { m.name = byUin[m.uin]; changed = true; }
        });
        if (changed) saveGroups(S.groups);
        // A search result has no CRN, and both the photo and the curriculum call
        // need one. Their own registration supplies it, so fetch history first
        // — which the schedule and scheduling views want anyway.
        taskPhase("Loading records… 0/" + list.length, 0.35, 0.6);
        return hydrate(list, curTerm(), function (d, t) {
          prog("Loading records… " + d + "/" + t, d, t);
        }).then(function () {
          list.forEach(function (s) {
            var c = (s.history || []).filter(function (x) {
              return x.termCode === curTerm() && x.crn;
            })[0];
            if (c) s.crn = c.crn;
          });
          var known = list.filter(function (s) { return s.crn; }).length;
          if (DEBUG) console.log("[console] group: " + known + "/" + list.length + " have a CRN this term");
          setStudents(list, grp.name, { kind: "group", name: grp.name });
        });
      });
  }

  // ---- src/130-boot.js ---------------------------------------------------
  /* ---- Terms, and starting up -----------------------------------------------
   *
   * The term list drives everything else: pick a term, get your sections, pick a
   * section, get a roster. This file fills the dropdown, loads sections for
   * whatever is selected, and then kicks the whole thing off.
   */

  var ALL_TERMS = [];

  function fillTerms() {
    termSel.innerHTML = "";
    var list = S.allTerms ? ALL_TERMS : ALL_TERMS.filter(isStandardTerm);
    if (!list.length) list = ALL_TERMS;
    termSel.appendChild(el("option", { value: ALL_TERMS_CODE, text: "All terms" }));
    list.forEach(function (t) {
      termSel.appendChild(el("option", { value: t.code, text: t.description }));
    });
    // Default to the newest real term rather than the everything view: teaching
    // now is the common case, and the fan-out costs a request per term.
    termSel.selectedIndex = list.length ? 1 : 0;
    S.term = termSel.value;
    S.termLabel = termSel.options[termSel.selectedIndex].text;
  }

  /* A section with nobody in it is noise here: cross-listed shells, dissertation
   * sections, cancelled offerings. Rows whose enrolment is unknown — the
   * fallback endpoint does not report it — are kept rather than guessed at. */
  function withStudents(secs) {
    if (!S.hideEmpty) return secs;
    return secs.filter(function (x) { return x.enrolled == null || x.enrolled !== "0"; });
  }

  function loadSections() {
    var job;
    if (S.term === ALL_TERMS_CODE) {
      var terms = ALL_TERMS.filter(isStandardTerm);
      taskBegin("Loading classes across " + terms.length + " terms…");
      job = pool(terms, 4, function (t) {
        return fetchMySections(t.code).then(function (secs) {
          secs.forEach(function (x) { x.term = t.code; x.termLabel = t.description; });
          return secs;
        }).catch(function () { return []; });
      }, function (d, n) { prog("Terms… " + d + "/" + n, d, n); })
        .then(function (lists) {
          var all = [];
          lists.filter(Boolean).forEach(function (l) { all = all.concat(l); });
          return all.sort(function (a, b) {          // newest term first
            return String(b.term).localeCompare(String(a.term)) ||
              a.subj.localeCompare(b.subj) ||
              a.num.localeCompare(b.num, undefined, { numeric: true });
          });
        });
    } else {
      taskBegin("Loading your classes…");
      job = fetchMySections(S.term).then(function (secs) {
        secs.forEach(function (x) { x.term = S.term; x.termLabel = S.termLabel; });
        return secs;
      });
    }

    job.then(function (secs) {
      var shown = withStudents(secs);
      S.sections = shown;
      var hidden = secs.length - shown.length;
      /* Distinguish "you teach nothing" from "the call failed" — they looked
       * identical, and only one of them is a bug. A failed warm-up is named
       * separately again, because that one has a fix the reader can apply: open
       * Faculty Class List and click again. */
      idle(shown.length
        ? shown.length + " class" + (shown.length === 1 ? "" : "es") +
          (hidden ? " · " + hidden + " empty hidden" : "")
        : (/^request failed/.test(sectionDiag.keys || "")
            ? (/^failed/.test(sectionDiag.warmed || "")
                ? "couldn't reach the class list app — open Faculty Class List, then click again"
                : "couldn't load classes — " + sectionDiag.keys)
            : hidden ? hidden + " empty section" + (hidden === 1 ? "" : "s") + ", none with students"
                     : "no classes in " + S.termLabel));
      if (!secs.length) console.warn("[console] courseList returned no usable rows;", sectionDiag);
      renderSide();
    });
  }

  termSel.onchange = function () {
    S.term = termSel.value;
    S.termLabel = termSel.options[termSel.selectedIndex].text;
    S.source = null; S.students = []; S.sel = {}; S.focus = null;
    setRightOpen(false);
    renderMain();
    loadSections();
  };

  renderSide(); renderMain();
  taskBegin("Loading terms…");
  fetchTerms().then(function (terms) {
    if (!terms.length) {
      idle("Couldn't load terms — is this a Banner faculty page?");
      return;
    }
    ALL_TERMS = terms;
    fillTerms();
    loadSections();
  });

})();
