/* ---- The GPA bridge ---------------------------------------------------------
 *
 * The registrar's GPA lives on the student host, a different origin with no
 * CORS headers: the console can fetch from it, and the browser will not hand
 * it the answer. No cleverness in a page changes that. What does work is
 * running code on both hosts and passing messages between the two tabs.
 *
 * So the same bookmark does two jobs. In Faculty Self-Service it is the
 * console. In Student Self-Service it is this: a small strip that answers the
 * console's questions with same-origin requests from its own tab. Close the
 * tab and the console goes back to offering Fetch.
 *
 * Either tab can be first, opened any way at all, and they find each other.
 * Each needs its own click of the bookmark: a page scripting another origin's
 * tab is exactly what the same-origin policy forbids, sister hosts or not, so
 * that click is the only way in short of an extension. A bridge that finds no
 * console opens Faculty Self-Service itself, and the console clicked there
 * comes up connected with nothing to switch back to. The console's Fetch,
 * under Registrar's GPA, opens the student tab the other way round.
 *
 *   console ──ask──► bridge ──fetch──► student host
 *   console ◄─answer─ bridge
 *
 * There are two ways between the tabs, and every message goes each way that
 * works:
 *
 *   - Directly, by postMessage to a window the tab holds: the one that opened
 *     it, or one it opened. That links only tabs one of them opened.
 *   - Through the hub: hub.html, from the site this script came from, framed
 *     out of sight in both tabs. Its copies share a BroadcastChannel, so tabs
 *     that hold nothing of each other meet there. Browsers keep a framed
 *     page's channel apart by the site of the tab around it, and the two
 *     hosts are one site, so theirs is shared.
 *
 * Either can fail alone — a sign-in page or an opener policy cuts the direct
 * link, a content security policy would keep the hub out — and while one
 * works, so does the bridge.
 *
 * A message carries its sender's id, and the id of the tab it is for when it
 * is for one. The bridge says hello when it starts and every few seconds
 * after; a console asks for that hello as it starts, rather than waiting for a
 * beat that a background tab may send a minute late. Going away is noticed
 * without the bridge's timers: a tab says goodbye on the way out, a closed
 * window reports itself closed, and a bridge that does not say at once that
 * it has a question is dropped. Timers in the bridge cannot carry that job.
 * Chrome slows them to once a minute in a tab that has sat in the background
 * a while, and the bridge tab nearly always has; messages are delivered
 * regardless.
 *
 * What it will do is deliberately narrow, because it is a door between two
 * origins:
 *
 *   - It answers Faculty Self-Service and nothing else. Where a message came
 *     from is the browser's word, never the message's: postMessage reports
 *     it, and the hub hands a message only to a tab of the origin it names,
 *     tagged with the origin of the tab that sent it. Any page can open a
 *     student profile and ask for the bookmark to be clicked there; it gets
 *     nothing back, not even a hello.
 *   - It asks for a fixed list of things, by name, with a checked UIN —
 *     never "fetch the URL you are given".
 *   - One request at a time, one request per question, and before a question
 *     about a new student, that student's profile (warmProfile). A refusal is
 *     passed back, not retried: a burst of retried refusals is the shape of
 *     what upset Banner when the course pane was on.
 *
 * The hub is a static page and fetches nothing. What passes through it stays
 * in the browser.
 *
 * This is the one fragment before 70 that touches the page, and then only
 * for the strip and the hub's frame. build.py ends the bundle right after the
 * data layer on the student host, so none of the console is ever drawn there.
 *
 * What only a real session can confirm: that Banner lets the hub's frame in,
 * which a Content-Security-Policy listing the sites its pages may frame would
 * not. Without it, the tabs still find each other when one opened the other.
 * And that each student's profile, served first, is all the GPA wants, on a
 * tab where Banner showed only "Sorry, This page is not available."
 */

