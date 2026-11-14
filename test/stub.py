#!/usr/bin/env python3
"""A pretend Banner, just real enough to drive the console against.

Serves the endpoints console.js calls, with made-up students, and the page the
bookmarklet is clicked on. Started by run.py; runnable on its own if you want
to poke at the console by hand:

    python3 test/stub.py --port 8801
    open http://facultyssb.odu.localhost:8801/FacultySelfService/ssb/classListApp/classListPage

The data is invented. Nothing here touches a real Banner and nothing here is a
real student.

WHAT IT DELIBERATELY GETS WRONG

Four things, because the console has been broken by all four:

  * courseList answers under "result", not "courseList", and uses subjectCode
    where other endpoints use subject.
  * Half the endpoints live under /ssb and half do not, so the prefix resolver
    has something to resolve. A wrong prefix 404s, as it does in Banner.
  * The session starts cold. courseList answers 401 until the class-list page
    has been served, and only that page carries a synchronizer token — so a
    console clicked anywhere else in Faculty Self-Service has to wake the app
    up before it can ask anything. /menu is that "anywhere else".
  * Student Self-Service has no page for faculty until a student is picked.
    The profile with no studentId forwards to the class list Banner would show
    in Faculty Self-Service, which this host does not have, so the bookmark
    clicked anywhere else lands on "Sorry, This page is not available." That
    page carries no token, and the GPA answers 401 until a profile has been
    served, so a bridge clicked there has to wake the profile up first. And
    the profile holds one student: asked about anyone else, the GPA is a 404.

HOSTS

All on one port, told apart by name; Chrome resolves anything under localhost
to loopback by itself.

  facultyssb.odu.localhost   Faculty Self-Service
  studentssb.odu.localhost   Student Self-Service
  other.odu.localhost        not Banner: somebody else's page, for checking
                             that the bridge will not answer it, and a page
                             to click the bookmark on
  pages.localhost            where console.js and hub.html come from

The first three are different origins on one site, as ODU's hosts are. The
student host sends no CORS headers, so the only way to its GPA is the bridge.
The fourth stands in for GitHub Pages, a site of its own: the hub works only
because a page framed in tabs of one site shares a BroadcastChannel across
them, and a stub that served the hub from the page's own host would test
nothing of the kind.
"""

from __future__ import annotations

import argparse
import base64
import http.server
import json
import re
import sys
import threading
from urllib.parse import parse_qs, urlparse

# Newest first, as Banner lists them, and months ahead: Spring and Summer 2027
# are there while Fall 2026 is still being taught. See TODAY.
TERMS = [
    {"code": "202630", "description": "Summer 2027"},
    {"code": "202620", "description": "Spring 2027"},
    {"code": "202610", "description": "Fall 2026"},
    {"code": "202520", "description": "Spring 2026"},
    {"code": "202530", "description": "Summer 2026"},
    {"code": "202617", "description": "Fall 2026 Second Eight Weeks"},   # must be hidden
]

SECTIONS = {
    "202610": [
        {"courseReferenceNumber": "10001", "subjectCode": "PHYS", "courseNumber": "101",
         "courseSection": "1", "courseTitle": "Introductory Physics",
         "courseEnrolmentCount": 3, "classlistEnabled": True},
        # A second class with students in it, sharing one of PHYS 101's — so a
        # group built from both has to combine them without counting anyone
        # twice.
        {"courseReferenceNumber": "10003", "subjectCode": "PHYS", "courseNumber": "226",
         "courseSection": "1", "courseTitle": "Physics Laboratory",
         "courseEnrolmentCount": 2, "classlistEnabled": True},
        {"courseReferenceNumber": "10002", "subjectCode": "PHYS", "courseNumber": "420",
         "courseSection": "0", "courseTitle": "Quantum Mechanics",
         "courseEnrolmentCount": 0, "classlistEnabled": True},
    ],
    "202520": [
        {"courseReferenceNumber": "20001", "subjectCode": "PHYS", "courseNumber": "232",
         "courseSection": "1", "courseTitle": "Modern Physics",
         "courseEnrolmentCount": 2, "classlistEnabled": True},
    ],
}

