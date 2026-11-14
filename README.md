# Banner Plus

Banner holds the data. It just has no screen for the questions you actually ask.

A roster is a grid that scrolls forever, one face at a time. A student's history
is one flat list with no shape. Finding an hour when a group is free means
opening twelve schedules and comparing them by hand. None of that is missing
data — it is missing *joins*, and a page running inside Banner can do them.

Banner Plus is a bookmarklet. Click it on any Faculty Self-Service page and it
opens a workspace over Banner, using the session you are already signed in to;
click it anywhere else and it opens Banner for you. Nothing is installed and
nothing is uploaded.

**[Install it →](https://mgrau.github.io/banner_plus/)**

---

## What it does

**Your classes for a term**, in one list, with enrolment counts. Terms are
filtered to Spring/Summer/Fall, because Banner lists every eight-week session and
medical-school term it knows about and buries the three you teach in.

**Rosters as a grid of faces.** Click one for detail; tick the corner to select.
Or switch to a table — sortable, with resizable columns — when you are reading
rather than recognising.

**A student pane**: photograph, major, college, standing, admit term, the
major they held in every term on record — so a change of major shows — this
term's schedule with rooms, times and instructors, and the full registration
history laid out as a transcript — seasons across, academic years down, newest
first.

**Shared free time.** Select any set of students and get a heatmap of when they
are collectively not in class, with the best windows listed. Pointed at a class
roster it answers the question office hours are really asking. Hovering a slot
names who is free and who is not.

**Groups.** Artificial classes built from students who share no section — a
research group, a set of advisees, everyone who took any of three courses. Tick
students in a roster and make a group of them, tick two classes and combine
their rosters, drag students onto a group in the sidebar, or search by name and
paste UINs. Each way opens the same membership list before saving, because
building a group is not the same as being sure of it. They behave like a roster
everywhere else.

**Printable sheets**: a photo roster with names, UINs and colour-coded majors —
five faces across by default, on a slider in settings, because how big a face
has to be to be recognised is a judgement about your room — and a free-time
sheet.

### Handing a student to the planner

The student pane opens
[semester-planner](https://github.com/mgrau/semester-planner) with that
student's identity and every term of their registration history already in the
link — no clipboard, no pasting, no parser at the far end guessing at columns.

The record travels in the URL's **fragment**, which stays in the browser: it is
not sent in the HTTP request, so it never reaches GitHub's servers.

The planner creates the student if it has never seen them and updates them if it
has, showing the advisor what it would do before doing any of it. It keeps its
own work: an import never touches notes, prior credits, or any term beyond the
last one the link carries.

The payload is built in `bookmarklet/src/55-planner.js` and read by the
planner's `src/lib/import/bannerPlus.ts`. Those two files are a contract between
separately deployed apps, so the shape carries a version and the reader refuses
one it does not know — change either end and change the other.

### About GPA

The GPA under the transcript is the one its letter grades add up to, and the
console says so where it shows it. It is blind to repeats, grade forgiveness and
transfer credit, so it can disagree with the registrar.

The official number lives on the student self-service host, which is a different
origin with no CORS headers — a page on the faculty host cannot read it, and no
amount of cleverness inside that page changes that. What works is running on
both hosts: clicked in a Student Self-Service tab, the bookmark becomes a
bridge, a small strip that reads the registrar's GPA for the console, for every
student you open while it stays open.

Click the bookmark in a Faculty Self-Service tab and in a Student Self-Service
tab, in either order, however the tabs were opened, and they find each other.
Two shortcuts open the second tab for you:

- **Start anywhere, or on the student side.** Clicked anywhere but Banner, the
  bookmark opens Student Self-Service in a new tab. Banner has no page there
  for faculty until a student is picked, so the tab says "Sorry, This page is
  not available." Click the bookmark there anyway: with no console open, it is
  the bridge, and opens Faculty Self-Service; click it there and the console
  comes up connected, with nothing to switch back to. (One tab at a time,
  because Chrome allows one new tab per click. If Chrome blocks Faculty
  Self-Service anyway, click the bookmark again in the student tab.)
- **Start in the console.** **Fetch**, under Registrar's GPA, opens the
  student's profile in a new tab; click the bookmark there, then switch back.

Either way the second tab needs its own click. A page can open a tab on another
origin but never run anything in it — the rule that keeps any website from
scripting your other tabs — so the bookmark click there is the only way in,
short of an extension. It is asked for once, not once per student.

The tabs talk two ways at once: by `postMessage` when one opened the other, and
otherwise through a hub — `hub.html`, published beside `console.js` and framed
out of sight in both tabs — whose copies share a `BroadcastChannel`. The hub is
a static page; nothing passes through GitHub, and the messages stay in the
browser.

The bridge answers Faculty Self-Service and nothing else, going by the origin
the browser reports rather than anything a message claims. It asks for a fixed
list of things by name, one request at a time, and passes a refusal back
rather than retrying it. Without it, the pane offers Fetch, and the profile
link is still one click and always right. `bookmarklet/src/65-bridge.js` has
the details.

## The code

`bookmarklet/src/*.js` are fragments of one program, concatenated in filename
order and wrapped in a single IIFE by `build.py`. Each fragment is valid
JavaScript on its own — they hold function and `var` declarations, never half a
function — so an editor can parse one without the rest, but only the bundle runs.

| | |
| --- | --- |
| `10-core` | constants, DOM and formatting helpers |
| `20-api` | headers, the `/ssb` prefix resolver, GET and POST |
| `30-banner` | one function per endpoint; no DOM |
| `40-domain` | categories, GPA arithmetic, the free/busy map |
| `50-print` | the photo roster and free-time sheets |
| `55-planner` | building a semester-planner import link |
| `60-groups` | artificial classes, stored in localStorage |
| `65-bridge` | on the student host, the whole program: reads the registrar's GPA for the console |
| `70-shell` | the overlay: toolbar, progress, drawer, panes |
| `80-sidebar` | sections and groups, and the group editor |
| `90-roster` | the middle pane, as photos or as a table |
| `100-student` | the student pane and the transcript grid |
| `105-course` | the floating course pane — switched off; the file says why |
| `110-scheduling` | shared free time |
| `120-load` | opening a section or a group |
| `130-boot` | terms, and starting up |

Files 10–60 touch no DOM and 70 onwards draw. The split falls there because a
change to how Banner answers should never be a change to how anything looks.
It is also where the bundle stops on the student host: `build.py` writes one
line at that seam, and there the program is the bridge in `65-bridge`, with
none of the console drawn.

## Working on it

```bash
python3 bookmarklet/devserve.py
```

Open <http://127.0.0.1:8765/> and drag the dev link to your bookmarks bar once.
Then: edit a file in `src/`, save, click the bookmark. No pasting, no rebuild, no
push. The dev server bundles on every request, so a fragment that fails to parse
fails immediately rather than at publish time.

Banner is HTTPS and an HTTPS page normally refuses to load scripts over HTTP, but
loopback is exempt — browsers treat `http://127.0.0.1` as a potentially
trustworthy origin. No certificate needed.

To publish, push to `main`. The Publish workflow runs the test suite, and if it
passes, builds the bundle and deploys it to Pages. A bundle that fails the
suite is never deployed. There is no build step to remember — a commit once sat
in `main` for days without being live because the rebuild was forgotten.

The bookmark loads the script from the site on each click, so everyone who has
it installed is on the new version at their next click, without re-dragging.
That is also why the deploy waits for the tests.

`python3 bookmarklet/build.py` still builds `docs/` locally, if you want to look
at the install page before pushing. `build.py` works out the Pages URL from the git remote and
refuses to write a placeholder into the page — a wrong base ships a bookmark
pointing at a URL that does not exist, and the failure surfaces as "could not
load console.js" on somebody else's machine days later.

Note that `build.py` writes `docs/index.html` as well as the bundle. The tests
call `bundle()` directly for exactly that reason.

## Tests

```bash
python3 test/run.py
python3 test/run.py --only scheduling
```

`test/stub.py` is a pretend Banner — the same endpoints, invented students — and
`test/run.py` drives the built bundle against it in a headless Chrome. Each check
clicks something and asserts on what appears.

It is all end-to-end on purpose. Almost every line here is a reaction to a click,
and the things that have actually broken were a stale path prefix cached from a
404, a drawer that would not close, and an edit that silently deleted a function.
None of those are visible to a unit test of the arithmetic.

The stub gets three things wrong the way Banner does, because each has broken
the console before: `courseList` answers under a key not named for the call, the
`/ssb` prefix is inconsistent, and the session starts cold — `courseList` is 401
until the class-list page has been served, and only that page carries a
synchronizer token. One check therefore starts on a different Banner page
entirely, which is the case that used to need a manual visit to Faculty Class
List first.

It keeps two things as ODU has them, for the GPA bridge: Faculty and Student
Self-Service are different origins on one site, and `console.js` comes from a
third host standing in for GitHub Pages. And its pages believe it is
12 November 2026, so the console opens on Fall 2026 whenever the suite runs.

You can also poke at it by hand:

```bash
python3 bookmarklet/build.py      # the stub serves docs/console.js
python3 test/stub.py
open http://facultyssb.odu.localhost:8801/FacultySelfService/ssb/classListApp/classListPage
```

## Endpoints, and porting this elsewhere

[`ENDPOINTS.md`](ENDPOINTS.md) documents what was found here: what each endpoint
is keyed by, what it returns, and the traps — the lowercase `l` in
`classlistDetail`, `majorCode` masquerading as a second major, the inconsistent
`/ssb` prefix, `404` meaning "no such route" while `401` can be transient.

Everything the console calls is resolved at runtime where it can be, and it
reports what a response actually contained rather than a bare failure. But the
endpoint *names* are ODU's, and another campus may differ. The last section of
`ENDPOINTS.md` is how to find yours; guessing at names failed three times in a
row while building this, and reading what a page actually did worked every time.

## A word about the output

Named students, with photographs, majors, schedules and grades. Treat what it
produces the way you would treat a gradebook. The `.gitignore` excludes `*.pdf`,
`*.html` and `*.csv` by shape so nothing student-identifying can be committed by
accident.

---

The photo roster began as a separate tool for a single job and is still
maintained on its own, for handing to colleagues who want only that:
[photo_roster](https://github.com/mgrau/photo_roster).