var BRIDGE_V = 2;
var BRIDGE_BEAT = 5000;      // how often the bridge says hello, when Chrome lets it
var BRIDGE_LOOK = 800;       // how long a bridge clicked first looks for a console
var BRIDGE_HEARD = 4000;     // how long a bridge has to say it has the question

// What the bridge will ask the student host for, by name. Paths as
// ENDPOINTS.md records them.
var BRIDGE_ASKS = { gpa: "studentProfile/viewGPAHoursList" };

// Where the bridge opens the console when it finds none open: the class
// list, where people usually start it.
var CONSOLE_PAGE = "/FacultySelfService/ssb/classListApp/classListPage";

/* Sets up this end. True on the student host, where the bridge is the whole
 * program and the bundle stops; on the faculty host it starts listening for
 * a bridge and the console carries on. */
function openBridge() {
  if (APP === "StudentSelfService") { serveBridge(); return true; }
  listenForBridge();
  return false;
}

// ---- both ends: the line between the tabs ----------------------------------

/* Messages to and from the other end, both ways at once. peerOrigin() is the
 * origin at the other end. handle(m, via) gets each message meant for this
 * tab: via.send answers the way it came, and via.win is the window it came
 * from, if it came directly. ready() runs once the hub is up. */
function bridgeLine(peerOrigin, handle, ready) {
  var me = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var hubOrigin = new URL(HOME).origin, up = false;

  // One hub per tab: a second click of the bookmark replaces the first's.
  var old = document.getElementById("bp-hub");
  if (old) old.remove();
  var hub = el("iframe", { id: "bp-hub", src: HOME + "hub.html",
    title: "Banner Plus, between tabs", style: { display: "none" } });

  function stamp(m) { m.bp = BRIDGE_V; m.from = me; return m; }
  function viaHub(m) {
    if (!up) return;
    try { hub.contentWindow.postMessage({ toOrigin: peerOrigin(), m: stamp(m) }, hubOrigin); }
    catch (e) {}
  }
  function direct(win) {
    return function (m) {
      try { win.postMessage(stamp(m), peerOrigin()); } catch (e) {}
    };
  }

  function listen(ev) {
    var d = ev.data, m, via;
    if (ev.source && ev.source === hub.contentWindow) {
      if (ev.origin !== hubOrigin || !d || d.fromOrigin !== peerOrigin()) return;
      m = d.m; via = { send: viaHub, win: null };
    } else {
      if (ev.origin !== peerOrigin() || !ev.source) return;
      m = d; via = { send: direct(ev.source), win: ev.source };
    }
    if (!m || m.bp !== BRIDGE_V || typeof m.from !== "string" || (m.to && m.to !== me)) return;
    handle(m, via);
  }
  window.addEventListener("message", listen);
  hub.onload = function () { up = true; if (ready) ready(); };
  document.body.appendChild(hub);

  return {
    hub: viaHub,
    direct: direct,
    close: function () { window.removeEventListener("message", listen); hub.remove(); }
  };
}

// ---- the console's end -----------------------------------------------------

var bridgePeer = null;       // { id, send, win } for the bridge in use
var bridgeWaiting = {};      // ask id -> { resolve, reject, fail, timer }
var bridgeNext = 1;
var bridgeWatchers = [];
var bridgeWas = false;
var bridgeLink = null;       // this tab's line to the student host

function bridgeReady() {
  return !!bridgePeer && !(bridgePeer.win && bridgePeer.win.closed);
}

// Questions still out will not be answered now; say so at once rather than
// after the timeout. Another bridge may be open too: ask it to say hello.
function bridgeDrop(why) {
  bridgePeer = null;
  Object.keys(bridgeWaiting).forEach(function (id) {
    clearTimeout(bridgeWaiting[id].timer);
    bridgeWaiting[id].reject(new Error(why));
    delete bridgeWaiting[id];
  });
  bridgeNotify();
  if (bridgeLink) bridgeLink.hub({ kind: "ping" });
}

// For views that change when a tab connects or goes away.
function onBridge(fn) { bridgeWatchers.push(fn); }

