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
    // Distinguish "you teach nothing" from "the call failed" — they looked
    // identical, and only one of them is a bug.
    idle(shown.length
      ? shown.length + " class" + (shown.length === 1 ? "" : "es") +
        (hidden ? " · " + hidden + " empty hidden" : "")
      : (/^request failed/.test(sectionDiag.keys || "")
          ? "couldn't load classes — " + sectionDiag.keys
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
