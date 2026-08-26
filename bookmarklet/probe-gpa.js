/* Is an official GPA already in something Banner hands us?
 *
 * Paste into the DevTools console on a Banner Class List page for a section you
 * teach. Read-only. It calls the endpoints the console already uses, plus a few
 * plausible neighbours, and reports any field that looks like a grade-point or
 * credit-hour total — anywhere in the payload, at any depth.
 *
 * The console currently computes a GPA from the letter grades in the
 * registration history. That works, but it is unofficial by construction: it
 * cannot see repeats, forgiveness, transfer credit, or any local rule about
 * what counts. A number Banner itself reports would be better.
 *
 * Two outcomes are useful. If a known endpoint already carries it, the console
 * gets an official GPA for free. If nothing does, that is worth knowing too —
 * the student profile that shows GPA lives on studentssb-prod, a different
 * origin, which a bookmarklet on the faculty host cannot read.
 *
 * Field PATHS are what matter here, not values. GPA is redacted to its type
 * below for the same reason the recorder redacts it.
 *
 * Chrome requires you to type  allow pasting  in the console once first.
 */
(async () => {
  const base = location.origin + "/FacultySelfService";
  const out = [];
  const say = (l) => out.push(l);

  function token() {
    for (const sel of ['meta[name="synchronizerToken"]', 'input[name="synchronizerToken"]',
                       'meta[name="_csrf"]']) {
      const n = document.querySelector(sel);
      if (n && (n.content || n.value)) return n.content || n.value;
    }
    return null;
  }
  const tok = token();
  const H = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };
  if (tok) H["X-Synchronizer-Token"] = tok;

  const m = /#!\/(\w+)\/(\d+)\//.exec(location.href);
  if (!m) return console.error("Open a Class List for one of your sections first.");
  const [, term, crn] = m;
  say("GPA PROBE");
  say("term " + term + "  crn " + crn);

  // A real student from this section: the calls below are keyed by bannerId.
  let bannerId = null, pidm = null;
  try {
    const j = await fetch(base + "/ssb/classList/classListDetail?term=" + term + "&crn=" + crn +
      "&filterText=&sortColumn=studentName&sortDirection=asc&max=1&offset=0",
      { credentials: "same-origin", headers: H }).then(r => r.json());
    const sum = (j.classlistSummary || j.classListSummary || [])[0] || {};
    const det = (j.classlistDetail || j.classListDetail || [])[0] || {};
    bannerId = sum.bannerId;
    pidm = det.pidm || sum.studentPidm;
  } catch (e) {}
  if (!bannerId) return console.error("Could not read a student from this roster.");
  say("using one student from this roster");
  say("");

  // Anything that smells like a grade-point or credit-hour total.
  const WANTED = /gpa|gradepoint|qualitypoint|earnedhour|attempthour|passedhour|creditshour|standing|academic/i;
  const IDENTIFYING = /name|^id$|bannerid|pidm|email|phone|address|birth|ssn/i;

  function scan(v, path, hits, seen) {
    hits = hits || []; seen = seen || new Set();
    if (!v || typeof v !== "object" || seen.has(v)) return hits;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach((x, i) => scan(x, path + "[" + i + "]", hits, seen)); return hits; }
    for (const k of Object.keys(v)) {
      const p = path ? path + "." + k : k;
      const val = v[k];
      if (WANTED.test(k) && (val === null || typeof val !== "object")) {
        // Values redacted: the path is the finding, the number is the student's.
        hits.push("    " + p + " = " + (val === null ? "null" :
          (IDENTIFYING.test(k) ? typeof val : (typeof val === "number" ? "<number>" : JSON.stringify(String(val).slice(0, 24))))));
      }
      if (val && typeof val === "object") scan(val, p, hits, seen);
    }
    return hits;
  }

  const targets = [
    ["ssb/studentDetails/curriculum", "term=" + term + "&crn=" + crn + "&bannerId=" + bannerId],
    ["ssb/classListStudentCard/retrieveData", "bannerId=" + bannerId + "&termCode=" + term + "&crn=" + crn],
    ["ssb/classList/classListDetail", "term=" + term + "&crn=" + crn +
      "&filterText=&sortColumn=studentName&sortDirection=asc&max=1&offset=0"],
    // Plausible neighbours of the ones above; a 404 here is a clean answer.
    ["ssb/studentDetails/studentInformation", "term=" + term + "&crn=" + crn + "&bannerId=" + bannerId],
    ["ssb/studentDetails/gpa", "term=" + term + "&bannerId=" + bannerId],
    ["ssb/studentDetails/academicStanding", "term=" + term + "&bannerId=" + bannerId],
    ["ssb/studentPagesCommonSearch/studentInformation", "term=" + term + "&bannerId=" + bannerId]
  ];

  for (const [path, qs] of targets) {
    try {
      const r = await fetch(base + "/" + path + "?" + qs, { credentials: "same-origin", headers: H });
      if (!r.ok) { say("  " + r.status + "  " + path); continue; }
      const body = await r.text();
      let j = null;
      try { j = JSON.parse(body); } catch (e) { say("  200  " + path + "  (not JSON)"); continue; }
      const hits = scan(j, "");
      say("  200  " + path + (hits.length ? "" : "   — nothing GPA-shaped"));
      hits.forEach(h => say(h));
    } catch (e) { say("  ERR  " + path + " — " + e.message); }
  }

  say("");
  say("If nothing above carries a GPA, the number lives on the student profile at");
  say("studentssb-prod, which is a different origin and unreachable from here.");

  const text = out.join("\n");
  console.log(text);
  try {
    await navigator.clipboard.writeText(text);
    console.log("%c^ copied to clipboard — paste it back", "font-weight:bold;font-size:13px");
  } catch (e) {
    console.log("%c^ select the block above and copy it", "font-weight:bold;font-size:13px");
  }
})();