function bridgeNotify() {
  bridgeWas = bridgeReady();
  bridgeWatchers.forEach(function (fn) { try { fn(bridgeWas); } catch (e) {} });
}

function listenForBridge() {
  bridgeLink = bridgeLine(studentHost, function (m, via) {
    if (m.kind === "hello") {
      // The first bridge to say hello is the one asked, until it goes.
      if (!bridgeReady()) bridgePeer = { id: m.from, send: via.send, win: via.win };
      if (m.from !== bridgePeer.id) return;
      via.send({ kind: "ack", to: m.from });
      if (!bridgeWas) bridgeNotify();
      return;
    }
    if (!bridgePeer || m.from !== bridgePeer.id) return;
    if (m.kind === "bye") { bridgeDrop("the connected tab was closed"); return; }
    var w = bridgeWaiting[m.id];
    if (!w) return;
    if (m.kind === "took") {
      // It has the question. Banner may take a while to answer it.
      clearTimeout(w.timer);
      w.timer = setTimeout(w.fail, 20000);
      return;
    }
    if (m.kind === "answer") {
      clearTimeout(w.timer);
      delete bridgeWaiting[m.id];
      if (m.ok) { w.resolve(m.data); return; }
      var e = new Error(m.error || "the bridge could not answer");
      e.status = m.status;
      w.reject(e);
    }
  }, function () {
    // The hub is up: a bridge already open, anywhere, says hello now.
    bridgeLink.hub({ kind: "ping" });
  });

  // A closed tab sends nothing; this notices one this tab holds. It runs in
  // the console's tab, which is the one being looked at, so its timer is not
  // the slowed kind.
  setInterval(function () { if (bridgeReady() !== bridgeWas) bridgeNotify(); }, 3000);

  // Opened by a bridge, this tab's opener is that bridge, and the direct way
  // to it works even where the hub cannot. Dropped unseen unless the opener
  // is on the student host.
  if (window.opener) bridgeLink.direct(window.opener)({ kind: "ping" });

  // So the bridge stops counting this tab.
  window.addEventListener("pagehide", function () {
    if (bridgePeer) bridgePeer.send({ kind: "bye", to: bridgePeer.id });
  });
}

function bridgeAsk(what, uin, term) {
  if (!bridgeReady())
    return Promise.reject(new Error("no Banner Plus tab is connected on the student host"));
  var peer = bridgePeer, id = bridgeNext++;
  return new Promise(function (resolve, reject) {
    /* Unanswered means gone, whatever the tab still claims: drop it, so the
     * pane offers to connect again instead of waiting on it forever. A live
     * bridge says at once that it has the question, however long Banner then
     * takes, so a tab that went without a word is noticed in seconds. */
    function fail() {
      delete bridgeWaiting[id];
      reject(new Error("the connected tab didn't answer — was it closed or reloaded?"));
      if (bridgePeer === peer) bridgeDrop("the connected tab stopped answering");
    }
    bridgeWaiting[id] = { resolve: resolve, reject: reject, fail: fail,
                          timer: setTimeout(fail, BRIDGE_HEARD) };
    peer.send({ kind: "ask", to: peer.id, id: id, what: what, uin: String(uin),
                term: term ? String(term) : "" });
  });
}

// By name, so a second Fetch before the first tab was clicked brings that
// tab back instead of opening another.
function openBridgeTab(url) { window.open(url, "bp-bridge"); }

// ---- the student host's end ------------------------------------------------

/* One request per question, to the path ENDPOINTS.md recorded, with the
 * headers this page's own token allows. Only a sign of the wrong route — a
 * 404, or a whole page where data was expected — moves on to the other
 * prefix; a refusal or a server error is the answer. */
var bridgePrefixFor = {};

