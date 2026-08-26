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
