/* Record the API calls a Banner page makes, so a bookmarklet can make them too.
 *
 * Paste into the DevTools console on any Banner page, then use the page the way
 * you normally would — look up one advisee, open their schedule. Every request
 * the app makes is captured with its URL, parameters, and the *shape* of what
 * came back. Press "Report" for something to paste back.
 *
 * Chrome requires you to type  allow pasting  in the console once first.
 *
 * WHY RECORD INSTEAD OF GUESS
 *
 * Field and endpoint names are not documented anywhere and differ by Banner
 * version and by what a campus turns on. Guessing them cost two rounds on the
 * class list, and the second failure was the dangerous kind — a loose match
 * that produced plausible wrong data rather than an obvious error. Watching the
 * app do the thing is strictly better evidence than inference from its
 * minified source.
 *
 * STUDENT DATA
 *
 * The report describes structure, not people. Values under keys that look
 * identifying (name, id, pidm, email, phone, address, birth, ssn, gpa) are
 * replaced with their type. Everything else keeps one short sample value,
 * because "string" alone rarely tells you what a field is. Scan it before
 * sending it anywhere regardless — it is your roster, and this heuristic is a
 * convenience, not a guarantee.
 *
 * Captures persist in sessionStorage, so following a link to another page does
 * not lose what you already recorded. Re-paste after a full page load to keep
 * recording.
 */
