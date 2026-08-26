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