# pidm -> record. The console derives xyz as base64(pidm), the way Banner does.
STUDENTS = {
    "900001": {"uin": "01234567", "name": "DOE, JANE A", "major": "Physics",
               "college": "Sciences", "admit": "Fall 2024", "standing": "Junior",
               "email": "jdoe001@odu.edu", "confidential": False},
    "900002": {"uin": "01234568", "name": "SMITH, JOHN", "major": "Astrophysics",
               "college": "Sciences", "admit": "Summer 2024", "standing": "Senior",
               "email": "jsmit002@odu.edu", "confidential": True},
    "900003": {"uin": "01234569", "name": "O'BRIEN, MARY-JO", "major": "Physics",
               "college": "Sciences", "admit": "Spring 2025", "standing": "Sophomore",
               "email": "mobri003@odu.edu", "confidential": False},
    # Not in any of "my" sections: only reachable by UIN, which is what a group is.
    "900004": {"uin": "01234570", "name": "NGUYEN, LINH", "major": "Chemistry",
               "college": "Sciences", "admit": "Fall 2025", "standing": "Freshman",
               "email": "lnguy004@odu.edu", "confidential": False},
}

ROSTERS = {"10001": ["900001", "900002", "900003"], "20001": ["900001", "900003"],
           # Shares 900002 with PHYS 101 and brings 900004, who is in neither
           # of the other Fall sections.
           "10003": ["900002", "900004"]}

# pidm -> [course]. crn 10001/10002 have meeting times; 30001 deliberately does not.
HISTORY = {
    "900001": [
        {"termCode": "202610", "term": "Fall 2026", "crn": "10001", "course": "PHYS 101",
         "courseTitle": "Introductory Physics", "credits": "4", "finalGrade": ""},
        {"termCode": "202520", "term": "Spring 2026", "crn": "20001", "course": "PHYS 232",
         "courseTitle": "Modern Physics", "credits": "3", "finalGrade": "A"},
        {"termCode": "202430", "term": "Summer 2025", "crn": "30001", "course": "MATH 211",
         "courseTitle": "Calculus I", "credits": "4", "finalGrade": "B+"},
    ],
    "900002": [
        {"termCode": "202610", "term": "Fall 2026", "crn": "10002", "course": "PHYS 420",
         "courseTitle": "Quantum Mechanics", "credits": "3", "finalGrade": ""},
        {"termCode": "202610", "term": "Fall 2026", "crn": "10003", "course": "PHYS 226",
         "courseTitle": "Physics Laboratory", "credits": "1", "finalGrade": ""},
        {"termCode": "202520", "term": "Spring 2026", "crn": "20001", "course": "PHYS 232",
         "courseTitle": "Modern Physics", "credits": "3", "finalGrade": "B"},
    ],
    "900003": [
        {"termCode": "202610", "term": "Fall 2026", "crn": "10001", "course": "PHYS 101",
         "courseTitle": "Introductory Physics", "credits": "4", "finalGrade": ""},
    ],
    "900004": [
        {"termCode": "202610", "term": "Fall 2026", "crn": "10002", "course": "PHYS 420",
         "courseTitle": "Quantum Mechanics", "credits": "3", "finalGrade": ""},
        {"termCode": "202610", "term": "Fall 2026", "crn": "10003", "course": "PHYS 226",
         "courseTitle": "Physics Laboratory", "credits": "1", "finalGrade": ""},
    ],
}

# pidm -> {termCode: major}, for a student whose major changed. Any term not
# listed answers with the major in STUDENTS. Jane started in Biology.
MAJOR_BY_TERM = {"900001": {"202430": "Biology"}}

MEETINGS = {
    "10001": {"monday": True, "wednesday": True, "friday": True,
              "beginTime": "0900", "endTime": "0950",
              "buildingDescription": "Oceanography", "room": "200"},
    "10002": {"tuesday": True, "thursday": True,
              "beginTime": "1300", "endTime": "1415",
              "buildingDescription": "Oceanography", "room": "301"},
    "20001": {"monday": True, "wednesday": True,
              "beginTime": "1100", "endTime": "1215",
              "buildingDescription": "Oceanography", "room": "108"},
    # Deliberately clear of Monday morning: the free-time check reads Mon 9am
    # and expects exactly one of PHYS 101's three to be free then.
    "10003": {"tuesday": True, "thursday": True,
              "beginTime": "1000", "endTime": "1150",
              "buildingDescription": "Oceanography", "room": "12"},
}