(function () {
  "use strict";

  var KEY = "__banner_spy__";
  // Key names that identify a person. "search" is here because what you typed
  // into a student search box is almost always a UIN or a surname.
  // "search" is here because what someone types into a student search box is
  // almost always a UIN or a surname. searchType is exempt: it names the kind
  // of search, not the person, and redacting it hid the one value needed to
  // replay the call.
  var IDENTIFYING = /name|^id$|studentid|bannerid|uin|pidm|xyz|search|email|phone|address|birth|ssn|gpa|gender|ethnic|citizen|veteran|disab/i;
  var NOT_IDENTIFYING = /^(searchtype|sorttype|studentsearchtype)$/i;

  /* Backstop on the value, not the key. A key-name heuristic only catches what
   * it was told to expect, and it already missed searchString once. Banner IDs
   * and PIDMs are 7-10 digits; term codes are 6 and CRNs 5, so both survive.
   * Base64 of a run of digits is the "xyz" handle by another name. */
  function looksIdentifying(v) {
    if (typeof v !== "string" && typeof v !== "number") return false;
    var t = String(v);
    if (/^\d{7,10}$/.test(t)) return true;
    if (/@/.test(t) && /\./.test(t)) return true;
    if (/^[A-Za-z0-9+/]{6,}={0,2}$/.test(t) && t.length % 4 === 0) {
      try { if (/^\d{5,10}$/.test(atob(t))) return true; } catch (e) {}
    }
    return false;
  }
  var MAX_CALLS = 200;

  var calls = [];
  try { calls = JSON.parse(sessionStorage.getItem(KEY)) || []; } catch (e) {}

  function persist() {
    try { sessionStorage.setItem(KEY, JSON.stringify(calls.slice(-MAX_CALLS))); } catch (e) {}
  }

  /* One short, non-identifying sample. Structure is the point; a value is only
   * here because "string" rarely tells you what a field actually holds. */
  function sample(key, v) {
    if (!NOT_IDENTIFYING.test(key) && (IDENTIFYING.test(key) || looksIdentifying(v))) return typeof v;
    if (v === null) return "null";
    if (typeof v === "string") return v.length > 28 ? '"' + v.slice(0, 28) + '…"' : '"' + v + '"';
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return typeof v;
  }

  /* Collapse a response into a key skeleton. Arrays report their length and
   * describe only the first element — a 30-course schedule and a 1-course one
   * have the same shape, and repeating it 30 times helps nobody. */
  function shape(v, path, out, depth) {
    out = out || []; depth = depth || 0;
    if (depth > 6 || out.length > 160) return out;
    if (Array.isArray(v)) {
      out.push(path + "[] — " + v.length + " item" + (v.length === 1 ? "" : "s"));
      if (v.length) shape(v[0], path + "[0]", out, depth + 1);
      return out;
    }
    if (v && typeof v === "object") {
      Object.keys(v).forEach(function (k) {
        var child = v[k], p = path ? path + "." + k : k;
        if (child && typeof child === "object") shape(child, p, out, depth + 1);
        else out.push("  " + p + " = " + sample(k, child));
      });
      return out;
    }
    out.push("  " + path + " = " + sample(path, v));
    return out;
  }

  // Query parameters: keep the names, redact anything that looks like a person.
  function safeUrl(url) {
    try {
      var u = new URL(url, location.href);
      var parts = [];
      u.searchParams.forEach(function (val, k) {
        parts.push(k + "=" + (IDENTIFYING.test(k) || looksIdentifying(val) ? "<redacted>" : val));
      });
      return u.pathname + (parts.length ? "?" + parts.join("&") : "");
    } catch (e) { return String(url); }
  }

  /* What was SENT, not just what came back. A POST cannot be replayed from its
   * URL alone, and the searches worth automating are POSTs. Form-encoded bodies
   * keep their parameter names with identifying values redacted; JSON bodies go
   * through the same shaping as responses. */
  function requestShape(body) {
    if (!body) return null;
    if (typeof body !== "string") {
      if (body instanceof FormData || (body && body.constructor && body.constructor.name === "FormData")) {
        var fd = [];
        body.forEach(function (v, k) { fd.push("  " + k + " = " + sample(k, v)); });
        return "FormData:\n" + fd.join("\n");
      }
      return "(" + (body && body.constructor ? body.constructor.name : typeof body) + " body)";
    }
    try {
      return "JSON:\n" + shape(JSON.parse(body), "").join("\n");
    } catch (e) {}
    if (body.indexOf("=") > -1) {
      return "form-encoded:\n" + body.split("&").map(function (kv) {
        var i = kv.indexOf("="), k = decodeURIComponent(kv.slice(0, i));
        return "  " + k + " = " + sample(k, decodeURIComponent(kv.slice(i + 1)));
      }).join("\n");
    }
    return "(" + body.length + " bytes)";
  }

  function record(method, url, status, bodyText, reqBody, reqHeaders) {
    // Only the app's own JSON traffic is interesting; assets and templates are noise.
    if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico|html)(\?|$)/i.test(url)) return;
    var entry = {
      method: method, url: safeUrl(url), status: status, shape: null,
      // Header names only. Whether a CSRF token is required is the useful fact;
      // the token itself is a live credential and has no business in a report.
      headers: reqHeaders && reqHeaders.length ? reqHeaders.join(", ") : null,
      request: requestShape(reqBody)
    };
    if (bodyText) {
      try {
        entry.shape = shape(JSON.parse(bodyText), "").join("\n");
      } catch (e) {
        entry.shape = "(not JSON, " + (bodyText.length) + " bytes)";
      }
    }
    calls.push(entry);
    persist();
    render();
  }

  // ---- patch the two transports the app might use --------------------------

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = (init && init.method) || (input && input.method) || "GET";
    var body = init && init.body;
    var hdrs = [];
    try {
      var h = (init && init.headers) || (input && input.headers);
      if (h) {
        if (typeof h.forEach === "function") h.forEach(function (v, k) { hdrs.push(k); });
        else Object.keys(h).forEach(function (k) { hdrs.push(k); });
      }
    } catch (e) {}
    return origFetch.apply(this, arguments).then(function (res) {
      res.clone().text().then(function (t) { record(method, url, res.status, t, body, hdrs); })
        .catch(function () { record(method, url, res.status, null, body, hdrs); });
      return res;
    });
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__spy = { method: method, url: url, headers: [] };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k) {
    if (this.__spy) this.__spy.headers.push(k);
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (payload) {
    var xhr = this;
    if (xhr.__spy) {
      xhr.__spy.body = payload;
      xhr.addEventListener("load", function () {
        var t = null;
        try { t = xhr.responseType === "" || xhr.responseType === "text" ? xhr.responseText : null; }
        catch (e) {}
        record(xhr.__spy.method, xhr.__spy.url, xhr.status, t,
               xhr.__spy.body, xhr.__spy.headers);
      });
    }
    return origSend.apply(this, arguments);
  };

  // ---- panel ---------------------------------------------------------------

  var panel = document.getElementById("__spy_panel");
  if (panel) panel.remove();
  panel = document.createElement("div");
  panel.id = "__spy_panel";
  panel.style.cssText =
    "position:fixed;bottom:14px;right:14px;width:330px;z-index:2147483647;" +
    "background:#1f2430;color:#eceff4;font:12px/1.45 -apple-system,Segoe UI,Arial,sans-serif;" +
    "border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.45);padding:12px 14px";
  document.body.appendChild(panel);

  function render() {
    var uniq = {};
    calls.forEach(function (c) { uniq[c.method + " " + c.url.split("?")[0]] = 1; });
    panel.innerHTML =
      '<div style="font-weight:700;margin-bottom:2px">Banner API recorder</div>' +
      '<div style="color:#9fb4d0;font-size:11px">Recording. Use the page normally &mdash; ' +
      'open an advisee, view a schedule.</div>' +
      '<div style="margin:8px 0;font-size:13px"><b>' + calls.length + '</b> calls, <b>' +
      Object.keys(uniq).length + '</b> distinct endpoints</div>' +
      '<div id="__spy_list" style="max-height:120px;overflow:auto;font:11px/1.4 ui-monospace,Menlo,monospace;' +
      'color:#9fb4d0;background:#161a23;border-radius:5px;padding:5px 7px"></div>' +
      '<div style="display:flex;gap:6px;margin-top:9px">' +
      '<button id="__spy_rep" style="flex:1;padding:6px;border:0;border-radius:6px;cursor:pointer;' +
      'background:#4c8dff;color:#fff;font:inherit;font-weight:600">Report</button>' +
      '<button id="__spy_clr" style="padding:6px 9px;border:1px solid #3b455a;border-radius:6px;cursor:pointer;' +
      'background:transparent;color:#9fb4d0;font:inherit">Clear</button>' +
      '<button id="__spy_x" style="padding:6px 9px;border:1px solid #3b455a;border-radius:6px;cursor:pointer;' +
      'background:transparent;color:#9fb4d0;font:inherit">&times;</button></div>';

    document.getElementById("__spy_list").textContent =
      Object.keys(uniq).join("\n") || "nothing yet";

    document.getElementById("__spy_rep").onclick = report;
    document.getElementById("__spy_clr").onclick = function () {
      calls = []; persist(); render();
    };
    document.getElementById("__spy_x").onclick = function () { panel.remove(); };
  }

  function report() {
    // One entry per distinct endpoint: the same call made five times teaches
    // nothing the first one didn't.
    var seen = {}, out = ["BANNER API RECORDING", "page: " + location.pathname, ""];
    var best = {};
    calls.forEach(function (c) {
      var k = c.method + " " + c.url.split("?")[0];
      if (!best[k] || (!best[k].request && c.request)) best[k] = c;
    });
    Object.keys(best).map(function (k) { return best[k]; }).forEach(function (c) {
      var k = c.method + " " + c.url.split("?")[0];
      if (seen[k]) return;
      seen[k] = 1;
      out.push("=".repeat(66));
      out.push(c.method + " " + c.url + "  -> " + c.status);
      if (c.headers) out.push("request headers: " + c.headers);
      if (c.request) out.push("REQUEST " + c.request);
      out.push("RESPONSE");
      out.push(c.shape || "(no body)");
      out.push("");
    });
    var text = out.join("\n");
    console.log(text);
    navigator.clipboard.writeText(text).then(function () {
      var b = document.getElementById("__spy_rep");
      b.textContent = "Copied to clipboard";
      setTimeout(function () { b.textContent = "Report"; }, 1800);
    }).catch(function () {
      console.log("(clipboard blocked — copy the text logged above)");
    });
  }

  render();
  console.log("%cBanner API recorder active.%c Use the page; press Report when done.",
    "font-weight:bold;font-size:13px", "");
})();
