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
