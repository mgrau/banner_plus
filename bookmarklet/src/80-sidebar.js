/* ---- The sidebar and the group editor -------------------------------------
 *
 * Your sections for the selected term, then your groups. A group in this list
 * is also a drop target: select students in the roster and drag them here to
 * add them.
 *
 * Four ways to build a group, because people arrive holding different things:
 *
 *   drag      students from a roster onto a group, or onto "New group" when
 *             there is not a group yet
 *   selection whoever is ticked in the roster, straight from this pane
 *   classes   tick two or more classes and combine their rosters
 *   by hand   search by name, or paste UINs
 *
 * The first three all end in the same editor as the last, prefilled. Building
 * a group is not the same as being sure of it, and the list is where you check.
 *
 * The editor is a membership list, because that is what a group is. It
 * replaced a textarea of bare UINs, which was fine for creating a group in one
 * go and useless for checking one — a column of eight-digit numbers cannot be
 * read.
 */

function sectionKey(sec) { return (sec.term || S.term) + ":" + sec.crn; }

function pickedSections() {
  return S.sections.filter(function (s) { return S.selSections[sectionKey(s)]; });
}

/* A button that offers to build a group out of something you have already
 * gathered. Dashed like "New group", because all of them make the same kind of
 * thing; the label says what it would be made of. */
function groupBtn(label, title, fn) {
  var b = el("button", { text: label, title: title, style: {
    width: "100%", marginTop: "6px", padding: "6px", borderRadius: "6px",
    border: "1px dashed #c7d0dd", background: "transparent", color: "#41556f",
    cursor: "pointer", font: "inherit", fontSize: "12px" } });
  b.onclick = fn;
  return b;
}

/* Accepting a drop of students. The same three handlers on a group row and on
 * the new-group button; only what happens at the end differs. dataTransfer
 * cannot be read during dragover, so the highlight is driven by a variable set
 * at dragstart. */
function dropTarget(node, paint, onDrop) {
  node.addEventListener("dragover", function (ev) {
    if (!dragCarry) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
    node.style.background = "#d7e8ff";
    node.style.borderColor = "#2a78d6";
    if (paint) paint(true);
  });
  node.addEventListener("dragleave", function () { if (paint) paint(false); });
  node.addEventListener("drop", function (ev) {
    ev.preventDefault();
    var carry = dragCarry;
    if (!carry) {
      try { carry = JSON.parse(ev.dataTransfer.getData("application/x-bc-students")); }
      catch (e) { carry = null; }
    }
    dragCarry = null;
    document.body.removeAttribute("data-bc-dragging");
    if (paint) paint(false);
    if (!carry || !carry.length) { renderSide(); return; }
    onDrop(carry);
  });
}

