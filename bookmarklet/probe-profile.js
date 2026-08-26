/* What does the student profile call to get a GPA?
 *
 * Paste into the DevTools console on a studentssb studentProfile page that has
 * finished loading and is showing a GPA. Read-only.
 *
 * WHY NOT spy.js HERE
 *
 * The recorder has to be installed before the calls it wants to see. The profile
 * is a single-page app that fetches everything during load, so by the time you
 * can paste anything it is already done, and there is no reload that keeps the
 * patches. But the browser remembers: performance.getEntriesByType("resource")
 * lists every URL the page requested, whether or not anyone was watching.
 *
 * So this reads that list, then replays each candidate with the headers Banner's
 * own AJAX sends — X-Requested-With and the synchronizer token, whose absence is
 * what made the first attempt at this come back empty — and reports which one
 * carries a GPA.
 *
 * Values are redacted; the URL and the field path are the findings.
 */
(async () => {
  const out = [];
  const say = (l) => out.push(l);

  function token() {
    for (const sel of ['meta[name="synchronizerToken"]', 'input[name="synchronizerToken"]',
                       'meta[name="_csrf"]', 'meta[name="csrf-token"]']) {
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
  const tok = token();

  const ID = (new URLSearchParams(location.search)).get("studentId");
  say("PROFILE PROBE");
  say("host:  " + location.origin);
  say("path:  " + location.pathname);
  say("token: " + (tok ? "found" : "NOT FOUND"));
  say("");

  // Does the rendered page show one at all? Confirms we are on the right screen.
  const GPA_RE = /(?:overall|cumulative|institution(?:al)?|total)?\s*g\.?p\.?a\.?[^0-9]{0,40}([0-4](?:\.\d{1,3})?)\b/i;
  const JSON_RE = /"[a-z_]*gpa[a-z_]*"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i;
  /* A JSON field named *gpa* is a value; "GPA</h3>" in a template is a heading.
   * Reporting the first of either named renderCurriculumTemplate as the answer
   * when the real one was viewGPAHoursList, so the two are ranked. */
  const findGpa = (t) => {
    const j = JSON_RE.exec(t);
    if (j) return { kind: "json", text: j[0].slice(0, 60) };
    const m = GPA_RE.exec(t);
    return m ? { kind: "text", text: m[0].slice(0, 60) } : null;
  };
  say("GPA visible in this page's text: " + (findGpa(document.body.innerText || "") ? "yes" : "no"));
  say("");

  function redact(u) {
    try {
      const url = new URL(u, location.href);
      const parts = [];
      url.searchParams.forEach((v, k) =>
        parts.push(k + "=" + (/id|pidm|uin|name|term/i.test(k) && !/term/i.test(k) ? "<redacted>" : v)));
      return url.pathname + (parts.length ? "?" + parts.join("&") : "");
    } catch (e) { return String(u); }
  }

  const urls = performance.getEntriesByType("resource")
    .map((e) => e.name)
    .filter((n) => n.indexOf(location.origin) === 0)
    .filter((n) => !/\.(js|css|png|jpe?g|gif|svg|woff2?|ico|map)(\?|$)/i.test(n));
  const uniq = [];
  urls.forEach((u) => { if (uniq.indexOf(u) < 0) uniq.push(u); });

  say(uniq.length + " non-asset requests this page made:");
  uniq.forEach((u) => say("  " + redact(u)));
  say("");

  const H = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };
  if (tok) H["X-Synchronizer-Token"] = tok;

  say("replayed with Banner's own headers:");
  let hit = null;
  for (const u of uniq) {
    try {
      const r = await fetch(u, { credentials: "same-origin", headers: H });
      const body = await r.text();
      const g = findGpa(body);
      say("  " + String(r.status).padEnd(4) + (g ? (g.kind === "json" ? "JSON " : "text ") : "     ") +
          redact(u) + (g ? "   <- " + g.text.replace(/[0-9]+(\.[0-9]+)?/g, "#") : ""));
      if (g && (!hit || (hit.kind !== "json" && g.kind === "json"))) hit = { url: u, kind: g.kind };
    } catch (e) {
      say("  ERR  " + redact(u));
    }
  }
  say("");
  say(hit ? "GPA endpoint: " + redact(hit.url) + "  (" + hit.kind + ")"
          : "No replayed request carried a GPA. It may be a POST, which this does not replay.");

  const text = out.join("\n");
  console.log(text);
  try {
    await navigator.clipboard.writeText(text);
    console.log("%c^ copied to clipboard — paste it back", "font-weight:bold;font-size:13px");
  } catch (e) {
    console.log("%c^ select the block above and copy it", "font-weight:bold;font-size:13px");
  }
})();
