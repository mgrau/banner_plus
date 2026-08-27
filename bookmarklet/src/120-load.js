/* ---- Putting students on screen -------------------------------------------
 *
 * Opening a section or a group ends here, in setStudents(). Both arrive with
 * different amounts already known — a roster row carries its curriculum, a
 * pasted UIN carries a name and nothing else — so this is where the gaps get
 * filled and the photos stream in.
 *
 * Fetching stays lazy on purpose. A roster is students and photographs;
 * registration history is fetched per student when you open one, or for a
 * selection when you ask for scheduling. Pulling eighty histories to show one
 * face would be slow for no reason and rude to a shared service.
 */

function printPhotoRoster() {
  var group = selectedStudents();
  taskBegin("Laying out roster…");
  var html = photoRosterDoc(group, S.source.label, curLabel(), printCols);
  // Open first, then count. The page count is a courtesy in the status line
  // and should not stand between the click and the print dialog.
  openDoc(html, true);
  pageCount(html, function (pages) {
    idle(group.length + " students · " + printCols + " per row · " +
         pages + " page" + (pages === 1 ? "" : "s"));
  });
}

function setStudents(list, label, source, emptyMessage) {
  photoDiag = { tried: 0, ok: 0, noId: 0, lastURL: null, lastStatus: null, lastType: null };
  S.students = list; S.sel = {}; S.focus = null; S.source = source;
  S.source.label = label;
  setRightOpen(false);
  renderSide(); renderMain();

  /* Nobody to fetch anything for. Said here rather than by the caller: the
   * photo pass below ends in idle("0 students"), which would land after the
   * caller's own message and quietly replace it with a worse one. */
  if (!list.length) {
    idle(emptyMessage || "nobody in " + label);
    return;
  }

  // Students are in hand; photos are the long tail, so they own most of the bar.
  taskPhase("Photos… 0/" + list.length, 0.15, 1);
  // Photos stream in; the grid is usable before they land. Students who
  // arrived without curriculum — anyone from a pasted group — get it here,
  // now that their registration has supplied a CRN to ask with.
  var needCur = list.filter(function (s) {
    return !s.majors || !s.majors.length || s.majors[0] === "—";
  });
  if (needCur.length) {
    // Contact card first: it needs only a bannerId, so it answers for a
    // student who is in none of your sections. Curriculum adds college and
    // admit term on top, but only where a CRN exists to ask with.
    pool(needCur, CONCURRENCY, function (s) {
      return fetchContactCard(s, s.term || curTerm()).then(function () {
        if (s.crn && !s.admit) return fetchCurriculum(s, s.term || curTerm());
      });
    }).then(function () { renderMain(); });
  }

  pool(list, CONCURRENCY, function (s) {
    return fetchPhoto(s).then(function (uri) {
      s.photo = uri;
      if (uri && s._img) s._img.src = uri;
    });
  }, function (d, t) { prog("Photos… " + d + "/" + t, d, t); })
    .then(function () {
      var msg = list.length + " students";
      if (photoDiag.tried && !photoDiag.ok) {
        msg += " · no photos (HTTP " + photoDiag.lastStatus + ", " +
               (photoDiag.lastType || "no content-type") + ")";
        console.warn("[console] photos failed. Last URL:", photoDiag.lastURL,
                     "status", photoDiag.lastStatus, "type", photoDiag.lastType);
      } else if (photoDiag.ok < photoDiag.tried) {
        msg += " · " + photoDiag.ok + "/" + photoDiag.tried + " photos";
      }
      if (photoDiag.noId)
        msg += " · " + photoDiag.noId + " with no ID";
      idle(msg);
    });
}

function openSection(sec) {
  taskBegin("Loading roster…");
  S.activeTerm = sec.term || S.term;
  S.activeLabel = sec.termLabel || S.termLabel;
  fetchRoster(S.activeTerm, sec.crn).then(function (list) {
    setStudents(list, sec.label || ("CRN " + sec.crn), { kind: "section", crn: sec.crn });
  }).catch(function (e) {
    idle("Roster failed: " + (e.message || e));
  });
}

function openGroup(grp) {
  // A group is not tied to a term, so under "All terms" it needs a concrete
  // one to resolve against; the newest standard term is the useful default.
  if (S.term === ALL_TERMS_CODE) {
    var t = newestStandard();
    S.activeTerm = t ? t.code : null;
    S.activeLabel = t ? t.description : "";
  } else {
    S.activeTerm = S.term; S.activeLabel = S.termLabel;
  }
  var uinList = groupUins(grp);
  if (!uinList.length) {
    // Select it anyway: an empty group still needs to be the highlighted drop
    // target, or there is nowhere to drag the first student to.
    setStudents([], grp.name, { kind: "group", name: grp.name },
                grp.name + " is empty");
    return;
  }
  taskBegin("Resolving " + uinList.length + " UIN" + (uinList.length === 1 ? "" : "s") + "…");
  // Resolving UINs is the first half of building a group; photos follow.
  taskPhase(null, 0, 0.5);
  pool(uinList, CONCURRENCY, function (u) {
    return lookupByUIN(u, curTerm()).catch(function (e) {
      console.warn("[console] " + u + ": " + e.message);
      return null;
    });
  }, function (d, t) { prog("Resolving… " + d + "/" + t, d, t); })
    .then(function (r) {
      var list = r.filter(Boolean);
      if (!list.length) { idle("No students resolved."); return; }
      // Remember the names we just learned, so editing shows people not numbers.
      var byUin = {};
      list.forEach(function (x) { if (x.uin) byUin[x.uin] = x.name; });
      var changed = false;
      (grp.students || []).forEach(function (m) {
        if (byUin[m.uin] && m.name !== byUin[m.uin]) { m.name = byUin[m.uin]; changed = true; }
      });
      if (changed) saveGroups(S.groups);
      // A search result has no CRN, and both the photo and the curriculum call
      // need one. Their own registration supplies it, so fetch history first
      // — which the schedule and scheduling views want anyway.
      taskPhase("Loading records… 0/" + list.length, 0.35, 0.6);
      return hydrate(list, curTerm(), function (d, t) {
        prog("Loading records… " + d + "/" + t, d, t);
      }).then(function () {
        list.forEach(function (s) {
          var c = (s.history || []).filter(function (x) {
            return x.termCode === curTerm() && x.crn;
          })[0];
          if (c) s.crn = c.crn;
        });
        var known = list.filter(function (s) { return s.crn; }).length;
        if (DEBUG) console.log("[console] group: " + known + "/" + list.length + " have a CRN this term");
        setStudents(list, grp.name, { kind: "group", name: grp.name });
      });
    });
}
