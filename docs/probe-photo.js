/* How does the faculty host serve a student photo without a CRN?
 *
 * FIRST: hover the "Information for <name>" link so the picture actually loads.
 * THEN paste this into the DevTools console on that page. Read-only.
 *
 * WHY IT MATTERS
 *
 * The console fetches photos from
 *
 *   classListPicture/picture?bannerId=…&crn=…&term=…
 *
 * which is keyed by section. That is fine for a roster and useless for anyone
 * else: a pasted group of research students has no CRN in common with you, so
 * those faces come back blank. Registration Overrides shows a photo while being
 * keyed by a base64 PIDM and no CRN at all, so a CRN-free route exists.
 *
 * This reads what the page has already requested — the browser keeps that list
 * whether or not a recorder was installed — picks out the image request, and
 * then tries the plausible CRN-free variants so we learn not just what this page
 * uses but what else answers.
 *
 * Identifiers are redacted; the URL shape and parameter names are the findings.
 */
(async () => {
  const out = [];
  const say = (l) => out.push(l);
  say("PHOTO PROBE");
  say("host: " + location.origin);
  say("path: " + location.pathname);

  // The hash carries a base64 handle on this page, the same shape as "xyz".
  const b64 = (/#!\/[^/]*\/[^/]*\/([A-Za-z0-9+/=]{6,})/.exec(location.href) ||
               /#!\/[^/]*\/([A-Za-z0-9+/=]{8,}={0,2})/.exec(location.href) || [])[1];
  let pidm = null;
  if (b64) {
    try {
      const dec = atob(b64);
      if (/^\d+$/.test(dec)) { pidm = dec; say("hash handle decodes to a PIDM (" + dec.length + " digits)"); }
    } catch (e) {}
  }
  if (!pidm) say("no base64 PIDM in the URL — open a specific student first");
  say("");

  function redact(u) {
    try {
      const url = new URL(u, location.href);
      const parts = [];
      url.searchParams.forEach((v, k) =>
        parts.push(k + "=" + (/term/i.test(k) ? v : "<value>")));
      return url.pathname + (parts.length ? "?" + parts.join("&") : "");
    } catch (e) { return String(u); }
  }

  // ---- what did this page already ask for? --------------------------------
  const res = performance.getEntriesByType("resource")
    .filter((e) => e.name.indexOf(location.origin) === 0);
  const pics = res.filter((e) => /picture|photo|image/i.test(e.name) ||
                                 e.initiatorType === "img");
  say(res.length + " same-origin requests, " + pics.length + " image-ish:");
  pics.forEach((e) => say("  " + redact(e.name) + "   [" + e.initiatorType + ", " +
    (e.transferSize || 0) + " bytes]"));
  if (!pics.length) {
    say("  none — hover the \"Information for …\" link first, then run this again");
  }
  say("");

  // Everything else, in case the photo arrives inside a JSON card payload.
  say("other requests this page made:");
  res.filter((e) => pics.indexOf(e) < 0)
     .filter((e) => !/\.(js|css|woff2?|map)(\?|$)/i.test(e.name))
     .forEach((e) => say("  " + redact(e.name)));
  say("");

  // ---- which CRN-free variants answer? ------------------------------------
  const tok = (document.querySelector('meta[name="synchronizerToken"]') || {}).content ||
              (document.querySelector('input[name="synchronizerToken"]') || {}).value || null;
  const H = { "X-Requested-With": "XMLHttpRequest" };
  if (tok) H["X-Synchronizer-Token"] = tok;

  const term = (/#!\/[^/]*\/(\d{6})\//.exec(location.href) || [])[1] || "";
  const keyed = [];
  if (pidm) keyed.push(["pidm", pidm], ["bannerId", pidm]);
  if (b64) keyed.push(["xyz", b64]);

  const paths = [
    "/FacultySelfService/ssb/studentPicture/picture",
    "/FacultySelfService/ssb/classListPicture/picture",
    "/FacultySelfService/ssb/registrationOverrides/picture",
    "/FacultySelfService/ssb/studentCard/picture",
    "/FacultySelfService/studentPicture/picture"
  ];

  say("CRN-free photo candidates:");
  let best = null;
  for (const p of paths) {
    for (const [k, v] of keyed) {
      const u = location.origin + p + "?" + k + "=" + encodeURIComponent(v) +
                (term ? "&term=" + term : "");
      try {
        const r = await fetch(u, { credentials: "same-origin", headers: H });
        const ct = r.headers.get("content-type") || "";
        let size = 0;
        if (r.ok) { const b = await r.blob(); size = b.size; }
        const isImg = r.ok && ct.indexOf("image") === 0 && size > 500;
        say("  " + String(r.status).padEnd(4) + (isImg ? "IMAGE " : "      ") +
            p.replace("/FacultySelfService", "") + "?" + k + "=…" +
            "   [" + ct + (size ? ", " + size + " bytes" : "") + "]");
        if (isImg && !best) best = p + "?" + k;
      } catch (e) {
        say("  ERR   " + p.replace("/FacultySelfService", "") + "?" + k + "=…");
      }
    }
  }
  say("");
  say(best ? "works without a CRN: " + best
           : "none of the guesses answered with an image — the list above is what matters");

  const text = out.join("\n");
  console.log(text);
  try {
    await navigator.clipboard.writeText(text);
    console.log("%c^ copied to clipboard — paste it back", "font-weight:bold;font-size:13px");
  } catch (e) {
    console.log("%c^ select the block above and copy it", "font-weight:bold;font-size:13px");
  }
})();
