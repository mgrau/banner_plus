# Banner endpoints, as observed at ODU

Everything here was recorded from live sessions — a `fetch` recorder pasted into
the DevTools console, and pages' own `performance` entries — not from
documentation, which does not exist for these. Field names differ between Banner
versions and between campuses, so treat this as a map of one installation in
2026, not a specification.

The scripts that found all this are not in the repo any more; the findings are.
If you need to do the same somewhere else, the last section says how.

Three things are worth knowing before reading any of it.

**The `/ssb` prefix is inconsistent.** Some families sit under
`/FacultySelfService/ssb/`, others directly under `/FacultySelfService/`. There
is no rule; the tools resolve it per family at runtime by trying `/ssb` first and
falling back. Hardcoding a table is what made an early build find no classes.

**`xyz` is base64 of the PIDM.** `MTQ3OTY5OQ==` is `1479699`. It is obfuscation,
not encryption, and it appears wherever Banner wants to identify a student
without putting a UIN in a URL. `btoa(String(pidm))` produces one.

**Not found is 404; 401 is something else.** A URL Banner does not serve answers
404. A 401 has been seen transiently on a valid endpoint, so it is worth
retrying rather than treating as proof of anything.

Requests should carry `X-Requested-With: XMLHttpRequest` and, where the page has
one, `X-Synchronizer-Token`. Several endpoints answer 401 without them.

---

## Faculty host — `facultyssb-prod.ec.odu.edu`

### Terms and sections

| Endpoint | Keyed by | Returns |
|---|---|---|
| `ssb/studentPagesCommonSearch/fetchTerms` | — | array of `{code, description}`, every part-of-term |
| `ssb/classListApp/terms` (POST, form) | `filter, page, max` | `{terms[], studentCardEnabled}` |
| `ssb/courseList/courseList?term=&filterText=&sortColumn=&sortDirection=&max=&offset=` | term | `{success, length, result[], offset, max}` |
| `ssb/courseList/courseInfoAndEnrollmentCounts?crn=&term=` | crn + term | one course object |
| `ssb/classListApp/courses` (POST, form) | `filterText, page, max, term` | bare array of courses |

A `courseList` row carries more than a course code:

```
courseReferenceNumber  subjectCode  courseNumber  courseSection  courseTitle
courseEnrolmentCount   maxEnrollmentCount  seatsAvailCount
waitListCount  waitListCapacityCount  waitListAvailCount
classlistEnabled  waitlistEnabled  courseStatus
courseTerm  courseTermDesc  formattedSubject  formattedTerm
courseStartDate  courseEndDate  courseDuration  isOpenLearningCourse
```

**Standard terms** are the ones whose code ends `10` (Fall), `20` (Spring) or
`30` (Summer) *and* whose description is exactly a season and a year. The year in
the code is the academic year: `202610` is Fall 2026, and Spring 2027 and Summer
2027 share the `2026` prefix. Everything else is a part-of-term — eight-week
sessions, medical-school terms — and there are many.

### Rosters

`ssb/classList/classListDetail?term=&crn=&filterText=&sortColumn=studentName&sortDirection=asc&max=500&offset=0`

`max=500` returns the whole roster in one request, which is what makes the
virtualized-grid truncation problem disappear. The envelope is

```json
{ "success": true, "classlistSummary": [ … ], "classlistDetail": [ … ] }
```

Note the **lowercase `l`** in `classlist*` — it does not match the endpoint's own
camel-cased name. The two arrays are parallel and same-length.

**Summary rows** (identity):

```
bannerId  bannerIdUpper  studentName  studentNameUpper  studentPidm
classDescription  levelCode  levelDescription  creditHours  emailAddress
confidentialIndicator  registrationDesc  registrationStatus  registrationSequence
gradeMidTerm  gradeFinal  olrStartDate  olrEndDate  termCode  courseReferenceNumber
```

**Detail rows** (curriculum): `pidm`, `term`, `classCode`, `classDescription`,
`primaryCurriculum{…}`, `secondaryCurricula[]`. A curriculum holds

```
college  collegeCode  campus  campusCode  degree  degreeCode  level  levelCode
program  programCode  admitType  termAdmit  termAdmitCode  termCatalog
majorFieldsOfStudy[]  minorFieldsOfStudy[]  concentrationFieldsOfStudy[]
```

Each `majorFieldsOfStudy` entry has both `major` ("Nuclear Medicine Technol") and
`majorCode` ("NMED"). **Match the exact key `major`.** A `/major/i` pattern also
catches `majorCode` and gives every student a second, invented major — wrong data
that renders perfectly.

Double majors arrive as a second `secondaryCurricula` entry, not as a second
entry in the same array.

`ssb/classList/classListSummary?…` is the same summary data under a different
envelope: `{success, length, result[], offset, max}`.

### Photos