function askStudentHost(family, qs) {
  var order = bridgePrefixFor[family] ? [bridgePrefixFor[family]] : ["/", "/ssb/"];
  function attempt(i) {
    var p = order[i], last = i + 1 >= order.length;
    return fetch(base + p + family + "?" + qs,
                 { credentials: "same-origin", headers: apiHeaders() })
      .then(function (r) {
        if (r.status === 404 && !last) return attempt(i + 1);
        if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
        return r.json().then(function (j) {
          bridgePrefixFor[family] = p;
          return j;
        }, function () {
          if (!last) return attempt(i + 1);
          throw new Error("Banner answered with a page, not data");
        });
      });
  }
  return attempt(0);
}

/* The profile is an application and viewGPAHoursList is its endpoint, as the
 * class list is in Faculty Self-Service (warmUp, in 30-banner): the answer
 * needs that student's page served in this session, and the page's token.
 * The session holds one student, the last profile served, and asked about
 * anyone else the GPA is a 404: the first student worked and every one after
 * it did not. So each question about someone new fetches their profile first,
 * the visit without the navigation. A bridge clicked on a profile already has
 * that student. Not fatal: the question is asked either way. */
var profileFor = /\/studentProfile/i.test(location.pathname) && TOKEN
  ? new URLSearchParams(location.search).get("studentId") : null;

