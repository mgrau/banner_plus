/* ---- Shared free time -----------------------------------------------------
 *
 * Select any set of students and see when they are collectively not in class.
 * Pointed at a roster it answers what office hours are really asking; pointed
 * at a research group it replaces opening twelve schedules side by side.
 *
 * Hovering a slot fills the panel below the grid with who is free and who is
 * not. That belongs in a panel rather than a tooltip: it is the question the
 * whole view exists to answer, and a tooltip vanishes the moment you look away
 * from it to think.
 */

function openScheduling() {
  var group = selectedStudents();
  var nodes = [paneHeader("Scheduling", function () { setRightOpen(false); })];
  var info = el("div", { text: "Loading " + group.length + " schedules…",
    style: { color: "#6b7280", fontSize: "12px" } });
  nodes.push(info);
  showRight(nodes);

  taskBegin("Loading " + group.length + " schedules…");
  hydrate(group, curTerm(), function (d, t) {
    info.textContent = "Loading schedules… " + d + "/" + t;
    prog(null, d, t);
  })
    .then(function () {
      var out = [nodes[0]];
      var nDays = S.sat ? 6 : 5;
      var scheduled = withMeetings(group, curTerm());
      var total = scheduled.length;
      out.push(el("div", { text: total + " of " + group.length + " have scheduled classes",
        style: { fontSize: "12px", color: "#6b7280", marginBottom: "8px" } }));

      // idle(null) left "Loading 3 schedules…" on screen after it had finished.
      idle(total + " of " + group.length + " have scheduled classes");
      if (!total) { showRight(out); return; }
      var g = busyMap(scheduled, curTerm(), nDays);

      var tbl = el("table", { style: { width: "100%", borderCollapse: "separate",
        borderSpacing: "0", tableLayout: "fixed", fontSize: "10px" } });
      var hr = el("tr");
      hr.appendChild(el("th", { style: { width: "42px" } }));
      for (var d = 0; d < nDays; d++)
        hr.appendChild(el("th", { text: DAY_ABBR[d], style: {
          fontSize: "11px", color: "#6b7280", paddingBottom: "3px" } }));
      tbl.appendChild(hr);

      // Who is free, and who is not, for whatever cell the pointer is over.
      var detail = el("div", { style: {
        marginTop: "8px", padding: "8px 10px", border: "1px solid #e6eaf0",
        borderRadius: "7px", background: "#fafbfd", fontSize: "11.5px",
        minHeight: "76px", lineHeight: "1.5" } });

      function showSlot(d, sIdx) {
        detail.innerHTML = "";
        var t0 = DAY_START + sIdx * SLOT;
        var busyIdx = g[d][sIdx];
        var busySet = {};
        busyIdx.forEach(function (bi) { busySet[bi] = 1; });
        var freeNames = [], busyNames = [];
        scheduled.forEach(function (st, i2) {
          (busySet[i2] ? busyNames : freeNames).push(st.name);
        });

        var head = el("div", { style: { fontWeight: "700", marginBottom: "3px" } });
        head.appendChild(el("span", { text: DAY_ABBR[d] + " " + clock(t0) + "\u2013" +
          clock(t0 + SLOT) }));
        head.appendChild(el("span", { text: "  " + freeNames.length + " of " + total + " free",
          style: { color: "#2a78d6" } }));
        detail.appendChild(head);

        function nameRow(label, names, color) {
          if (!names.length) return;
          var row = el("div", { style: { display: "flex", gap: "5px", marginTop: "2px" } });
          row.appendChild(el("span", { text: label, style: {
            color: color, fontWeight: "600", flex: "0 0 auto", minWidth: "58px" } }));
          row.appendChild(el("span", { text: names.join(", "), style: {
            color: "#41556f", minWidth: "0" } }));
          detail.appendChild(row);
        }
        nameRow("Free", freeNames, "#1b7a4b");
        nameRow("In class", busyNames, "#b3261e");
      }

      function clearSlot() {
        detail.innerHTML = "";
        detail.appendChild(el("div", { text: "Hover a time to see who is free.",
          style: { color: "#9aa1ab", fontStyle: "italic" } }));
      }

      for (var s = 0; s < N_SLOTS; s++) {
        var t0 = DAY_START + s * SLOT;
        var tr = el("tr");
        tr.appendChild(el("td", { text: t0 % 60 === 0 ? clock(t0) : "",
          style: { fontSize: "10px", color: "#6b7280", textAlign: "right", paddingRight: "5px",
                   whiteSpace: "nowrap" } }));
        for (d = 0; d < nDays; d++) {
          var free = total - g[d][s].length;
          var i = rampStep(free, total);
          var cell = el("td", { style: { padding: "0" } });
          var box = el("div", {
            text: free || "",
            style: { height: "19px", lineHeight: "19px", textAlign: "center", borderRadius: "2px",
                     border: "1px solid #fff", background: RAMP[i], color: RAMP_INK[i],
                     fontSize: "10px", cursor: "default" }
          });
          (function (dd, ss, node) {
            node.onmouseenter = function () {
              node.style.outline = "2px solid #16191f";
              node.style.outlineOffset = "-2px";
              showSlot(dd, ss);
            };
            node.onmouseleave = function () { node.style.outline = "none"; };
          })(d, s, box);
          cell.appendChild(box);
          tr.appendChild(cell);
        }
        tbl.appendChild(tr);
      }
      out.push(tbl);
      clearSlot();
      out.push(detail);

      var lg = el("div", { style: { display: "flex", alignItems: "center", gap: "3px",
        fontSize: "10.5px", color: "#6b7280", marginTop: "6px" } });
      lg.appendChild(el("span", { text: "none" }));
      RAMP.forEach(function (c) {
        lg.appendChild(el("i", { style: { width: "16px", height: "9px", borderRadius: "2px",
          background: c, display: "inline-block", border: "1px solid #d8dde5" } }));
      });
      lg.appendChild(el("span", { text: "all " + total }));
      out.push(lg);

      var satLbl = el("label", { style: { display: "flex", alignItems: "center", gap: "5px",
        fontSize: "11.5px", color: "#41556f", marginTop: "8px", cursor: "pointer" } });
      var sb = el("input", { type: "checkbox" });
      sb.checked = S.sat;
      sb.onchange = function () { S.sat = sb.checked; openScheduling(); };
      satLbl.appendChild(sb); satLbl.appendChild(document.createTextNode("include Saturday"));
      out.push(satLbl);

      var pb = btn("Print free-time sheet", true);
      pb.style.width = "100%"; pb.style.marginTop = "8px";
      pb.onclick = function () {
        openDoc(freeTimeDoc(group, curTerm(), curLabel(), nDays), true);
      };
      out.push(pb);

      showRight(out);
    });
}