| Endpoint | Keyed by | Note |
|---|---|---|
| `ssb/studentContactCardPicture/picture?bannerId=` | bannerId **only** | works for anyone |
| `ssb/classListPicture/picture?bannerId=&crn=&term=` | bannerId + section | only for your own sections |

The first is the useful one: no CRN means a photo is available for a student who
is in none of your classes. Returns JPEG bytes, or 404 when there is no photo on
file — which is a fact about the student, not about the route, and must not be
read as "wrong endpoint".

Students with no photo get Banner's grey silhouette, which is a real image rather
than a missing one.

### Student detail

| Endpoint | Keyed by |
|---|---|
| `ssb/studentContactCard/retrieveData?bannerId=&termCode=` | bannerId — **no CRN** |
| `ssb/classListStudentCard/retrieveData?bannerId=&termCode=&crn=` | bannerId + section |
| `ssb/studentDetails/curriculum?term=&crn=&bannerId=` | bannerId + section |

`studentContactCard` is the one that answers for anybody. Its payload is
`data.contactCard`:

```
bannerId  firstName  middleName  lastName  surnamePrefix  displayName
isConfidentialStudent
primaryProgram  primaryMajor
emailAddress
telephoneNumber {
  phoneArea  phoneNumber  phoneExtension  displayPhone  internationalAccess
  primaryIndicator  unlistIndicator  sequenceNumber
  telephoneType { code, description }        e.g. PR / "Permanent"
}
address {
  streetLine1  streetLine2  streetLine3  streetLine4
  city  zip  houseNumber
  state { code, description }
  county { code, description, fipsCode }
  nation { code, nation, scodIso, ediEquiv, … }
  addressType { code, description }           e.g. CU / "Current"
  fromDate  toDate  dataOrigin  userData
}
```

**The console reads only** `primaryMajor`, `primaryProgram`, `emailAddress`,
`isConfidentialStudent` and `displayName`. The home address and telephone are
deliberately not stored: nothing in the tool displays them, and holding a
student's home address in memory to show a photo roster is not a trade worth
making. They are documented here so nobody has to re-discover the payload, not
because they are wanted.

`data.contactCardConfig[]` lists which card fields the institution has enabled.

### Registration history

`ssb/registrationHistory/fetchRegistrationHistory` (POST, JSON `{term, xyz}`)

Returns the student's **entire** registration history — every term, not the one
named in the request:

```json
{ "registrationGrid": { "result": [ … ], "success": true, "length": 27 },
  "studentProfile": { "name": …, "bannerId": … },
  "term": "202610" }
```

Each row: `term`, `termCode`, `crn`, `course`, `courseTitle`, `subjectCode`,
`courseNumber`, `credits`, `level`, `status`, `midtermGrade`, `finalGrade`,
`studyPath`.

This is the richest single call on the faculty side — a whole transcript, with
grades and credits, for one request.

### Meeting times

`sectionDetails/getFacultyMeetingTimes?term=&courseReferenceNumber=` — note **no
`/ssb`**.

```
fmt[].meetingTime {
  monday … sunday (booleans)  beginTime  endTime      e.g. "1630"
  building  buildingDescription  room  campus  campusDescription
  startDate  endDate  hoursWeek  meetingType  meetingTypeDescription
}
fmt[].faculty[] { bannerId, displayName, emailAddress, primaryIndicator }
```

Keyed by section rather than by student, so one fetch per CRN serves everyone
enrolled in it. For a class of eighty that is a handful of calls, not eighty.

Both halves are read. `faculty[]` is where the instructor's name comes from, so
naming who teaches a course costs no extra request — and `primaryIndicator`
matters, because Banner does not promise the array's order and a section with a
teaching assistant listed first would otherwise name the wrong person.

The two halves are independent: a section can have faculty and no
`meetingTime`, or times and no faculty. Both are ordinary.

### Course and section detail

**Nothing calls these at present.** The pane that used them is switched off:
clicking a course fired six of them at once plus the enrolment call, and
something in that upset Banner itself rather than only this console. The
findings are kept because they are correct as far as they go and the fix is
likely to be which calls are made rather than what they return — but treat this
section as a map to somewhere with a hole in the road. `bookmarklet/src/105-course.js`
has the suspects and the order to test them in.

| Endpoint | Keyed by |
|---|---|
| `courseDetails/getCourseDescription` | term + crn |
| `courseDetails/getPrerequisites` | term + crn |
| `courseDetails/getCorequisites` | term + crn |
| `courseDetails/getRestrictions` | term + crn |
| `courseDetails/getCourseAttributes` | term + crn |
| `sectionDetails/getClassDetails` | term + crn |

All take `?term=&courseReferenceNumber=` and **no `/ssb`**, and all answer with
an **HTML fragment**, not JSON — Banner drops them straight into its own modal.
An empty body means "nothing on file", which is an answer rather than a failure.

