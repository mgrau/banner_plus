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