# crn -> who teaches it, riding along in the same fmt[] as the meeting times.
# 10001 lists its primary instructor second, because Banner promises no order
# and a console that trusts the array's would name the assistant.
# 30001 has faculty and no meeting time at all — an independent study, or a
# section nobody has scheduled yet — which is a shape the parser has to survive.
FACULTY = {
    "10001": [{"bannerId": "00900101", "displayName": "OKAFOR, ADAEZE",
               "emailAddress": "aokafor@odu.edu", "primaryIndicator": False},
              {"bannerId": "00900100", "displayName": "GRAU, MATTHEW",
               "emailAddress": "mgrau@odu.edu", "primaryIndicator": True}],
    "10002": [{"bannerId": "00900100", "displayName": "GRAU, MATTHEW",
               "emailAddress": "mgrau@odu.edu", "primaryIndicator": True}],
    "10003": [{"bannerId": "00900101", "displayName": "OKAFOR, ADAEZE",
               "emailAddress": "aokafor@odu.edu", "primaryIndicator": True}],
    "20001": [{"bannerId": "00900102", "displayName": "VAN DER BERG, PIETER",
               "emailAddress": "pvander@odu.edu", "primaryIndicator": True}],
    "30001": [{"bannerId": "00900103", "displayName": "REYES, CARMEN",
               "emailAddress": "creyes@odu.edu", "primaryIndicator": True}],
}

# crn -> the HTML fragments Banner hands its own course-detail modal. Markup,
# not JSON, and labelled inside the fragment the way Banner labels them.
COURSE_DETAIL = {
    "10001": {
        "getCourseDescription":
            "<section>Newtonian mechanics for scientists and engineers: kinematics, "
            "forces, work and energy, and momentum.<br>Laboratory required.</section>",
        "getPrerequisites":
            "<span class='status-bold'>Prerequisites: </span>MATH 162M with a minimum grade of C.",
        "getRestrictions":
            "<div>Must be enrolled in one of the following Levels:</div><div>Undergraduate</div>",
        "getCourseAttributes": "<div>Natural Sciences General Education</div>",
        "getClassDetails":
            "<span>Associated Term: </span>Fall 2026<br><span>CRN: </span>10001<br>"
            "<span>Campus: </span>Norfolk<br><span>Schedule Type: </span>Lecture<br>",
    },
    "10002": {
        "getCourseDescription":
            "<section>Wave mechanics, the Schr&ouml;dinger equation, and angular momentum.</section>",
    },
    # A past course, reachable only from the transcript. No prerequisites on
    # file: an empty body is Banner saying "none", not a failure.
    "30001": {
        "getCourseDescription":
            "<section>Limits, derivatives and integrals of functions of one variable.</section>",
        "getPrerequisites": "",
    },
}

# pidm -> the registrar's figures, under the field names viewGPAHoursList
# was seen to send. The values are invented, and so is the name of the list:
# the envelope around the rows was not recorded.
GPA = {
    "900001": {"overallGpa": "3.42", "overallHours": "41", "gpaHoursList": [
        {"gpa": "3.42", "hours": "11", "hoursAttempted": "11", "levelDesc": "Undergraduate",
         "typeDesc": "Institution", "gpaTypeIndicatorDesc": "Institution"},
        {"gpa": "0.00", "hours": "30", "hoursAttempted": "30", "levelDesc": "Undergraduate",
         "typeDesc": "Transfer", "gpaTypeIndicatorDesc": "Transfer"},
        {"gpa": "3.42", "hours": "41", "hoursAttempted": "41", "levelDesc": "Undergraduate",
         "typeDesc": "Overall", "gpaTypeIndicatorDesc": "Overall"}]},
    "900002": {"overallGpa": "2.87", "overallHours": "96", "gpaHoursList": [
        {"gpa": "2.87", "hours": "96", "hoursAttempted": "99", "levelDesc": "Undergraduate",
         "typeDesc": "Institution", "gpaTypeIndicatorDesc": "Institution"},
        {"gpa": "2.87", "hours": "96", "hoursAttempted": "99", "levelDesc": "Undergraduate",
         "typeDesc": "Overall", "gpaTypeIndicatorDesc": "Overall"}]},
}

# A 1x1 PNG. Enough for the console to accept as an image and draw.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

# The day the faculty pages believe it is: in Fall 2026, with Spring and Summer
# 2027 already listed. The console opens on the term under way, and every check
# that opens a Fall 2026 class relies on that being Fall 2026 whenever the
# suite runs.
TODAY = "2026-11-12T12:00:00"

