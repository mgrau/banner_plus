/* Why does courseList/courseList answer 401?
 *
 * Paste into the DevTools console on a Banner Faculty Self-Service page. It
 * tries the endpoint under both path prefixes with four header combinations and
 * prints what each returns. Read-only.
 *
 * The point is to separate two explanations that look identical from the
 * outside:
 *
 *   - the request is missing a header Banner's own AJAX sends
 *     (X-Requested-With, X-Synchronizer-Token) -> one combination returns 200
 *
 *   - the endpoint does not exist on this install, and Banner's security
 *     filter answers 401 rather than 404 for unmapped URLs
 *     -> every combination returns 401
 *
 * The second is plausible: the endpoint name came from a saved copy of the app's
 * JavaScript, and a recording of the live course-list page never showed
 * courseList/courseList being called at all.
 *
 * Chrome requires you to type  allow pasting  in the console once first.
 *
 * Output is one plain-text block, copied to the clipboard and printed. Styled
 * console lines are unpleasant to select and paste, and a report nobody can copy
 * is a report that does not exist.
 */
(async () => {
  const base = location.origin + "/FacultySelfService";

  function findToken() {
    const sels = ['meta[name="synchronizerToken"]', 'meta[name="_csrf"]',
                  'meta[name="csrf-token"]', 'input[name="synchronizerToken"]'];
    for (const sel of sels) {
      const n = document.querySelector(sel);
      if (n && (n.content || n.value)) return n.content || n.value;
    }
    for (const k in window) {
      try {
        if (/synchronizer|csrf/i.test(k) && typeof window[k] === "string" && window[k].length > 8)
          return window[k];
      } catch (e) {}
    }
    return null;
  }

  const out = [];
  const say = (line) => out.push(line);

  const tok = findToken();
  say("COURSELIST PROBE");
  say("page:  " + location.pathname + location.hash);
  say("token: " + (tok ? "found" : "NOT FOUND"));

  // Whatever term the page is on, else anything the term list offers.
  let term = (/#!\/(\d{6})\//.exec(location.href) || [])[1];
  if (!term) {
    try {
      const t = await fetch(base + "/ssb/studentPagesCommonSearch/fetchTerms",
        { credentials: "same-origin", headers: { Accept: "application/json" } }).then(r => r.json());
      term = (t && t[0] && t[0].code) || "202610";
    } catch (e) { term = "202610"; }
  }
  say("term:  " + term);
  say("");

  const qs = "term=" + term + "&filterText=&sortColumn=&sortDirection=asc&max=200&offset=0";
  const combos = [
    ["bare", { Accept: "application/json" }],
    ["+X-Requested-With", { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }],
    ["+token", tok ? { Accept: "application/json", "X-Synchronizer-Token": tok } : null],
    ["+both", tok ? { Accept: "application/json", "X-Requested-With": "XMLHttpRequest",
                      "X-Synchronizer-Token": tok } : null]
  ];

  async function attempt(label, prefix, headers) {
    if (!headers) { say("  skip  " + prefix + " " + label + " (no token)"); return; }
    const url = base + prefix + "courseList/courseList?" + qs;
    try {
      const r = await fetch(url, { credentials: "same-origin", headers });
      const body = await r.text();
      say("  " + String(r.status).padEnd(4) + prefix.padEnd(6) + label.padEnd(20) +
          "[" + (r.headers.get("content-type") || "?") + "] " +
          body.slice(0, 100).replace(/\s+/g, " "));
    } catch (e) {
      say("  ERR   " + prefix + " " + label + " — " + e.message);
    }
  }

  say("courseList/courseList — status, prefix, headers, content-type, body");
  for (const prefix of ["/ssb/", "/"]) {
    for (const [label, headers] of combos) await attempt(label, prefix, headers);
  }
  say("");

  /* If every combination fails, the name is the suspect, not the headers. These
   * are the plausible alternatives — a hit here says what to call instead. */
  say("other names for the same thing");
  const alts = ["courseList/courseListSummary", "courseList/getCourseList",
                "classListApp/courses", "classListApp/courseList",
                "courseList/courses", "facultyCourses/courseList"];
  for (const alt of alts) {
    const url = base + "/ssb/" + alt + "?" + qs;
    try {
      const r = await fetch(url, { credentials: "same-origin",
        headers: tok ? { Accept: "application/json", "X-Requested-With": "XMLHttpRequest",
                         "X-Synchronizer-Token": tok } : { Accept: "application/json" } });
      const body = await r.text();
      say("  " + String(r.status).padEnd(4) + "/ssb/" + alt +
          (r.status === 200 ? "   " + body.slice(0, 200).replace(/\s+/g, " ") : ""));
    } catch (e) { say("  ERR   /ssb/" + alt); }
  }

  const text = out.join("\n");
  console.log(text);
  try {
    await navigator.clipboard.writeText(text);
    console.log("%c^ copied to clipboard — paste it back", "font-weight:bold;font-size:13px");
  } catch (e) {
    console.log("%c^ select the block above and copy it", "font-weight:bold;font-size:13px");
  }
})();
