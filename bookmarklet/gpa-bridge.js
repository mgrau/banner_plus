/* GPA bridge — runs on the STUDENT self-service host, reports back to the console.
 *
 * Paste this into the DevTools console on a studentssb studentProfile page that
 * the Banner console opened. Read-only.
 *
 * WHY THIS EXISTS
 *
 * ODU splits Banner across two hostnames. Rosters, class lists and registration
 * history are on facultyssb; the student profile — the only place that shows an
 * official GPA — is on studentssb. Those are different origins, so the console
 * cannot fetch the profile or read it in a frame. What it can do is open a
 * window there and exchange postMessage, which crosses origins where reading
 * does not. This is the half that runs on the other side.
 *
 * HOW IT FINDS THE NUMBER
 *
 * The endpoint that serves the GPA has not been recorded, so rather than guess
 * at a URL this tries, in order:
 *
 *   1. studentProfile/viewGPAHoursList?studentId=… — the endpoint a live
 *      profile was observed to use. JSON, keyed by UIN, no term.
 *   2. any JSON endpoint this page called that carries a GPA, replayed per
 *      student, in case the above ever moves
 *   3. fetching the profile page itself and reading it — which does not work
 *      here, since the profile renders its GPA client-side after load
 *
 * Whichever works first is used for everyone. If none works it says so
 * precisely, which is a better outcome than a column of blanks: the fix is then
 * a spy.js recording of this page, and the message says as much.
 */