# Moves the page's clock to TODAY before the console loads. Shifted, not
# frozen: waitFor() times its timeouts with it.
CLOCK = """<script>(() => {
  const Real = Date, shift = new Real("%s").getTime() - Real.now();
  function D(...a) {
    if (!new.target) return new Real(Real.now() + shift).toString();
    return a.length ? new Real(...a) : new Real(Real.now() + shift);
  }
  D.prototype = Real.prototype;
  D.now = () => Real.now() + shift;
  D.parse = Real.parse;
  D.UTC = Real.UTC;
  window.Date = D;
})();</script>""" % TODAY


def page(title: str, token: str | None, pages: str, scripts: bool = True) -> str:
    return ("<!doctype html><html><head><meta charset=\"utf-8\">" +
            (f'<meta name="synchronizerToken" content="{token}">' if token else "") +
            f"<title>{title}</title></head>"
            f"<body><h1>Banner (stub)</h1><div id=\"page\">{title}</div>" +
            (CLOCK + f'<script src="{pages}/console.js"></script><script src="/check.js"></script>'
             if scripts else "") +
            "</body></html>")


def not_available_page(pages: str) -> str:
    """What Student Self-Service shows faculty with no student picked: an error
    page, with no token. The bridge is clicked here when the bookmark was
    clicked anywhere else first; the script stands in for that click."""
    return ('<!doctype html><html><head><meta charset="utf-8">'
            "<title>Page Not Found</title></head>"
            '<body><h1>Banner (stub)</h1><div id="page">Sorry, This page is not available.</div>'
            f'<script src="{pages}/console.js"></script></body></html>')


def student_page(pages: str) -> str:
    """Student Self-Service, as the bookmark finds it there. The console
    script stands in for the click, as it does in page(); the check does not
    load here, because checks run in the faculty tab."""
    return ('<!doctype html><html><head><meta charset="utf-8">'
            '<meta name="synchronizerToken" content="STUDENTTOKEN">'
            "<title>Student Profile</title></head>"
            '<body><h1>Banner (stub)</h1><div id="page">Student Profile</div>'
            f'<script src="{pages}/console.js"></script></body></html>')


# Somebody else's page, on a third origin of the same site. It opens a student
# profile itself, which runs the bridge there, and asks it for a GPA the way the
# console would: directly, and through a hub of its own. Sharing the site, its
# hub shares the bridge's channel. The bridge must not answer, or even say
# hello, and the hub must hand this page nothing. It reports what it got back
# to the check that opened it.
def other_page(pages: str) -> str:
    return """<!doctype html><meta charset="utf-8"><title>Somebody else's page</title>
<body><script>
(async () => {
  const student = location.origin.replace("other.", "studentssb.");
  const pages = "%s";
  let hellos = 0, answers = 0, heard = 0;
  const hub = document.createElement("iframe");
  hub.src = pages + "/hub.html";
  document.body.appendChild(hub);
  await new Promise((r) => { hub.onload = r; });
  addEventListener("message", (ev) => {
    if (ev.source === hub.contentWindow) { heard++; return; }
    if (ev.origin !== student || !ev.data) return;
    if (ev.data.kind === "hello") hellos++;
    if (ev.data.kind === "answer") answers++;
  });
  const w = window.open(student + "/StudentSelfService/ssb/studentProfile?studentId=01234567");
  const ask = (i) => ({ bp: 2, kind: "ask", from: "other", id: i, what: "gpa", uin: "01234567" });
  // Opening the profile puts this page in the background, where Chrome runs
  // its timers about once a second, so a few asks spread over several seconds.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { w.postMessage(ask(i), student); } catch (e) {}
    hub.contentWindow.postMessage({ toOrigin: student, m: ask(100 + i) }, pages);
  }
  await new Promise((r) => setTimeout(r, 1500));
  opener.postMessage({ otherPage: true, hellos, answers, heard }, "*");
})();
</script>""" % pages


# A page that isn't Banner's, where the bookmark is clicked. The bookmark's own
# code stands in for the click, as console.js does on the Banner pages.
def elsewhere_page(bookmark: str) -> str:
    return ('<!doctype html><meta charset="utf-8"><title>Somewhere else</title>'
            f"<body><h1>Not Banner</h1><script>{bookmark}</script></body>")


def pidm_of(uin: str) -> str | None:
    for p, s in STUDENTS.items():
        if s["uin"].lstrip("0") == str(uin).lstrip("0"):
            return p
    return None