function renderSide() {
  side.innerHTML = "";
  side.appendChild(el("div", { text: "My classes",
    style: { fontSize: "11px", color: "#6b7280", fontWeight: "600", margin: "2px 0 6px" } }));

  if (!S.sections.length)
    side.appendChild(el("div", { text: "none this term",
      style: { fontSize: "12px", color: "#9aa1ab", padding: "4px 0" } }));

  S.sections.forEach(function (sec) {
    var on = S.source && S.source.kind === "section" && S.source.crn === sec.crn;
    var b = el("div", { style: {
      display: "flex", gap: "6px", alignItems: "flex-start",
      padding: "6px 8px", borderRadius: "6px", cursor: "pointer", marginBottom: "3px",
      background: on ? "#e7f0fd" : "transparent",
      borderLeft: on ? "3px solid #2a78d6" : "3px solid transparent"
    } });

    /* Ticking classes is how a group gets built out of more than one roster.
     * A checkbox rather than a modifier-click: nobody discovers a
     * modifier-click, and the box also says that ticking is not opening. */
    var tick = el("input", { type: "checkbox",
      title: "Combine this class with others into a group",
      style: { margin: "3px 0 0", flex: "0 0 auto", accentColor: "#2a78d6", cursor: "pointer" } });
    tick.checked = !!S.selSections[sectionKey(sec)];
    // The row opens the section; the box must not, or ticking four classes
    // would load four rosters nobody asked to see.
    tick.onmousedown = function (ev) { ev.stopPropagation(); };
    tick.onclick = function (ev) {
      ev.stopPropagation();
      S.selSections[sectionKey(sec)] = tick.checked;
      renderSide();
    };
    b.appendChild(tick);

    var body = el("div", { style: { flex: "1 1 auto", minWidth: "0" } });
    var head = el("div", { style: { display: "flex", alignItems: "baseline", gap: "5px" } });
    head.appendChild(el("div", { text: sec.label || sec.crn,
      style: { fontWeight: "600", fontSize: "12.5px" } }));
    if (sec.enrolled != null)
      head.appendChild(el("div", { text: sec.enrolled,
        title: sec.enrolled + " enrolled",
        style: { marginLeft: "auto", fontSize: "11px", fontWeight: "600",
                 color: sec.enrolled === "0" ? "#9aa1ab" : "#2a78d6" } }));
    body.appendChild(head);
    // Truncate the title, never the CRN — the CRN is the part you might need
    // to type somewhere else, and it was being eaten by the ellipsis.
    var subline = el("div", { style: { display: "flex", gap: "5px", fontSize: "11px",
      color: "#6b7280", alignItems: "baseline" } });
    subline.appendChild(el("div", { text: sec.title || "", style: {
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: "0" } }));
    subline.appendChild(el("div", {
      text: (S.term === ALL_TERMS_CODE && sec.termLabel ? sec.termLabel + " · " : "") + sec.crn,
      style: { marginLeft: "auto", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" } }));
    body.appendChild(subline);
    b.appendChild(body);
    // An empty section is still worth listing — you may be checking whether
    // anyone has registered — but it should not look like a normal one.
    if (sec.enrolled === "0") b.style.opacity = ".62";
    b.onclick = function () { openSection(sec); };
    side.appendChild(b);
  });

  var picked = pickedSections();
  if (picked.length) {
    side.appendChild(groupBtn(
      "+ New group from " + picked.length + " class" + (picked.length === 1 ? "" : "es"),
      "Loads each roster and combines them, without duplicates: " +
      picked.map(function (s) { return s.label; }).join(", "),
      function () { newGroupFromSections(picked); }));
  }

  side.appendChild(el("div", { text: "Groups",
    style: { fontSize: "11px", color: "#6b7280", fontWeight: "600", margin: "14px 0 6px" } }));
  S.groups.forEach(function (grp, i) {
    var on = S.source && S.source.kind === "group" && S.source.name === grp.name;
    var wrap = el("div", { style: {
      display: "flex", alignItems: "center", gap: "4px", padding: "6px 8px", borderRadius: "6px",
      marginBottom: "3px", cursor: "pointer",
      background: on ? "#e7f0fd" : "transparent",
      borderLeft: on ? "3px solid #2a78d6" : "3px solid transparent" } });
    var lab = el("div", { style: { flex: "1 1 auto", minWidth: "0" } });
    lab.appendChild(el("div", { text: grp.name, style: { fontWeight: "600", fontSize: "12.5px" } }));
    lab.appendChild(el("div", { text: (grp.students || []).length + " students",
      style: { fontSize: "11px", color: "#6b7280" } }));
    lab.onclick = function () { openGroup(grp); };

    dropTarget(wrap, function (over) {
      wrap.style.background = over ? "#d7e8ff" : (on ? "#e7f0fd" : "transparent");
      wrap.style.borderLeft = (over || on) ? "3px solid #2a78d6" : "3px solid transparent";
    }, function (carry) {
      var n = addToGroup(i, carry);
      idle(n
        ? n + " added to " + grp.name
        : "already in " + grp.name + " — nothing added");
    });
    function iconBtn(glyph, title, fn) {
      var b = el("button", { text: glyph, title: title, style: {
        border: "0", background: "transparent", cursor: "pointer", color: "#9aa1ab",
        font: "inherit", fontSize: "13px", padding: "0 3px", lineHeight: "1" } });
      b.onclick = function (ev) { ev.stopPropagation(); fn(); };
      return b;
    }
    var edit = iconBtn("✎", "Edit group", function () { editGroup(i); });
    var del = iconBtn("×", "Delete group", function () {
      // Groups are typed by hand and only live in this browser, so deleting
      // one is not recoverable from anywhere.
      if (!confirm('Delete the group "' + grp.name + '"? This cannot be undone.')) return;
      S.groups.splice(i, 1);
      saveGroups(S.groups);
      if (S.source && S.source.kind === "group" && S.source.name === grp.name) {
        S.source = null; S.students = []; S.sel = {}; S.focus = null;
        setRightOpen(false);
        renderMain();
      }
      renderSide();
    });
    del.style.fontSize = "15px";
    wrap.appendChild(lab); wrap.appendChild(edit); wrap.appendChild(del);
    side.appendChild(wrap);
  });

  /* Straight from whoever is ticked in the roster. This is the sidebar's half
   * of a gesture that starts in the middle pane, which is why it lives here
   * and not next to "Select all": the group being made is a thing in this
   * list, and it should appear where it will end up. */
  if (S.students.length) {
    var n = nSelected();
    selBtnRef = groupBtn(
      n ? "+ New group from " + n + " selected"
        : "+ New group from all " + S.students.length + " in " + S.source.label,
      "Opens the group editor with them already in it.",
      function () { newGroupFromStudents(selectedStudents()); });
    side.appendChild(selBtnRef);
  } else {
    selBtnRef = null;
  }

  var add = groupBtn("+ New group from UINs",
    "Search by name or paste UINs — or drag students here from a roster.", newGroup);
  /* Also a drop target, because until a group exists there is nowhere to drag
   * to, and "make a group first" is a poor answer to somebody holding a
   * selection. Dropping here opens the editor with them in it. */
  dropTarget(add, function (over) {
    add.style.background = over ? "#d7e8ff" : "transparent";
    add.style.borderColor = over ? "#2a78d6" : "#c7d0dd";
  }, function (carry) { newGroupFromStudents(carry); });
  side.appendChild(add);
}

/* The group editor.
 *
 * A group is a membership list, so the screen is the list: names and UINs, one
 * row each, with a way to remove any of them. It replaced a textarea of bare
 * numbers, which was fine for creating a group in one go and useless for
 * checking or amending one — a list of eight-digit numbers cannot be read.
 *
 * Two ways in: search by name for someone whose UIN you do not have, and paste
 * UINs for when you do. Neither is the primary; people arrive with either.
 */
function showGroupModal(opts) {
  var members = (opts.students || []).map(function (m) {
    return { uin: String(m.uin), name: m.name || "" };
  });

  var back = el("div", { style: {
    position: "absolute", top: "0", left: "0", right: "0", bottom: "0",
    background: "rgba(15,18,25,.55)", zIndex: "10",
    display: "flex", alignItems: "center", justifyContent: "center" } });

  var card = el("div", { style: {
    background: "#fff", borderRadius: "12px", padding: "18px 20px", width: "560px",
    maxWidth: "94%", maxHeight: "88vh", display: "flex", flexDirection: "column",
    boxShadow: "0 20px 50px rgba(0,0,0,.35)" } });
  card.onclick = function (ev) { ev.stopPropagation(); };

  card.appendChild(el("div", { text: opts.title || "New group",
    style: { fontWeight: "700", fontSize: "16px", marginBottom: "2px" } }));
  card.appendChild(el("div", {
    text: "An artificial class built from students — a research group, a set of advisees.",
    style: { fontSize: "12px", color: "#6b7280", marginBottom: "10px" } }));

  var fieldStyle = {
    width: "100%", padding: "7px 9px", borderRadius: "6px", border: "1px solid #c7d0dd",
    font: "inherit", color: "#16191f", background: "#fff" };
  function label(t) {
    return el("label", { text: t, style: {
      display: "block", fontSize: "11px", color: "#6b7280", fontWeight: "600",
      margin: "10px 0 3px" } });
  }

  var nameIn = el("input", { style: fieldStyle });
  nameIn.placeholder = "Research group";
  nameIn.value = opts.name || "";
  card.appendChild(label("Name"));
  card.appendChild(nameIn);

  var countLbl = label("Members");
  card.appendChild(countLbl);
  var listBox = el("div", { style: {
    border: "1px solid #c7d0dd", borderRadius: "6px", overflow: "auto",
    maxHeight: "220px", minHeight: "64px", flex: "0 1 auto" } });
  card.appendChild(listBox);

  function renderMembers() {
    listBox.innerHTML = "";
    countLbl.textContent = "Members (" + members.length + ")";
    if (!members.length) {
      listBox.appendChild(el("div", {
        text: "Empty — add students below, or save now and drag them in later.",
        style: { padding: "14px", color: "#9aa1ab", fontSize: "12px", fontStyle: "italic" } }));
      return;
    }
    var tbl = el("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: "12.5px" } });
    members.forEach(function (m, i) {
      var tr = el("tr");
      tr.appendChild(el("td", { text: m.name || "(name not loaded)", style: {
        padding: "5px 8px", borderBottom: "1px solid #eef1f5",
        color: m.name ? "#16191f" : "#9aa1ab", fontStyle: m.name ? "normal" : "italic" } }));
      tr.appendChild(el("td", { text: m.uin, style: {
        padding: "5px 8px", borderBottom: "1px solid #eef1f5", color: "#6b7280",
        fontVariantNumeric: "tabular-nums", width: "96px" } }));
      var td = el("td", { style: { padding: "2px 6px", borderBottom: "1px solid #eef1f5", width: "30px" } });
      var x = el("button", { text: "\u00d7", title: "Remove from group", style: {
        border: "0", background: "transparent", cursor: "pointer", color: "#9aa1ab",
        fontSize: "16px", lineHeight: "1", padding: "0 3px" } });
      x.onclick = function () { members.splice(i, 1); renderMembers(); };
      td.appendChild(x);
      tr.appendChild(td);
      tbl.appendChild(tr);
    });
    listBox.appendChild(tbl);
  }

  function addMember(uin, name) {
    uin = String(uin || "").trim();
    if (!uin) return false;
    var dupe = members.filter(function (m) {
      return m.uin.replace(/^0+/, "") === uin.replace(/^0+/, "");
    })[0];
    if (dupe) { if (name && !dupe.name) dupe.name = name; return false; }
    members.push({ uin: uin, name: name || "" });
    return true;
  }

  // ---- add by name ------------------------------------------------------
  card.appendChild(label("Add by name"));
  var searchIn = el("input", { style: fieldStyle });
  searchIn.placeholder = "Surname, or \u201cSurname, First\u201d";
  card.appendChild(searchIn);
  var results = el("div", { style: {
    border: "1px solid #eef1f5", borderRadius: "6px", marginTop: "4px",
    maxHeight: "132px", overflow: "auto", display: "none" } });
  card.appendChild(results);

  var searchTimer = null, searchSeq = 0;
  function runSearch() {
    var q = searchIn.value.trim();
    if (q.length < 2) { results.style.display = "none"; return; }
    var mine = ++searchSeq;
    results.style.display = "block";
    results.innerHTML = "";
    results.appendChild(el("div", { text: "Searching\u2026",
      style: { padding: "8px", fontSize: "12px", color: "#9aa1ab" } }));
    searchByName(q, curTerm()).then(function (rows) {
      if (mine !== searchSeq) return;       // a later keystroke already won
      results.innerHTML = "";
      if (!rows.length) {
        results.appendChild(el("div", { text: "No match in " + curLabel(),
          style: { padding: "8px", fontSize: "12px", color: "#9aa1ab" } }));
        return;
      }
      rows.slice(0, 25).forEach(function (r) {
        var already = members.filter(function (m) { return m.uin === r.uin; }).length > 0;
        var row = el("div", { style: {
          display: "flex", gap: "8px", alignItems: "center", padding: "5px 8px",
          cursor: already ? "default" : "pointer", fontSize: "12.5px",
          opacity: already ? ".5" : "1", borderBottom: "1px solid #f4f6fa" } });
        row.appendChild(el("div", { text: r.name, style: { flex: "1 1 auto", minWidth: "0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }));
        row.appendChild(el("div", { text: r.uin, style: {
          color: "#6b7280", fontVariantNumeric: "tabular-nums" } }));
        row.appendChild(el("div", { text: already ? "in group" : "+ add", style: {
          color: already ? "#9aa1ab" : "#2a78d6", fontWeight: "600", width: "54px",
          textAlign: "right" } }));
        if (!already) row.onclick = function () {
          addMember(r.uin, r.name);
          renderMembers();
          runSearch();                       // refresh the "in group" marks
        };
        results.appendChild(row);
      });
    });
  }
  searchIn.oninput = function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 320);   // one request per pause, not per key
  };

  // ---- add by pasting UINs ---------------------------------------------
  card.appendChild(label("Or paste UINs"));
  var pasteRow = el("div", { style: { display: "flex", gap: "6px" } });
  var uinIn = el("input", { style: fieldStyle });
  uinIn.placeholder = "01234567 01234568 \u2026";
  var addBtn = btn("Add");
  addBtn.onclick = function () {
    var n = 0;
    parseUINs(uinIn.value).forEach(function (u) { if (addMember(u, "")) n++; });
    uinIn.value = "";
    renderMembers();
    if (n) status.textContent = "added " + n;
  };
  uinIn.onkeydown = function (ev) { if (ev.key === "Enter") { ev.preventDefault(); addBtn.onclick(); } };
  pasteRow.appendChild(uinIn); pasteRow.appendChild(addBtn);
  card.appendChild(pasteRow);

  // ---- buttons ----------------------------------------------------------
  var bar2 = el("div", { style: {
    display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "14px" } });
  var cancel = btn("Cancel");
  var save = btn(opts.submitLabel || "Create group", true);
  bar2.appendChild(cancel); bar2.appendChild(save);
  card.appendChild(bar2);
  back.appendChild(card);
  app.appendChild(back);

  function close() {
    document.removeEventListener("keydown", onKey, true);
    back.remove();
  }
  /* An empty group saves. Creating the container first and dragging people in
   * afterwards is a reasonable order to work in — and it is the order the
   * sidebar invites, since a group has to exist before it can be a drop
   * target. */
  function submit() {
    close();
    opts.onSave((nameIn.value || "").trim() || "Group", members);
  }
  function onKey(ev) {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
    else if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submit(); }
  }
  cancel.onclick = close;
  back.onclick = close;
  save.onclick = submit;
  document.addEventListener("keydown", onKey, true);

  renderMembers();
  /* The name, unless the group already has one. A group arriving prefilled —
   * from a selection, a drop, or a set of classes — has its membership settled
   * and its name missing, which is the opposite of editing an existing one. */
  if (opts.focusMembers) searchIn.focus();
  else { nameIn.focus(); nameIn.select(); }
}

function createGroup(name, students) {
  S.groups.push({ name: name, students: students });
  saveGroups(S.groups);
  renderSide();
  openGroup(S.groups[S.groups.length - 1]);
}

function newGroup() {
  showGroupModal({
    title: "New group",
    submitLabel: "Create group",
    onSave: createGroup
  });
}

/* A group from students already in hand — ticked in the roster, or dragged
 * onto the sidebar.
 *
 * It opens the editor rather than creating the group outright. A group needs a
 * name, and "Group 3" is a name nobody meant; the membership is also worth one
 * look before it is saved, which is what the editor is for. */
function newGroupFromStudents(list) {
  var members = (list || []).map(function (s) {
    return { uin: String(s.uin || ""), name: s.name || "" };
  }).filter(function (m) { return m.uin; });
  showGroupModal({
    title: "New group from " + members.length + " student" + (members.length === 1 ? "" : "s"),
    submitLabel: "Create group",
    students: members,
    onSave: createGroup
  });
}

/* A group from whole rosters.
 *
 * Combining classes is how a cohort gets described: the students who took any
 * of these three courses. Duplicates are the point rather than an edge case —
 * anyone in two of them must appear once — so the union is by UIN and the
 * status line says how many were in more than one, because that number is
 * usually the interesting one.
 */
function newGroupFromSections(secs) {
  taskBegin("Loading " + secs.length + " roster" + (secs.length === 1 ? "" : "s") + "…");
  pool(secs, 3, function (sec) {
    return fetchRoster(sec.term || S.term, sec.crn).catch(function () { return []; });
  }, function (d, t) { prog("Rosters… " + d + "/" + t, d, t); }).then(function (lists) {
    var seen = {}, members = [], rows = 0;
    (lists || []).forEach(function (l) {
      (l || []).forEach(function (s) {
        var k = String(s.uin || "").replace(/^0+/, "");
        if (!k) return;
        rows++;
        if (seen[k]) return;
        seen[k] = 1;
        members.push({ uin: String(s.uin), name: s.name || "" });
      });
    });
    var both = rows - members.length;
    idle(members.length + " from " + secs.length + " class" + (secs.length === 1 ? "" : "es") +
         (both ? " · " + both + " in more than one" : ""));

    var name = secs.map(function (s) { return s.label || s.crn; }).join(" + ");
    if (name.length > 42) name = secs.length + " classes";
    showGroupModal({
      title: "New group from " + secs.length + " class" + (secs.length === 1 ? "" : "es"),
      submitLabel: "Create group",
      name: name,
      students: members,
      onSave: function (nm, students) {
        // The ticks were the question; the group is the answer to it.
        S.selSections = {};
        createGroup(nm, students);
      }
    });
  });
}

function editGroup(i) {
  var grp = S.groups[i];
  showGroupModal({
    title: "Edit group",
    submitLabel: "Save",
    name: grp.name,
    students: grp.students,
    focusMembers: true,
    onSave: function (name, students) {
      var wasOpen = S.source && S.source.kind === "group" && S.source.name === grp.name;
      S.groups[i] = { name: name, students: students };
      saveGroups(S.groups);
      renderSide();
      // Reload if the group being edited is the one on screen, so the roster
      // matches the list that was just saved.
      if (wasOpen) openGroup(S.groups[i]);
    }
  });
}

/* Dropping students onto a group in the sidebar.
 *
 * Adds only; a drop never removes anyone, so a mis-drop costs one trip to the
 * editor rather than losing a list. Returns how many were new, because "0
 * added, all 4 already there" and "4 added" should not look the same. */
function addToGroup(i, students) {
  var grp = S.groups[i];
  if (!grp) return 0;
  grp.students = grp.students || [];
  var have = {};
  grp.students.forEach(function (m) { have[String(m.uin).replace(/^0+/, "")] = m; });
  var added = 0;
  students.forEach(function (s) {
    if (!s.uin) return;
    var k = String(s.uin).replace(/^0+/, "");
    if (have[k]) { if (s.name && !have[k].name) have[k].name = s.name; return; }
    var m = { uin: String(s.uin), name: s.name || "" };
    grp.students.push(m);
    have[k] = m;
    added++;
  });
  saveGroups(S.groups);
  renderSide();
  return added;
}