(async () => {
  var out = [];
  function log(m) { out.push(m); console.log(m); }

  if (!window.opener) {
    alert("Open this page from the Banner console's \\u201cFetch GPAs\\u201d button, " +
          "so there is somewhere to send the results.");
    return;
  }

  // ---- ask the console who to look up --------------------------------------
  var req = await new Promise(function (resolve) {
    var done = false;
    function onMsg(ev) {
      var d = ev.data;
      if (!d || d.type !== "bc-gpa-uins") return;
      done = true;
      window.removeEventListener("message", onMsg);
      resolve(d);
    }
    window.addEventListener("message", onMsg);
    try { window.opener.postMessage({ type: "bc-gpa-request" }, "*"); } catch (e) {}
    setTimeout(function () { if (!done) { window.removeEventListener("message", onMsg); resolve(null); } }, 4000);
  });

  if (!req || !req.uins || !req.uins.length) {
    alert("The console did not answer. Make sure it is still open in the tab that " +
          "opened this window, with a class or group loaded.");
    return;
  }
  var uins = req.uins, term = req.term;
  log("bridge: " + uins.length + " students, term " + term);

  function report(msg) {
    try { window.opener.postMessage({ type: "bc-gpa-error", message: msg }, "*"); } catch (e) {}
  }

  /* A GPA is a number 0–4.x sitting near the letters "GPA". Searching text
   * rather than a known element keeps this working across Banner's markup
   * changes, which is the whole reason the endpoint was not hardcoded either. */
  var GPA_RE = /(?:overall|cumulative|institution(?:al)?|total)?\s*g\.?p\.?a\.?[^0-9]{0,40}([0-4](?:\.\d{1,3})?)\b/i;
  var JSON_RE = /"[a-z]*gpa[a-z]*"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i;

  function fromText(t) {
    var m = JSON_RE.exec(t) || GPA_RE.exec(t);
    return m ? parseFloat(m[1]) : null;
  }

  // ---- 1. the page in front of us ------------------------------------------
  var here = fromText(document.body.innerText || "");
  var currentId = (new URLSearchParams(location.search)).get("studentId");
  if (here != null && currentId) {
    log("found a GPA in this page's text: the profile renders it, so each student " +
        "can be fetched the same way");
  }

  /* The known endpoint, from probing a live profile:
   *
   *   /StudentSelfService/studentProfile/viewGPAHoursList?studentId=<uin>
   *
   * JSON, keyed by UIN, no term, and note it sits directly under the app root
   * rather than under /ssb — Banner mixes those conventions on this host too.
   * Discovery below still runs if this ever stops answering. */
  var APP_ROOT = location.pathname.replace(/\/ssb\/.*$/, "").replace(/\/[^/]*$/, "") || "/StudentSelfService";
  if (!/StudentSelfService/.test(APP_ROOT)) APP_ROOT = "/StudentSelfService";
  var KNOWN = location.origin + APP_ROOT + "/studentProfile/viewGPAHoursList?studentId=";

  /* viewGPAHoursList reports more than one figure — Banner keeps GPA by level
   * and a total. Every candidate is collected with whatever labels its object
   * carries, then ranked, and all of them are logged so a wrong pick is visible
   * rather than silent. */
  function gpasFrom(json) {
    var found = [];
    (function walk(v, seen) {
      if (!v || typeof v !== "object" || seen.indexOf(v) > -1) return;
      seen.push(v);
      if (Array.isArray(v)) { v.forEach(function (x) { walk(x, seen); }); return; }
      var gpaKey = Object.keys(v).filter(function (k) { return /^[a-z_]*gpa[a-z_]*$/i.test(k); })[0];
      if (gpaKey && (typeof v[gpaKey] === "string" || typeof v[gpaKey] === "number")) {
        var n = parseFloat(v[gpaKey]);
        if (isFinite(n)) {
          var label = "";
          Object.keys(v).forEach(function (k) {
            if (/level|type|description|category/i.test(k) && typeof v[k] === "string") label += " " + v[k];
          });
          var hours = 0;
          Object.keys(v).forEach(function (k) {
            if (/hour/i.test(k) && isFinite(parseFloat(v[k]))) hours = Math.max(hours, parseFloat(v[k]));
          });
          found.push({ gpa: n, label: label.trim(), hours: hours, key: gpaKey });
        }
      }
      Object.keys(v).forEach(function (k) { walk(v[k], seen); });
    })(json, []);
    return found;
  }

  function pickGpa(list) {
    if (!list.length) return null;
    var byLabel = list.filter(function (x) { return /total|overall|cumulative/i.test(x.label); });
    if (byLabel.length) return byLabel[0].gpa;
    var byKey = list.filter(function (x) { return /overall|cumulative|total/i.test(x.key); });
    if (byKey.length) return byKey[0].gpa;
    return list.slice().sort(function (a, b) { return b.hours - a.hours; })[0].gpa;
  }

  // ---- 2. replay a JSON endpoint this page used ----------------------------
  /* Anything the page fetched that mentions gpa is a better source than parsing
   * HTML: one small request per student instead of a whole page. */
  function findToken() {
    var sels = ['meta[name="synchronizerToken"]', 'input[name="synchronizerToken"]',
                'meta[name="_csrf"]', 'meta[name="csrf-token"]'];
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
  var TOK = findToken();
  var H = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };
  if (TOK) H["X-Synchronizer-Token"] = TOK;

  var candidate = null;
  try {
    var entries = performance.getEntriesByType("resource")
      .map(function (e) { return e.name; })
      .filter(function (n) { return n.indexOf(location.origin) === 0; })
      .filter(function (n) { return !/\.(js|css|png|jpe?g|gif|svg|woff2?|ico|map)(\?|$)/i.test(n); });
    for (var i = 0; i < entries.length; i++) {
      var u = entries[i];
      try {
        // With Banner's own headers: the first attempt sent bare requests, and
        // anything guarded answered 401, which read as "no GPA in here".
        var r = await fetch(u, { credentials: "same-origin", headers: H });
        if (!r.ok) continue;
        var body = await r.text();
        if (fromText(body) != null && /gpa/i.test(body)) { candidate = u; break; }
      } catch (e) {}
    }
  } catch (e) {}
  if (candidate) log("found a JSON endpoint carrying a GPA: " + candidate.split("?")[0]);

  // ---- 3. fetch each profile and read it -----------------------------------
  function urlFor(uin) {
    if (candidate && currentId) return candidate.split("#")[0].replace(
      new RegExp(encodeURIComponent(currentId) + "|" + currentId, "g"), encodeURIComponent(uin));
    return location.origin + location.pathname + "?studentId=" + encodeURIComponent(uin) +
      "&term=" + encodeURIComponent(term);
  }

  var gpas = {}, misses = 0, loggedShape = false;
  for (var k = 0; k < uins.length; k++) {
    var uin = uins[k], v = null;

    // The known endpoint first.
    try {
      var kr = await fetch(KNOWN + encodeURIComponent(uin), { credentials: "same-origin", headers: H });
      if (kr.ok) {
        var kt = await kr.text(), kj = null;
        try { kj = JSON.parse(kt); } catch (e) {}
        if (kj) {
          var cands = gpasFrom(kj);
          if (!loggedShape && cands.length) {
            loggedShape = true;
            log("  viewGPAHoursList offers: " +
                cands.map(function (c) { return (c.label || c.key) + "=" + c.gpa; }).join(", "));
          }
          v = pickGpa(cands);
        }
        if (v == null) v = fromText(kt);
      }
    } catch (e) {}

    // Then whatever discovery turned up, then the profile page itself.
    if (v == null) {
      try {
        var res = await fetch(urlFor(uin), { credentials: "same-origin", headers: H });
        v = fromText(await res.text());
      } catch (e) {}
    }

    if (v != null) gpas[uin] = v; else misses++;
    log("  " + (k + 1) + "/" + uins.length + (v != null ? "  " + v : "  —"));
  }

  var got = Object.keys(gpas).length;
  if (!got) {
    var msg = "no GPA found — this page loads it by XHR after render, so fetching " +
      "the profile URL returns an empty shell. Run probe-profile.js here: it reads " +
      "the URLs this page already requested and finds the one carrying the GPA.";
    log(msg);
    report(msg);
    alert("GPA bridge: " + msg);
    return;
  }

  try {
    window.opener.postMessage({ type: "bc-gpa-result", gpas: gpas, term: term }, "*");
  } catch (e) {
    report("could not post results back: " + e.message);
  }
  log("sent " + got + " GPAs back to the console" + (misses ? " (" + misses + " not found)" : ""));
  /* Close on success rather than leaving a window and an alert behind. The
   * console opened this one, so closing it is permitted; on failure it stays
   * open, because that is when there is something to read. */
  if (misses) {
    alert("GPA bridge: sent " + got + " of " + uins.length +
          " back. " + misses + " had no GPA on file. Closing.");
  }
  setTimeout(function () { try { window.close(); } catch (e) {} }, misses ? 0 : 400);
})();