def curriculum(pidm: str) -> dict:
    s = STUDENTS[pidm]
    return {"primaryCurriculum": {"majorFieldsOfStudy": [{"major": s["major"]}],
                                  "college": s["college"], "termAdmit": s["admit"]},
            "secondaryCurricula": []}


class Handler(http.server.BaseHTTPRequestHandler):
    # Which prefix each family answers on, so the resolver has real work to do.
    SSB = {"classList/classListDetail", "courseList/courseList",
           "courseList/courseInfoAndEnrollmentCounts",
           "studentPagesCommonSearch/fetchTerms",
           "studentPagesCommonSearch/searchResults",
           "registrationHistory/fetchRegistrationHistory",
           "studentContactCardPicture/picture", "classListPicture/picture"}
    ROOT = {"sectionDetails/getFacultyMeetingTimes", "sectionDetails/getClassDetails",
            "searchStudent/getProfileDetails",
            "studentContactCard/retrieveData", "studentDetails/curriculum",
            "courseDetails/getCourseDescription", "courseDetails/getPrerequisites",
            "courseDetails/getCorequisites", "courseDetails/getRestrictions",
            "courseDetails/getCourseAttributes"}

    def log_message(self, *a):
        if self.server.verbose:
            sys.stderr.write("  %s\n" % (a[0] % a[1:]))

    # ---- plumbing ---------------------------------------------------------

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_blob(self, data, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def not_found(self):
        self.send_blob(b"no such route", "text/plain", 404)

    def route(self, path):
        """(family, ok) — ok is False when the caller used the wrong prefix."""
        m = re.match(r"/FacultySelfService(/ssb)?/(.+)$", path)
        if not m:
            return None, False
        fam, ssb = m.group(2), bool(m.group(1))
        return fam, (fam in self.SSB) == ssb

    # ---- GET --------------------------------------------------------------

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}

        host = self.headers.get("Host", "")
        # Where console.js and hub.html come from, as GitHub Pages is to ODU.
        pages = "http://pages.localhost:" + host.rsplit(":", 1)[-1]
        # Pages loaded into a tab, as opposed to fetched or framed, so a check
        # can count the tabs a bridge opened.
        if self.headers.get("Sec-Fetch-Dest") == "document":
            self.server.navs.append(host.split(".")[0] + ":" + u.path)
        if u.path == "/navs":
            return self.send_json(self.server.navs)
        if u.path == "/console.js":
            # Loaded by a student-host page means the bridge ran there.
            if "//studentssb." in self.headers.get("Referer", ""):
                self.server.hits.add("student:console.js")
            self.send_blob(self.server.console_js.encode(), "application/javascript")
            return
        if u.path == "/hub.html":
            return self.send_blob(self.server.hub_html.encode(), "text/html; charset=utf-8")
        # Which endpoint families have been asked for, so a check can assert
        # that something was *not* requested. A feature switched off has to be
        # off at the wire, not merely invisible.
        if u.path == "/hits":
            return self.send_json(sorted(self.server.hits))
        # From here on, registration history is refused, the way an expired
        # session refuses it, so a check can see what the pane says.
        if u.path == "/refuse-history":
            self.server.history_down = True
            return self.send_json(True)
        # The check under test, loaded after the console so it runs second.
        if u.path == "/check.js":
            self.send_blob(self.server.check_js.encode(), "application/javascript")
            return
        if host.startswith("studentssb."):
            return self.student_host(u, q, pages)
        if host.startswith("other.") and u.path == "/elsewhere":
            return self.send_blob(elsewhere_page(self.server.bookmark).encode(),
                                  "text/html; charset=utf-8")
        if host.startswith("other.") and u.path == "/other":
            return self.send_blob(other_page(pages).encode(), "text/html; charset=utf-8")

        # The class-list page. Serving it is what wakes the app up, whether a
        # browser navigated here or the console fetched it in the background.
        # It is also the only page carrying a synchronizer token.
        if "classListPage" in u.path or u.path == "/":
            self.server.warm = True
            return self.send_blob(page("Class List", "TOKEN123", pages).encode(),
                                  "text/html; charset=utf-8")

        # Somewhere else in Faculty Self-Service: no token, cold session.
        if u.path.endswith("/menu"):
            return self.send_blob(page("Faculty Services", None, pages).encode(),
                                  "text/html; charset=utf-8")

        fam, ok = self.route(u.path)
        if fam is not None:
            # Recorded whether or not the prefix was right: a request that went
            # out under the wrong prefix still went out.
            self.server.hits.add(fam)
        if fam is None or not ok:
            return self.not_found()

        if fam == "searchStudent/getProfileDetails":
            # The student host is this host with studentssb in its name, as at ODU.
            other = self.headers.get("Host", "").replace("facultyssb", "studentssb")
            return self.send_json({"studentProfileUrl": f"http://{other}/StudentSelfService/"})

        if fam == "studentPagesCommonSearch/fetchTerms":
            return self.send_json(TERMS)

        if fam == "courseList/courseList":
            # Cold session, or a token issued for some other app: 401, the way
            # Banner does until the class list has been opened once.
            if not self.server.warm:
                return self.send_blob(b"no class list context", "text/plain", 401)
            if self.headers.get("X-Synchronizer-Token") != "TOKEN123":
                return self.send_blob(b"bad token", "text/plain", 401)
            rows = SECTIONS.get(q.get("term", ""), [])
            # The envelope Banner actually uses here, not one named for the call.
            return self.send_json({"success": True, "length": len(rows), "result": rows})

        if fam == "classList/classListDetail":
            pidms = ROSTERS.get(q.get("crn", ""), [])
            detail, summary = [], []
            for p in pidms:
                s = STUDENTS[p]
                d = curriculum(p)
                d["pidm"] = p
                detail.append(d)
                summary.append({"bannerId": s["uin"], "studentName": s["name"],
                                "studentPidm": p, "classDescription": s["standing"],
                                "confidentialIndicator": s["confidential"],
                                "emailAddress": s["email"]})
            return self.send_json({"classlistDetail": detail, "classlistSummary": summary})

        if fam in ("studentContactCardPicture/picture", "classListPicture/picture"):
            p = pidm_of(q.get("bannerId", ""))
            # 900003 has no photo on file: a data 404, not a routing one. The
            # resolver must not learn a prefix from it.
            if p is None or p == "900003":
                return self.not_found()
            return self.send_blob(PNG, "image/png")

        if fam == "studentContactCard/retrieveData":
            p = pidm_of(q.get("bannerId", ""))
            if p is None:
                return self.not_found()
            s = STUDENTS[p]
            major = MAJOR_BY_TERM.get(p, {}).get(q.get("termCode", ""), s["major"])
            return self.send_json({"data": {"contactCard": {
                "primaryMajor": major, "primaryProgram": s["college"],
                "emailAddress": s["email"], "displayName": s["name"],
                "isConfidentialStudent": s["confidential"]}}})

        if fam == "studentDetails/curriculum":
            p = pidm_of(q.get("bannerId", ""))
            if p is None:
                return self.not_found()
            return self.send_json({"data": curriculum(p)})

        if fam == "sectionDetails/getFacultyMeetingTimes":
            crn = q.get("courseReferenceNumber", "")
            m, f = MEETINGS.get(crn), FACULTY.get(crn)
            if not m and not f:
                return self.send_json({"fmt": []})
            return self.send_json({"fmt": [{"meetingTime": m, "faculty": f or []}]})

        if fam == "courseList/courseInfoAndEnrollmentCounts":
            crn = q.get("crn", "")
            row = ([r for r in SECTIONS.get(q.get("term", ""), [])
                    if r["courseReferenceNumber"] == crn] or [None])[0]
            # Someone else's class: the faculty endpoint has nothing to say
            # about it, which is not the same as the console being broken.
            if not row:
                return self.not_found()
            n = row["courseEnrolmentCount"]
            return self.send_json(dict(row, maxEnrollmentCount=30,
                                       seatsAvailCount=30 - n, waitListCount=0))

        # The course-detail family: HTML fragments, and an empty body where
        # there is nothing on file.
        tail = fam.split("/")[-1]
        if fam.startswith("courseDetails/") or fam == "sectionDetails/getClassDetails":
            frag = COURSE_DETAIL.get(q.get("courseReferenceNumber", ""), {}).get(tail, "")
            return self.send_blob(frag.encode(), "text/html; charset=utf-8")

        return self.not_found()

    def student_host(self, u, q, pages):
        """Student Self-Service: the profile page, and the one call the bridge
        makes. Everything else on this host is a 404."""
        if u.path == "/StudentSelfService/ssb/studentProfile":
            if not q.get("studentId"):
                # Faculty, with no student picked: Banner forwards to its class
                # list, under this app, without /ssb.
                self.send_response(302)
                self.send_header("Location", "/StudentSelfService/classListApp/classListPage")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            # The profile app holds one student per session: the last one served.
            self.server.student_warm = q["studentId"]
            return self.send_blob(student_page(pages).encode(), "text/html; charset=utf-8")
        if u.path == "/StudentSelfService/classListApp/classListPage":
            return self.send_blob(not_available_page(pages).encode(),
                                  "text/html; charset=utf-8", 404)
        m = re.match(r"/StudentSelfService(/ssb)?/(.+)$", u.path)
        if not m:
            return self.not_found()
        fam, ssb = m.group(2), bool(m.group(1))
        self.server.hits.add("student:" + fam)
        # Under /ssb here, though ENDPOINTS.md records it at the app root, so
        # the bridge's one fallback gets used.
        if fam == "studentProfile/viewGPAHoursList" and ssb:
            # Only once a profile has been served, and with this host's own
            # token, from that page, not the faculty one.
            if (not self.server.student_warm or
                    self.headers.get("X-Synchronizer-Token") != "STUDENTTOKEN"):
                return self.send_blob(b"no profile, or bad token", "text/plain", 401)
            # Any student but the one whose profile was served last is a 404,
            # as real Banner answered for every student after the first.
            if self.server.student_warm != q.get("studentId"):
                return self.not_found()
            rows = GPA.get(pidm_of(q.get("studentId", "")) or "", {})
            return self.send_json({"success": True, "data": rows})
        return self.not_found()

    # ---- POST -------------------------------------------------------------

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"

        if u.path == "/result":
            self.server.result = raw.decode()
            self.server.done.set()
            return self.send_json({"ok": True})

        try:
            body = json.loads(raw)
        except ValueError:
            body = {}

        fam, ok = self.route(u.path)
        if fam is None or not ok:
            return self.not_found()

        if fam == "studentPagesCommonSearch/searchResults":
            if body.get("searchType") not in ("Student", "Advisee"):
                return self.send_json({"result": []})
            out = []
            for p, s in STUDENTS.items():
                hit = (body.get("id") and
                       s["uin"].lstrip("0") == str(body["id"]).lstrip("0"))
                last = (body.get("lastName") or "").lower()
                hit = hit or (last and s["name"].lower().startswith(last))
                if hit:
                    out.append({"id": s["uin"], "name": s["name"],
                                "xyz": base64.b64encode(p.encode()).decode()})
            return self.send_json({"result": out})

        if fam == "registrationHistory/fetchRegistrationHistory":
            if self.server.history_down:
                return self.send_blob(b"session expired", "text/plain", 401)
            try:
                p = base64.b64decode(body.get("xyz", "")).decode()
            except Exception:
                p = ""
            return self.send_json({"registrationGrid": {"result": HISTORY.get(p, [])}})

        return self.not_found()


