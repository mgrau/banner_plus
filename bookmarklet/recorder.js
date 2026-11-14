/* Banner shape recorder: a development tool, served only by devserve.py.
 *
 * Click its bookmark on a Banner page and it reports to the dev server what
 * that page asks Banner for: each request's path, the names of its query
 * parameters, its status, and the shape of what came back. Field names and
 * types, never values. This is how the next endpoint gets found (an advisor,
 * a hold) without a payload full of student records being pasted anywhere.
 *
 * Requests the page made before the click are read from the browser's
 * resource timing list and asked again, once each, as GET. Requests after the
 * click are caught as they happen. A navigation ends the recording, so click
 * the bookmark again on each page; the badge in the corner says it is on.
 */
(function () {
  var SINK = document.currentScript && document.currentScript.src.replace(/\/[^/]*$/, "/record");
  if (window.__bpRecorder) { window.__bpRecorder.flash(); return; }
  var realFetch = window.fetch;

  // Digit runs long enough to be an ID are masked in paths too.
  function cleanPath(u) {
    var url;
    try { url = new URL(u, location.href); } catch (e) { return { path: String(u), params: [] }; }
    var params = [];
    url.searchParams.forEach(function (v, k) { if (params.indexOf(k) < 0) params.push(k); });
    return { host: url.host, path: url.pathname.replace(/\d{5,}/g, "#"), params: params };
  }

  function shape(v, depth) {
    if (v === null) return "null";
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      if (depth > 8) return "[…]";
      // The union of the first few elements' keys, so one sparse row does
      // not hide a field the others carry.
      var merged = null;
      v.slice(0, 5).forEach(function (x) {
        var s = shape(x, depth + 1);
        if (merged && typeof merged === "object" && typeof s === "object" && !Array.isArray(s))
          Object.keys(s).forEach(function (k) { if (!(k in merged)) merged[k] = s[k]; });
        else if (!merged) merged = s;
      });
      return { "[n]": v.length, "[0]": merged };
    }
    switch (typeof v) {
      case "object":
        if (depth > 8) return "{…}";
        var o = {};
        Object.keys(v).forEach(function (k) { o[k] = shape(v[k], depth + 1); });
        return o;
      case "string": return v === "" ? "str(empty)" : "str";
      case "number": return "num";
      case "boolean": return "bool";
      default: return typeof v;
    }
  }

  // An HTML page is described by its element ids: structure, no text.
  function htmlShape(text) {
    var ids = [], re = /\sid=["']([^"']+)["']/g, m;
    while ((m = re.exec(text)) && ids.length < 300) ids.push(m[1].replace(/\d{5,}/g, "#"));
    return { html: text.length + " chars", ids: ids };
  }

  /* The inside of a few elements, by id, as tags and classes. Text is kept
   * only as its shape: letters become x or X and digits 9, so a label such as
   * "Advisor:" reads "Xxxxxxx:" and a name is just a run of letters. Enough
   * to write a parser against; nothing to read. */
  var OUTLINE_IDS = /advis/i;
  function mask(t) { return t.replace(/[a-z]/g, "x").replace(/[A-Z]/g, "X").replace(/\d/g, "9"); }
  function outline(node, depth) {
    if (node.nodeType === 3) {
      var t = node.textContent.replace(/\s+/g, " ").trim();
      return t ? "text: " + mask(t) : null;
    }
    if (node.nodeType !== 1 || depth > 12) return null;
    var tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return null;
    var o = { tag: tag + (node.id ? "#" + node.id : "") +
                    (node.className && typeof node.className === "string"
                      ? "." + node.className.trim().split(/\s+/).join(".") : "") };
    // Every attribute: the names are structure, the values masked like text,
    // except the bindings, which are template code rather than data.
    Array.prototype.forEach.call(node.attributes, function (a) {
      if (a.name === "id" || a.name === "class") return;
      o["@" + a.name] = /^(data-)?(ng-|bind)/.test(a.name) ? a.value : mask(a.value);
    });
    var kids = [];
    node.childNodes.forEach(function (c) { var k = outline(c, depth + 1); if (k) kids.push(k); });
    if (kids.length) o.in = kids;
    return o;
  }
  function outlines(doc) {
    var out = {};
    doc.querySelectorAll("[id]").forEach(function (n) {
      // A heading's id names its section, so the section is what is outlined.
      if (OUTLINE_IDS.test(n.id))
        out[n.id] = outline(/^H\d$/.test(n.tagName) && n.parentElement ? n.parentElement : n, 0);
    });
    return out;
  }

  function bodyShape(ctype, text) {
    if (/json/i.test(ctype) || /^\s*[\[{]/.test(text)) {
      try { return shape(JSON.parse(text), 0); } catch (e) {}
    }
    if (/html/i.test(ctype)) {
      var h = htmlShape(text);
      try { h.outlines = outlines(new DOMParser().parseFromString(text, "text/html")); } catch (e) {}
      return h;
    }
    return { other: (ctype || "no type") + ", " + text.length + " chars" };
  }

  // ---- the badge ------------------------------------------------------------
  var badge = document.createElement("div");
  badge.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;" +
    "background:#7a1616;color:#fff;font:600 12px -apple-system,Arial,sans-serif;" +
    "padding:6px 10px;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.3)";
  function draw() { badge.textContent = "● Recording request shapes · " + sent; }
  draw();
  document.body.appendChild(badge);
  window.__bpRecorder = { flash: function () {
    badge.style.background = "#2f6bdd";
    setTimeout(function () { badge.style.background = "#7a1616"; }, 400);
  } };

  var sent = 0, seen = {};
  function report(how, method, url, status, ctype, text, reqBody) {
    var p = cleanPath(url);
    if (p.host && p.host !== location.host) return;          // Banner's own calls only
    var key = method + " " + p.path + "?" + p.params.join("&");
    if (seen[key]) return;
    seen[key] = 1;
    var rec = { page: location.pathname.replace(/\d{5,}/g, "#"), how: how, method: method,
                path: p.path, params: p.params, status: status, type: ctype || "",
                shape: bodyShape(ctype || "", text || "") };
    if (reqBody) {
      try { rec.sends = Object.keys(JSON.parse(reqBody)); } catch (e) { rec.sends = "not json"; }
    }
    realFetch.call(window, SINK, { method: "POST", mode: "no-cors", keepalive: true,
                  headers: { "Content-Type": "text/plain" }, body: JSON.stringify(rec) })
      .catch(function () {});
    sent++; draw();
  }

  // ---- after the click: catch them as they happen ---------------------------
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || String(input);
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var reqBody = init && typeof init.body === "string" ? init.body : null;
    return realFetch.apply(this, arguments).then(function (r) {
      if (url.indexOf(SINK) === 0) return r;
      r.clone().text().then(function (t) {
        report("live", method, url, r.status, r.headers.get("content-type"), t, reqBody);
      }, function () {});
      return r;
    });
  };
  var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__bp = { method: String(method).toUpperCase(), url: String(url) };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var x = this, info = x.__bp;
    if (info) x.addEventListener("load", function () {
      var t = "";
      try { t = (x.responseType === "" || x.responseType === "text") ? x.responseText : ""; } catch (e) {}
      report("live", info.method, info.url, x.status, x.getResponseHeader("content-type"), t,
             typeof body === "string" ? body : null);
    });
    return send.apply(this, arguments);
  };

  // ---- before the click: ask again, once each, as GET -----------------------
  report("page", "GET", location.href, 200, "text/html", document.documentElement.outerHTML);
  realFetch.call(window, location.href, { credentials: "same-origin" }).then(function (r) {
    return r.text().then(function (t) {
      seen["GET " + cleanPath(location.href).path + "?" + cleanPath(location.href).params.join("&")] = 0;
      report("page as sent", "GET", location.href, r.status, r.headers.get("content-type"), t);
    });
  }).catch(function () {});
  performance.getEntriesByType("resource").forEach(function (e) {
    if (!/^(fetch|xmlhttprequest)$/.test(e.initiatorType)) return;
    // With the page's own token, as Banner's calls carry it, or most refuse.
    var tok = document.querySelector('meta[name="synchronizerToken"]');
    var headers = tok ? { "X-Synchronizer-Token": tok.content, "X-Requested-With": "XMLHttpRequest" } : {};
    realFetch.call(window, e.name, { credentials: "same-origin", headers: headers }).then(function (r) {
      return r.text().then(function (t) {
        report("replayed", "GET", e.name, r.status, r.headers.get("content-type"), t);
      });
    }).catch(function () {});
  });

})();
