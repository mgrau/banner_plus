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

**Printable sheets**: a photo roster with colour-coded majors, auto-fitted so the
faces are as large as the page budget allows, and a free-time sheet.

## Official GPAs

ODU splits Banner across two hostnames. Rosters and registration history live on
`facultyssb`; the student profile — the only place with an official GPA — lives
on `studentssb`. Those are different origins, so the console can neither fetch
that page nor read it in a frame. No CORS headers, and no amount of cleverness
changes that.

`gpa-bridge.js` is the other half. The console opens a window on the student
host; you click the bridge there; it looks up each student and posts the results
back. Cross-origin `postMessage` is permitted where reading is not.

Two clicks, and the browser leaves no shorter path. A userscript could remove the
second one, at the cost of an extension install.

## Discovery kit

Banner's internal endpoints are undocumented and differ by version and by what a
campus turns on. Guessing at them failed three times in a row while building
this; reading what a page actually did worked every time. So the kit is the
durable part:

| Script | For |
| --- | --- |
| `spy.js` | Records every call a page makes while you use it. |
| `probe.js` | Checks an install has the fields the console needs. |
| `diagnose.js` | Dumps a response's shape when something answers unexpectedly. |
| `probe-profile.js` | Finds which endpoint serves a student profile's data. |
| `probe-photo.js` | Finds a photo endpoint that does not need a section. |
| `probe-courselist.js` | Why a course list came back empty or refused. |
| `probe-gpa.js` | Looks for a GPA in responses already being received. |

All read-only. All redact identifiers before reporting, because the finding is
the field path, not the student.

[`ENDPOINTS.md`](ENDPOINTS.md) is what they found here: what each endpoint is
keyed by, what it returns, and the traps — the lowercase `l` in
`classlistDetail`, `majorCode` masquerading as a second major, the inconsistent
`/ssb` prefix, `404` meaning "no such route" while `401` can be transient.

## Working on it

```bash
python3 bookmarklet/devserve.py
```

Open <http://127.0.0.1:8765/> and drag a dev link to your bookmarks bar once.
Then: edit, save, click the bookmark. No pasting, no rebuild, no push.

Banner is HTTPS and an HTTPS page normally refuses to load scripts over HTTP, but
loopback is exempt — browsers treat `http://127.0.0.1` as a potentially
trustworthy origin. No certificate needed.

To publish:

```bash
python3 bookmarklet/build.py --base https://mgrau.github.io/banner_plus
git commit -am "rebuild" && git push
```

Bookmarks load the script from the site each click, so a fix is live without
re-dragging.

## Portability

Written against Banner 9 at ODU. Everything the console calls is resolved at
runtime where it can be — the `/ssb` prefix is discovered per endpoint family,
field names are read from known paths with looser fallbacks — but the endpoint
*names* are ODU's, and another campus may differ. If it comes up empty
somewhere, the kit above is how you find out why, and the console reports what a
response actually contained rather than a bare failure.

## A word about the output

Named students, with photographs, majors, schedules and grades. Treat what it
produces the way you would treat a gradebook. The `.gitignore` excludes `*.pdf`,
`*.html` and `*.csv` by shape so nothing student-identifying can be committed by
accident.

---

The photo roster began as a separate tool for a single job and is still
maintained on its own, for handing to colleagues who want only that:
[photo_roster](https://github.com/mgrau/photo_roster).
