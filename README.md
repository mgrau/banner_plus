# Banner Plus

Banner holds the data. It just has no screen for the questions you actually ask.

A roster is a grid that scrolls forever, one face at a time. A student's history
is one flat list with no shape. Finding an hour when a group is free means
opening twelve schedules and comparing them by hand. None of that is missing
data — it is missing *joins*, and a page running inside Banner can do them.

Banner Plus is a bookmarklet. Click it on any Faculty Self-Service page and it
opens a workspace over Banner, using the session you are already signed in to.
Nothing is installed and nothing is uploaded.

**[Install it →](https://mgrau.github.io/banner_plus/)**

---

## What it does

**Your classes for a term**, in one list, with enrolment counts. Terms are
filtered to Spring/Summer/Fall, because Banner lists every eight-week session and
medical-school term it knows about and buries the three you teach in.

**Rosters as a grid of faces.** Click one for detail; tick the corner to select.
Or switch to a table — sortable, with resizable columns — when you are reading
rather than recognising.

**A student pane**: photograph, major, college, standing, admit term, this
term's schedule with rooms and times, and the full registration history laid out
as a transcript — seasons across, academic years down, newest first.

**Shared free time.** Select any set of students and get a heatmap of when they
are collectively not in class, with the best windows listed. Pointed at a class
roster it answers the question office hours are really asking. Hovering a slot
names who is free and who is not.

**Groups.** Artificial classes built from students who share no section — a
research group, a set of advisees. Search by name, paste UINs, or drag students
in from a class. They behave like a roster everywhere else.

**Printable sheets**: a photo roster with names, UINs and colour-coded majors —
five faces across by default, on a slider in settings, because how big a face
has to be to be recognised is a judgement about your room — and a free-time
sheet.

### Handing a student to the planner

The student pane opens
[semester-planner](https://github.com/mgrau/semester_planner) with that
student's identity and every term of their registration history already in the
link — no clipboard, no pasting, no parser at the far end guessing at columns.

The record travels in the URL's **fragment**, which stays in the browser: it is
not sent in the HTTP request, so it never reaches GitHub's servers. The format
is in [`IMPORT.md`](IMPORT.md), which is the contract between the two apps.

**The planner does not read it yet.** Banner Plus emits the link; `IMPORT.md`
specifies what the planner should do with it, including how to update a student
it already holds without destroying an advisor's work.

### About GPA

The only GPA shown is the one the transcript's letter grades add up to, and the
console says so where it shows it. It is blind to repeats, grade forgiveness and
transfer credit, so it can disagree with the registrar.

The official number lives on the student self-service host, which is a different
origin with no CORS headers — a page on the faculty host cannot read it, and no
amount of cleverness changes that. So the student pane links out to the profile
instead, which is one click and always right.

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
| `70-shell` | the overlay: toolbar, progress, drawer, panes |
| `80-sidebar` | sections and groups, and the group editor |
| `90-roster` | the middle pane, as photos or as a table |
| `100-student` | the student pane and the transcript grid |
| `110-scheduling` | shared free time |
| `120-load` | opening a section or a group |
| `130-boot` | terms, and starting up |

Files 10–60 touch no DOM and 70 onwards draw. The split falls there because a
change to how Banner answers should never be a change to how anything looks.

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

To publish:

```bash
python3 bookmarklet/build.py
git commit -am "rebuild" && git push
```

The bookmark loads the script from the site on each click, so a fix is live
without re-dragging. `build.py` works out the Pages URL from the git remote and
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

You can also poke at it by hand:

```bash
python3 test/stub.py
open http://127.0.0.1:8801/FacultySelfService/ssb/classListApp/classListPage
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
