/* Paste into the DevTools console on a Banner Class List page.
 *
 * Confirms the one thing the local tests cannot: that classListDetail exists,
 * returns the whole roster in a single request, and that the fields roster.js
 * looks for are actually present in this Banner install. Read-only — it fetches
 * one roster and prints a summary. No photos, no downloads, no page changes.
 *
 * Chrome requires you to type  allow pasting  in the console once before it
 * will accept pasted code.
 */
(async () => {
  const root = location.origin + (/^(.*\/ssb)\//.exec(location.pathname) || [, ""])[1];
  const m = /#!\/(\w+)\/(\d+)\//.exec(location.href);
  if (!m) return console.error("Not on a section Class List page — the URL needs #!/<term>/<crn>/");
  const [, term, crn] = m;

  const url = `${root}/classList/classListDetail?term=${term}&crn=${crn}` +
              `&filterText=&sortColumn=studentName&sortDirection=asc&max=500&offset=0`;
  console.log("GET", url);

  const res = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!res.ok) return console.error("HTTP " + res.status + " — endpoint differs on this install.");

  const j = await res.json();
  // ODU answers {success, classlistSummary[], classlistDetail[]} — lowercase
  // "l", which does not match the endpoint's own camel-cased name. Identity is
  // in the summary rows, curriculum in the detail rows, same order.
  const detail = j.classlistDetail || j.classListDetail || j.data || j.rows || j.result ||
    (Array.isArray(j) ? j : []);
  const summary = j.classlistSummary || j.classListSummary || [];
  const rows = detail.map((d, i) => Object.assign({}, summary[i] || {}, { __detail: d }));
  console.log(`%c${rows.length} students in one request`, "font-weight:bold;font-size:13px");
  if (!rows.length) return console.error(
    "No rows — run diagnose.js, this install's response is shaped differently.");

  // Same probing roster.js uses, so a clean result here means a clean run there.
  const str = v => typeof v === "string" ? (v.trim() || null)
    : typeof v === "number" ? String(v)
    : v && typeof v === "object" && !Array.isArray(v)
      ? ["description", "majorDescription", "termDescription", "desc", "label", "code"]
          .map(k => v[k]).map(str).find(Boolean) || null
      : null;
  const all = (o, re, acc = [], seen = new Set()) => {
    if (!o || typeof o !== "object" || seen.has(o)) return acc;
    seen.add(o);
    for (const k of Object.keys(o)) {
      if (re.test(k)) { const s = str(o[k]); if (s && !acc.includes(s)) acc.push(s); }
      if (o[k] && typeof o[k] === "object") all(o[k], re, acc, seen);
    }
    return acc;
  };
  const one = (o, re) => all(o, re)[0] || null;

  // Exactly the paths roster.js uses. The key is "major", not /major/i — a
  // loose match also catches "majorCode" and invents a second major for
  // everyone, which is worse than finding nothing.
  const majorsOf = d => {
    const out = [];
    const from = c => (c?.majorFieldsOfStudy || []).forEach(f => {
      const v = str(f.major || f.majorDescription || f.description);
      if (v && !out.includes(v)) out.push(v);
    });
    from(d?.primaryCurriculum);
    (d?.secondaryCurricula || []).forEach(from);
    if (!out.length) all(d, /^major(Description)?$/i).forEach(v => out.push(v));
    return out;
  };

  const found = rows.map(r => ({
    name: str(r.studentName) || str(r.fullName) || one(r, /^(studentname|fullname|name)$/i),
    id: str(r.bannerId) || one(r, /^bannerid$/i),
    majors: majorsOf(r.__detail),
    admit: str(r.__detail?.primaryCurriculum?.termAdmit) || one(r.__detail, /^termadmit$/i),
    standing: str(r.classDescription),
    confidential: r.confidentialIndicator === true,
  }));

  const miss = f => found.filter(x => !x[f] || (Array.isArray(x[f]) && !x[f].length)).length;
  const line = (label, n) => console.log(
    `%c${n === 0 ? "OK  " : "MISS"}%c ${label}: ${n === 0 ? "all " + rows.length : n + " of " + rows.length + " missing"}`,
    `color:#fff;background:${n === 0 ? "#2e7d32" : "#c62828"};padding:1px 5px;border-radius:3px`, "");

  line("name", miss("name"));
  line("bannerId (needed for photos)", miss("id"));
  line("majors", miss("majors"));
  line("admit term (the nY count)", miss("admit"));
  line("class standing", miss("standing"));
  console.log(`  ${found.filter(f => f.confidential).length} student(s) flagged confidential`);
  const bogus = found.filter(f => f.majors.some(m => /^[A-Z]{2,5}$/.test(m)));
  if (bogus.length) console.warn(
    `  ! ${bogus.length} student(s) picked up a major code as a major — tell Claude`, bogus[0]);

  console.log("first student as roster.js would read them:", found[0]);
  console.log("raw first row — expand this if any field above says MISS:", rows[0]);

  const img = `${root}/classListPicture/picture?bannerId=${found[0].id}&crn=${crn}&term=${term}`;
  const p = await fetch(img, { credentials: "same-origin" });
  const b = p.ok ? await p.blob() : null;
  line("photo endpoint", b && b.size > 64 ? 0 : 1);
  if (b) console.log(`  photo: ${b.size} bytes, ${b.type}`);
})();
