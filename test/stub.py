#!/usr/bin/env python3
"""A pretend Banner, just real enough to drive the console against.

Serves the endpoints console.js calls, with made-up students, and the page the
bookmarklet is clicked on. Started by run.py; runnable on its own if you want
to poke at the console by hand:

    python3 test/stub.py --port 8801
    open http://127.0.0.1:8801/FacultySelfService/ssb/classListApp/classListPage

The data is invented. Nothing here touches a real Banner and nothing here is a
real student.

WHAT IT DELIBERATELY GETS WRONG

Three things, because the console has been broken by all three:

  * courseList answers under "result", not "courseList", and uses subjectCode
    where other endpoints use subject.
  * Half the endpoints live under /ssb and half do not, so the prefix resolver
    has something to resolve. A wrong prefix 404s, as it does in Banner.
  * The session starts cold. courseList answers 401 until the class-list page
    has been served, and only that page carries a synchronizer token — so a
    console clicked anywhere else in Faculty Self-Service has to wake the app
    up before it can ask anything. /menu is that "anywhere else".
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

TERMS = [
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
               "college": "Sciences", "admit": "Fall 2023", "standing": "Senior",
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

# A 1x1 PNG. Enough for the console to accept as an image and draw.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

def page(title: str, token: str | None, scripts: bool = True) -> str:
    return ("<!doctype html><html><head><meta charset=\"utf-8\">" +
            (f'<meta name="synchronizerToken" content="{token}">' if token else "") +
            f"<title>{title}</title></head>"
            f"<body><h1>Banner (stub)</h1><div id=\"page\">{title}</div>" +
            ('<script src="/console.js"></script><script src="/check.js"></script>'
             if scripts else "") +
            "</body></html>")


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

        if u.path == "/console.js":
            self.send_blob(self.server.console_js.encode(), "application/javascript")
            return
        # Which endpoint families have been asked for, so a check can assert
        # that something was *not* requested. A feature switched off has to be
        # off at the wire, not merely invisible.
        if u.path == "/hits":
            return self.send_json(sorted(self.server.hits))
        # The check under test, loaded after the console so it runs second.
        if u.path == "/check.js":
            self.send_blob(self.server.check_js.encode(), "application/javascript")
            return
        # The class-list page. Serving it is what wakes the app up, whether a
        # browser navigated here or the console fetched it in the background.
        # It is also the only page carrying a synchronizer token.
        if "classListPage" in u.path or u.path == "/":
            self.server.warm = True
            return self.send_blob(page("Class List", "TOKEN123").encode(),
                                  "text/html; charset=utf-8")

        # Somewhere else in Faculty Self-Service: no token, cold session.
        if u.path.endswith("/menu"):
            return self.send_blob(page("Faculty Services", None).encode(),
                                  "text/html; charset=utf-8")

        fam, ok = self.route(u.path)
        if fam is not None:
            # Recorded whether or not the prefix was right: a request that went
            # out under the wrong prefix still went out.
            self.server.hits.add(fam)
        if fam is None or not ok:
            return self.not_found()

        if fam == "searchStudent/getProfileDetails":
            return self.send_json({"studentProfileUrl":
                                   "https://studentssb.example.edu/StudentSelfService/"})

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
            return self.send_json({"data": {"contactCard": {
                "primaryMajor": s["major"], "primaryProgram": s["college"],
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
            try:
                p = base64.b64decode(body.get("xyz", "")).decode()
            except Exception:
                p = ""
            return self.send_json({"registrationGrid": {"result": HISTORY.get(p, [])}})

        return self.not_found()


def serve(port: int, console_js: str, verbose: bool = False):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.console_js = console_js
    srv.check_js = ""          # run.py swaps this in per check
    srv.result = None          # a check POSTs its verdict to /result
    srv.done = threading.Event()
    srv.warm = False           # set once the class-list page has been served
    srv.hits = set()           # endpoint families asked for; see /hits
    srv.verbose = verbose
    return srv


def main() -> int:
    from pathlib import Path
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8801)
    args = ap.parse_args()
    js = (Path(__file__).resolve().parent.parent / "docs" / "console.js").read_text()
    srv = serve(args.port, js, verbose=True)
    print(f"http://127.0.0.1:{args.port}/FacultySelfService/ssb/classListApp/classListPage")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