Two consequences worth knowing. A response is markup from a server, so it is
turned into text rather than injected — an `<img onerror>` in a fragment would
otherwise run inside the console. And a 200 carrying a whole HTML document is
the app shell or a login page, so it has to be rejected in the same breath: a
wrong route that answers 200 instead of 404 teaches the prefix resolver the
wrong prefix, which is the photo trap in different clothes.

Seats come from `courseList/courseInfoAndEnrollmentCounts?crn=&term=` in the
table above, which is JSON. It answers for sections you teach — a student's
other courses are someone else's class, so nothing there is expected. That
asymmetry is the leading suspect for the breakage above: asking a faculty
endpoint about a section you do not teach is the kind of thing Banner may treat
as an access violation rather than as an empty answer.

### Student search

`ssb/studentPagesCommonSearch/searchResults` (POST, JSON)

```json
{ "term": "202610", "id": "<uin>", "firstName": "", "lastName": "", "searchType": "…" }
```

Returns `{success, result[], length}` where each row is
`{id, firstName, lastName, name, type, xyz}`. This is how a UIN becomes an `xyz`
handle. Match `id` exactly — a partial search returns neighbours, and quietly
acting on the wrong student is the worst failure available here.

`searchType` was not captured in any recording. The console probes a candidate
list — `Advisee`, `Student`, lowercase variants, then empty — and remembers the
first that returns rows.

### Other routes seen but not used

```
ssb/searchStudent/getProfileDetails          → studentProfileUrl (the other host)
ssb/registrationOverrides/fetchOverrides
ssb/classList/studentsEmailAddresses?term=&crn=
ssb/classListExport/exportExcel?term=&crn=&format=
ssb/waitlist/waitlistDetail  ·  ssb/waitlist/waitlist
facultyAttendanceTracking
courseDetails/*      getFees, getSyllabus
sectionDetails/*     getEnrollmentInfo, getLinkedSections, getXlstSections,
                     getSectionPrerequisites, getFees
```

The `courseDetails` and `sectionDetails` families return HTML fragments rather
than JSON, except `getFacultyMeetingTimes`. The six of them the course pane
does read are in their own section above.

---

## Student host — `studentssb-prod.ec.odu.edu`

**A different origin.** A page on the faculty host cannot read any of these:
no CORS headers, so the browser fetches the response and then refuses to hand it
to JavaScript. `postMessage` from a script running on this host is the only way
across, and it costs a second click on a second window — which is why the
console links out to the profile instead and computes its own GPA from the
grades it can see.

| Endpoint | Keyed by | Returns |
|---|---|---|
| `StudentSelfService/studentProfile/viewGPAHoursList?studentId=` | UIN, no term | GPA per level plus a total |
| `StudentSelfService/studentProfile/viewRegisteredCourseList?studentId=` | UIN | current registration |
| `StudentSelfService/studentProfile/renderCurriculumTemplate?studentId=` | UIN | HTML fragment |
| `StudentSelfService/studentProfile/viewRegistrationNotices?studentId=` | UIN | notices |
| `StudentSelfService/studentHolds/getHoldsCountCacheHolds?studentId=` | UIN | holds count |
| `StudentSelfService/ssb/studentPicture/picture?bannerId=` | bannerId | JPEG |
| `StudentSelfService/priorEducationAndTesting/getTestScores?studentId=` | UIN | test scores |
| `StudentSelfService/priorEducationAndTesting/getTestsPinAccess?studentId=` | UIN | `{pinResult, count}` |

`viewGPAHoursList` returns several figures — a GPA per level and a total — so
whichever consumer reads it has to choose, and should say which it chose.

A test-score row carries `testDate`, `testScore`, and a `testScoreCode` object
with `code` ("A01"), `description` ("ACT English"), and the valid range.

**GPA is not available anywhere on the faculty host.** Three working endpoints
carry nothing GPA-shaped, seven plausible names 404, and the faculty JavaScript
bundles contain no GPA route. Banner keeps it here on purpose.

---

## How to find the next one

In rough order of how well it has worked:

1. **Read what the page already did.** `performance.getEntriesByType("resource")`
   lists every URL a page requested, whether or not a recorder was installed.
   Use the page normally, then read the list:

   ```js
   performance.getEntriesByType("resource")
     .map(e => e.name).filter(n => /ssb|Service/.test(n))
   ```

   This found the contact-card photo endpoint after five guessed names failed,
   and the GPA endpoint, which happens during page load and so cannot be
   recorded any other way.
2. **Record it live.** Patch `fetch` and `XMLHttpRequest` before using the page,
   and log URLs, request bodies and response shapes. Redact identifiers before
   pasting anything anywhere: the finding is the field path, not the student.
   This has to be installed *before* the calls it should see, which rules it out
   for anything that happens during page load.
3. **Read the app's own JavaScript.** Every route the app calls is a string in a
   bundle. This is how `classListDetail` was found originally.
4. **Guess a name.** Three attempts this way produced three wrong answers. It is
   listed for completeness, not recommended.