class Server(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        """Every check ends by killing its browser, often mid-response, and the
        traceback that produces looks exactly like a test failing. Only the
        unexpected is worth printing."""
        e = sys.exc_info()[1]
        if isinstance(e, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


def serve(port: int, console_js: str, hub_html: str, verbose: bool = False):
    srv = Server(("127.0.0.1", port), Handler)
    srv.console_js = console_js
    srv.hub_html = hub_html
    srv.bookmark = ""          # the bookmark's own code; run.py sets it
    srv.check_js = ""          # run.py swaps this in per check
    srv.result = None          # a check POSTs its verdict to /result
    srv.done = threading.Event()
    srv.warm = False           # set once the class-list page has been served
    srv.student_warm = None    # the studentId whose profile was served last
    srv.hits = set()           # endpoint families asked for; see /hits
    srv.history_down = False   # see /refuse-history
    srv.navs = []              # pages loaded into a tab, in order; see /navs
    srv.verbose = verbose
    return srv


def main() -> int:
    from pathlib import Path
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8801)
    args = ap.parse_args()
    docs = Path(__file__).resolve().parent.parent / "docs"
    srv = serve(args.port, (docs / "console.js").read_text(), (docs / "hub.html").read_text(),
                verbose=True)
    print(f"http://facultyssb.odu.localhost:{args.port}/FacultySelfService/ssb/classListApp/classListPage")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