function warmProfile(uin, term) {
  if (profileFor === uin) return Promise.resolve(true);
  return fetch(base + "/ssb/studentProfile?studentId=" + encodeURIComponent(uin) +
               (term ? "&term=" + encodeURIComponent(term) : ""),
               { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .then(function (html) {
      var t = tokenIn(html);
      if (t) TOKEN = t;
      if (html) profileFor = uin;
      return true;
    }, function () { return false; });
}

function serveBridge() {
  // Clicked again in the same tab: the bridge already here takes the click,
  // which is fresh leave to open the console if it could not before. One left
  // by an older build cannot, so this one replaces it.
  var was = document.getElementById("bp-bridge");
  if (was && was.bpAgain) { was.bpAgain(); return; }
  if (was) was.remove();

  var faculty = location.origin.replace("studentssb", "facultyssb");

  var strip = el("div", { id: "bp-bridge", style: {
    position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647, maxWidth: "380px",
    display: "flex", alignItems: "flex-start", gap: "8px", padding: "9px 11px",
    background: "#fff", color: "#16191f", border: "1px solid #d8dde5",
    borderLeft: "3px solid #2a78d6", borderRadius: "8px",
    boxShadow: "0 10px 30px rgba(15,18,25,.22)",
    font: "12.5px/1.45 -apple-system,Segoe UI,Arial,sans-serif" } });
  var msg = el("div", { style: { flex: "1 1 auto" } });
  var words = el("div");
  var act = el("button", { style: {
    display: "none", marginTop: "6px", padding: "4px 10px", borderRadius: "6px",
    border: "1px solid #c7d0dd", background: "#fff", color: "#41556f",
    cursor: "pointer", font: "inherit" } });
  var x = el("button", { text: "×", title: "Stop the bridge", style: {
    border: "0", background: "transparent", cursor: "pointer", color: "#9aa1ab",
    fontSize: "17px", lineHeight: "1", padding: "0 2px" } });
  msg.appendChild(words); msg.appendChild(act);
  strip.appendChild(msg); strip.appendChild(x);
  document.body.appendChild(strip);
  x.onclick = function () { stop(); };

  /* The consoles this tab answers: each Faculty Self-Service tab that has
   * answered its hello, by id. Opened by a console, that one answers at once.
   * Clicked first, the bridge looks a moment for a console already open
   * anywhere, and opens Faculty Self-Service only if none answers; the
   * console is then started in the tab it opened, which is in front, so
   * nothing has to be switched back to. */
  var consoles = {};
  var opened = null, looking = true;
  var answered = 0, queue = Promise.resolve(), beat = null, line;

  function connected() {
    return Object.keys(consoles).some(function (id) {
      return !(consoles[id].win && consoles[id].win.closed);
    });
  }

  function openConsole() {
    if (opened && !opened.closed) { opened.focus(); return; }
    opened = window.open(faculty + CONSOLE_PAGE, "_blank") || opened;
    draw();
  }
  act.onclick = openConsole;

  function draw() {
    var offer = "";
    if (connected()) {
      words.textContent = "Banner Plus is reading the registrar's GPA through this tab" +
        (answered ? " (" + answered + " so far)" : "") + ". Keep it open" +
        (opened && !opened.closed ? "." : ", and switch back to the console.");
    } else if (looking) {
      words.textContent = "Banner Plus: looking for the console…";
    } else if (opened && !opened.closed) {
      words.textContent = "Banner Plus opened Faculty Self-Service in a new tab. Click " +
        "Banner Plus there, and this tab reads the registrar's GPA for it.";
    } else {
      // None answered and none is open from here: the browser blocked the
      // new tab, or it was closed. Any console will do.
      words.textContent = "Banner Plus: click Banner Plus in any Faculty Self-Service " +
        "tab, and this tab reads the registrar's GPA for it.";
      offer = "Open Faculty Self-Service";
    }
    act.textContent = offer;
    act.style.display = offer ? "" : "none";
  }

  // To every console this tab can reach: through the hub, and directly to the
  // tabs it holds, which the hub may not reach.
  function everywhere(kind) {
    line.hub({ kind: kind });
    [window.opener, opened].forEach(function (w) {
      if (w && !w.closed) line.direct(w)({ kind: kind });
    });
  }
  function hello() { everywhere("hello"); draw(); }

  function answer(m, send) {
    var family = BRIDGE_ASKS[m.what], uin = String(m.uin || "");
    var term = /^\d{6}$/.test(String(m.term || "")) ? String(m.term) : "";
    if (!family || !/^\d{1,12}$/.test(uin))
      return send({ kind: "answer", to: m.from, id: m.id, ok: false,
                    error: "not something the bridge answers" });
    return warmProfile(uin, term).then(function () {
      return askStudentHost(family, "studentId=" + encodeURIComponent(uin));
    }).then(function (j) {
      answered++; draw();
      send({ kind: "answer", to: m.from, id: m.id, ok: true, data: j });
    }, function (e) {
      send({ kind: "answer", to: m.from, id: m.id, ok: false, status: e.status || null,
             error: e.message || String(e) });
    });
  }

  // No console has answered: open one. A console that opened this tab, by
  // Fetch, answered long before now; any other opener, such as the page the
  // bookmark was clicked on anywhere but Banner, has nothing to answer with.
  function decide() {
    if (!looking) return;
    looking = false;
    if (!connected()) openConsole();
    draw();
  }

  line = bridgeLine(function () { return faculty; }, function (m, via) {
    if (m.kind === "ack") { consoles[m.from] = via; looking = false; draw(); return; }
    // A console starting up: answer now, not at the next beat.
    if (m.kind === "ping") { via.send({ kind: "hello", to: m.from }); return; }
    if (m.kind === "bye") { delete consoles[m.from]; draw(); return; }
    if (m.kind === "ask") {
      // At once, so the console can tell a slow Banner from a closed tab.
      via.send({ kind: "took", to: m.from, id: m.id });
      queue = queue.then(function () { return answer(m, via.send); }).catch(function () {});
    }
  }, function () {
    hello();
    setTimeout(decide, BRIDGE_LOOK);
  });

  function stop() {
    looking = false;
    document.removeEventListener("visibilitychange", draw);
    if (beat) clearInterval(beat);
    everywhere("bye");
    line.close();
    strip.remove();
  }

  strip.bpAgain = function () {
    hello();
    if (!looking && !connected()) openConsole();
  };

  window.addEventListener("pagehide", function () { everywhere("bye"); });
  // Mostly in the background, where the beat is slowed: catch up when looked at.
  document.addEventListener("visibilitychange", draw);
  hello();                                // directly, until the hub is up
  setTimeout(decide, BRIDGE_LOOK * 3);    // in case the hub never comes up
  beat = setInterval(hello, BRIDGE_BEAT);
}
