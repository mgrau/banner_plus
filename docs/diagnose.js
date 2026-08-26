/* Paste into the DevTools console on a Banner Class List page.
 *
 * Run this when probe.js says "No rows". It reports what the server actually
 * sent instead of assuming a shape: the parameters it used, the response
 * envelope, every array anywhere in the payload and where it lives, and a few
 * parameter variations in case this install names paging differently or caps
 * the page size. Read-only.
 *
 * Chrome requires you to type  allow pasting  in the console once first.
 */
(async () => {
  const root = location.origin + (/^(.*\/ssb)\//.exec(location.pathname) || [, ""])[1];
  const m = /#!\/(\w+)\/(\d+)\//.exec(location.href);
  if (!m) return console.error("Not on a section Class List page — URL needs #!/<term>/<crn>/");
  const [, term, crn] = m;
  console.log("%cservice root:%c " + root, "font-weight:bold", "");
  console.log("%cterm:%c " + term + "   %ccrn:%c " + crn,
    "font-weight:bold", "", "font-weight:bold", "");

  /* Every array in the payload, with its path — the roster is whichever one is
   * long enough to be students, whatever the envelope decided to call it. */
  function arrays(o, path = "", out = [], seen = new Set()) {
    if (!o || typeof o !== "object" || seen.has(o)) return out;
    seen.add(o);
    if (Array.isArray(o)) out.push({ path: path || "(root)", len: o.length, sample: o[0] });
    for (const k of Object.keys(o)) arrays(o[k], path ? path + "." + k : k, out, seen);
    return out;
  }

  const base = `term=${term}&crn=${crn}&filterText=&sortColumn=studentName&sortDirection=asc`;
  const variants = [
    ["as roster.js asks", `${base}&max=500&offset=0`],
    ["smaller page", `${base}&max=25&offset=0`],
    ["1-based offset", `${base}&max=25&offset=1`],
    ["pageMaxSize naming", `${base}&pageMaxSize=25&pageOffset=0`],
    ["no paging params", base],
  ];

  for (const [label, qs] of variants) {
    const url = `${root}/classList/classListDetail?${qs}`;
    let res, text;
    try {
      res = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
      text = await res.text();
    } catch (e) {
      console.log(`%c${label}%c — request failed: ${e.message}`,
        "background:#c62828;color:#fff;padding:1px 5px;border-radius:3px", "");
      continue;
    }

    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* not JSON — reported below */ }

    const found = j ? arrays(j).filter(a => a.len > 0) : [];
    const best = found.sort((a, b) => b.len - a.len)[0];
    const ok = best && best.len > 1;
    console.log(`%c${label}%c  HTTP ${res.status}  ${text.length} bytes` +
      (j ? `  keys: [${Object.keys(j).join(", ")}]` : "  (not JSON)"),
      `background:${ok ? "#2e7d32" : "#c62828"};color:#fff;padding:1px 5px;border-radius:3px`, "");

    if (!j) { console.log("   first 300 chars:", text.slice(0, 300)); continue; }
    // A login redirect or an error envelope usually says so right here.
    for (const k of ["success", "message", "error", "errorMessage", "failure", "totalCount", "recordsTotal"])
      if (j[k] !== undefined) console.log(`   ${k}:`, j[k]);
    if (!found.length) { console.log("   no non-empty arrays anywhere. Full payload:", j); continue; }
    for (const a of found) console.log(`   array at "${a.path}" — ${a.len} item(s)`);
    if (best) console.log(`   sample from "${best.path}":`, best.sample);
  }

  // If classListDetail is a dead end, the summary endpoint feeds the same grid
  // and at minimum tells us whether the section is genuinely empty.
  const sum = `${root}/classList/classListSummary?${base}&max=25&offset=0`;
  try {
    const r = await fetch(sum, { credentials: "same-origin", headers: { Accept: "application/json" } });
    const j = await r.json();
    const found = arrays(j).filter(a => a.len > 0).sort((a, b) => b.len - a.len);
    console.log(`%cclassListSummary%c  HTTP ${r.status}  keys: [${Object.keys(j).join(", ")}]`,
      `background:${found.length ? "#2e7d32" : "#c62828"};color:#fff;padding:1px 5px;border-radius:3px`, "");
    if (found.length) {
      console.log(`   array at "${found[0].path}" — ${found[0].len} item(s)`);
      console.log("   sample:", found[0].sample);
    } else {
      console.log("   full payload:", j);
    }
  } catch (e) {
    console.log("classListSummary failed:", e.message);
  }

  // ---- phase 2: what is actually inside a row -------------------------------
  // Knowing where the roster lives is only half of it; the field names inside
  // decide whether names, majors and admit terms come out. Dump every leaf path
  // of one row so there is nothing left to guess.
  console.log("%c\nROW STRUCTURE", "font-weight:bold;font-size:13px");
  const r0 = await fetch(`${root}/classList/classListDetail?${base}&max=2&offset=0`,
    { credentials: "same-origin", headers: { Accept: "application/json" } }).then(r => r.json());

  const rows = r0.classlistDetail || r0.classListDetail || r0.data || r0.result || [];
  const summ = r0.classlistSummary || r0.classListSummary || [];
  if (!rows.length && !summ.length) return console.error("Phase 2: still no rows.");

  function leaves(o, path = "", out = [], seen = new Set()) {
    if (o === null || o === undefined || o === "") return out;
    if (typeof o !== "object") {
      const v = String(o);
      if (v && v !== "false" && v !== "null")
        out.push([path, v.length > 60 ? v.slice(0, 60) + "…" : v]);
      return out;
    }
    if (seen.has(o)) return out;
    seen.add(o);
    if (Array.isArray(o)) o.forEach((v, i) => leaves(v, `${path}[${i}]`, out, seen));
    else for (const k of Object.keys(o)) leaves(o[k], path ? `${path}.${k}` : k, out, seen);
    return out;
  }

  const show = (label, obj) => {
    if (!obj) return;
    const ls = leaves(obj);
    console.log(`%c${label}%c — ${ls.length} non-empty fields`,
      "background:#1565c0;color:#fff;padding:1px 5px;border-radius:3px", "");
    console.log(ls.map(([p, v]) => `  ${p} = ${v}`).join("\n"));
  };

  show("classlistDetail[0]", rows[0]);
  show("classlistSummary[0]", summ[0]);

  // The four things roster.js needs, wherever they turned out to live.
  const merged = Object.assign({}, summ[0] || {}, rows[0] || {});
  const hits = re => leaves(merged).filter(([p]) => re.test(p));
  const report = (what, re) => {
    const h = hits(re);
    console.log(`%c${h.length ? "FOUND" : "NONE "}%c ${what}: ` +
      (h.length ? h.map(([p, v]) => `${p} = ${v}`).join("  |  ") : "nothing matched"),
      `color:#fff;background:${h.length ? "#2e7d32" : "#c62828"};padding:1px 5px;border-radius:3px`, "");
  };
  console.log("%c\nWHAT roster.js LOOKS FOR", "font-weight:bold;font-size:13px");
  report("name", /name/i);
  report("major", /major/i);
  report("admit term", /admit/i);
  report("class standing", /classDescription|studentClass/i);

  console.log("%c\nCopy this whole output back. Only the field PATHS matter — " +
    "feel free to x-out the student's name and ID.", "font-weight:bold;font-size:13px");
})();
