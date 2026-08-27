# Handing a student to the Semester Planner

Banner Plus can open [semester-planner](https://github.com/mgrau/semester_planner)
with a student's whole registration history already in the URL. The planner
creates that student if it has never seen them, and updates them if it has.

This document is the contract between the two. Banner Plus emits it today; the
planner does not read it yet.

---

## The link

```
https://mgrau.github.io/semester-planner/#import=<base64url(JSON)>
```

**A fragment, not a query string.** Everything after `#` stays in the browser:
it is not sent in the HTTP request, so it never reaches GitHub's servers and
never appears in a log. This payload is a named student's transcript, so that
distinction is the whole reason for the choice.

**base64url**: standard base64 over the UTF-8 bytes, with `+` → `-`, `/` → `_`,
and trailing `=` dropped. Plain base64 is not safe here — `/` and `+` are legal
in a fragment but survive round-trips badly, and `=` invites truncation.

A typical four-year transcript encodes to 5–8 KB, well inside every browser's
URL limit. A reader should still refuse a payload over, say, 512 KB rather than
trust an unbounded string.

## The payload

```json
{
  "v": 1,
  "source": "banner-plus",
  "generated": "2026-08-27T14:03:11.000Z",
  "student": {
    "uin": "01234567",
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jdoe001@odu.edu",
    "majors": ["Physics"],
    "college": "College of Sciences",
    "standing": "Junior",
    "admitTerm": { "season": "fall", "year": 2024 },
    "confidential": false
  },
  "terms": [
    {
      "season": "fall",
      "year": 2024,
      "code": "202410",
      "courses": [
        {
          "code": "PHYS 101N",
          "title": "Conceptual Physics",
          "credits": 4,
          "grade": "B+",
          "status": "completed",
          "crn": "10001"
        }
      ]
    }
  ]
}
```

### Envelope

| Field | | |
| --- | --- | --- |
| `v` | number | Format version. `1` today. A reader that does not know the version should refuse rather than guess. |
| `source` | string | Who produced it. `"banner-plus"`. |
| `generated` | string | ISO 8601, UTC. Lets a reader say "this is from three weeks ago". |

### `student`

Everything here comes from Banner and is **claimed, not verified** — a reader
should treat it as a proposal to be confirmed, not as truth to be applied.

| Field | | |
| --- | --- | --- |
| `uin` | string | The eight-digit university ID, leading zeros intact. **The identity key** — see Matching. |
| `firstName`, `lastName` | string | Split from Banner's `LAST, FIRST M` and title-cased. `lastName` is everything before the comma, so compound surnames survive. |
| `email` | string? | |
| `majors` | string[] | Banner's own major text, verbatim and unmapped — `["Physics"]`, `["Physics & Electrical Engn"]`. Primary first, then any secondary curricula. **Mapping these to a program id is the reader's job**, since only the reader knows its own catalog. |
| `college` | string? | |
| `standing` | string? | `"Freshman"` … `"Senior"`. Banner's classification, which is credit-based and can disagree with how long they have been here. |
| `admitTerm` | term? | When they started. Absent for a student Banner has no admit term for. |
| `confidential` | boolean | Banner's directory-information flag. A reader that prints or exports should carry it through. |

### `terms`

One entry per term the student has a registration record for, **oldest first**.
Terms with no registration are simply absent — a reader wanting a contiguous
span fills the gaps itself.

| Field | | |
| --- | --- | --- |
| `season` | string | `"fall" \| "spring" \| "summer" \| "winter"`. |
| `year` | number | **Calendar** year — see below. |
| `code` | string? | Banner's raw term code, for tracing. Not to be parsed by the reader. |
| `courses` | course[] | |

#### Calendar year, not academic year

ODU's term code is `YYYY` + a two-digit part-of-term whose first digit is the
season: `1` fall, `2` spring, `3` summer. **`YYYY` is the academic year**, so
Fall 2026, Spring 2027 and Summer 2027 all carry the prefix `2026`.

`year` in this payload is always the **calendar** year the term falls in.
Spring 2027 is `{ "season": "spring", "year": 2027 }`, from code `202720`.
Getting this wrong shifts two thirds of a transcript by a year, and it is the
single most likely bug on either side of this contract.

Banner Plus takes the season and year from the term's printed description
(`"Spring 2027"`) where there is one, and falls back to decoding the code.

### `courses`

| Field | | |
| --- | --- | --- |
| `code` | string | `"PHYS 101N"` — subject, one space, catalog number. **Suffixes are significant** and must not be stripped: at ODU `N` marks a lab science, `W` writing-intensive, `H` honours, and the catalog lists them as distinct courses. |
| `title` | string? | Banner's title. Useful mainly for a course the reader's catalog does not have — a transfer equivalency, a discontinued course. |
| `credits` | number | |
| `grade` | string? | Banner's final grade, verbatim: `"A"`, `"B+"`, `"P"`, `"W"`. Absent while in progress. Not normalised — a reader that only models A–D should map it and say so. |
| `status` | string | `"completed" \| "in-progress" \| "withdrawn"`. Derived: a withdrawal-shaped registration status or `W` grade is `withdrawn`; no final grade is `in-progress`; anything else is `completed`. |
| `crn` | string? | Banner's section number. Only meaningful within its term. |

---

## What a reader should do with it

Mapping onto semester-planner's model (`src/lib/types.ts`):

**Completed and in-progress coursework becomes `Semester` entries, not
`PriorCredit`s.** Both count toward requirements — `takenFrom()` unions them —
but only a semester records *when*, and "the semesters filled out already" is
the point of the exercise. `priorCredits` stays what it is: transfer, AP, dual
enrolment, and category waivers, none of which Banner's registration history
knows about. The import never writes one.

| Payload | Planner |
| --- | --- |
| `student.uin` | `studentId` |
| `student.firstName` / `lastName` | `firstName` / `lastName`, `name` derived |
| `student.majors` | `programId`, via a mapping the planner owns |
| `student.admitTerm` | `startTerm` / `startYear` |
| `terms[]` | `semesters[]`, `id` as `` `${term}-${year}` `` |
| `terms[].courses[]` | `PlannedCourse[]` |

### Two small additions the planner needs

`PlannedCourse` cannot currently express a course that has already been taken:

```ts
export interface PlannedCourse {
  // ...
  /** Where this slot came from. Absent means an advisor put it there by hand. */
  origin?: 'banner' | 'auto';
  /** Final grade, for a course already completed. Verbatim from the registrar. */
  grade?: string;
  /** completed | in-progress. Absent means planned but not yet taken. */
  status?: 'completed' | 'in-progress';
}
```

`origin` is what makes a re-import safe: without it there is no way to tell a
row this import wrote last month from one the advisor typed, and the merge
below would have to choose between clobbering advisor work and never updating.
The existing `auto?: boolean` is close but means something narrower — placed by
the autopopulate planner — so widening it would lose that distinction.

### Matching

Match on `uin`, compared with leading zeros stripped from both sides, against
`Student.studentId`. Banner writes `01234567`; a record typed by hand may say
`UIN 01234567` or `1234567`, so compare the digit runs, not the strings.

No match → create. One match → update. **More than one match → stop and ask**;
two records with one UIN is a data problem the import should surface, not
silently pick a winner in.

### Merge rules, when the student already exists

The governing rule: **the import owns what Banner knows, and nothing else.**
An advisor's work must survive a re-import, because re-importing after a
registration change is the normal case, not the exception.

Replace:

- Every `Semester` the payload names, but **only the courses in it whose
  `origin` is `'banner'`**. A course an advisor added to a past term stays.
- `firstName`, `lastName`, `email`, `standing` — Banner is authoritative.

Add:

- Semesters the payload names that the student does not have.

Leave alone, always:

- `notes`, `priorCredits`, `placements`, `settings`, `catalogYear`, `id`.
- **Every term after the last one in the payload.** That is the plan — the
  thing the planner exists to hold — and no import should touch it.
- `programId` and `startTerm`/`startYear` once set. Banner's major and admit
  term seed a new record; on an existing one they are a suggestion, and an
  advisor who changed the program did so for a reason. Show the difference,
  do not apply it.

### Before applying it

Show what will happen and let the advisor confirm: create or update, whose
record, how many terms and courses, and anything that disagrees with what is
already stored. The planner already takes this line with pasted transcripts —
"intentionally NOT trusted: every row it produces is shown to the advisor for
confirmation" — and a URL that anyone can construct deserves it more, not less.

Then **clear the fragment** (`history.replaceState`) so a reload does not
re-import, and so a screenshot or a shared URL does not carry a student's
transcript with it.

---

## What this deliberately does not carry

- **Photographs.** They are large, and a degree plan does not need a face.
- **Meeting times, rooms, instructors.** Banner Plus shows them; a plan is
  about terms and credits.
- **Transfer credit, AP, placement.** Banner's registration history is ODU
  coursework. Everything else stays the advisor's to enter.
- **Anything from the student self-service host** — the official GPA, holds,
  test scores. A different origin, unreadable from where Banner Plus runs.

## Version history

**v1** — first. Terms, courses, grades, identity.
