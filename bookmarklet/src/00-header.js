/* Banner Plus — classes, rosters, student records and scheduling in one place.
 *
 * GENERATED FILE. Built from bookmarklet/src/*.js by bookmarklet/build.py.
 * Edit the sources, not this.
 *
 * Click the bookmarklet on any Banner Faculty Self-Service page. It runs in
 * that page, on the session you are already signed in to; nothing is uploaded
 * and nothing is installed.
 *
 *   sidebar   your sections for a term, plus saved groups of students
 *   middle    the roster, as a grid of faces or as a table
 *   right     the focused student — schedule and transcript — or, for a
 *             selection, a heatmap of when they are collectively free
 *
 * WHY THIS EXISTS
 *
 * Banner shows one record at a time, because that is what a record-management
 * system does. Everything worth having here is a join it will not do: a roster
 * as one sheet of faces, a group's schedules overlaid to find a free hour, a
 * term's sections in one list. The point is not a prettier Banner.
 *
 * THE SOURCE, IN LOADING ORDER
 *
 *   10-core         constants, DOM and formatting helpers
 *   20-api          headers, the /ssb prefix resolver, GET and POST
 *   30-banner       one function per endpoint; no DOM
 *   40-domain       categories, GPA arithmetic, the free/busy map
 *   50-print        the photo roster and free-time sheets
 *   55-planner      building a semester-planner import link
 *   60-groups       artificial classes, stored in localStorage
 *   65-bridge       on the student host, the whole program: reads the
 *                   registrar's GPA for the console in the other tab
 *   70-shell        the overlay: toolbar, progress, drawer, panes
 *   80-sidebar      sections and groups, and the group editor
 *   90-roster       the middle pane, as photos or as a table
 *   100-student     the student pane and the transcript grid
 *   105-course      the floating course pane, switched off; the file says why
 *   110-scheduling  shared free time
 *   120-load        opening a section or a group
 *   130-boot        terms, and starting up
 *
 * Files 10-60 touch no DOM and 70 onwards draw; the split falls there because
 * a change to how Banner answers should never be a change to how anything
 * looks. 65 sits on the line: clicked on the student host, the bundle runs the
 * data layer and the bridge, then stops at the seam build.py writes between
 * 65 and 70, so none of the console is drawn there. Order matters only for
 * the files that have side effects: 10 reads where this script came from, 20
 * reads the synchronizer token, 30 asks Banner where the student host is, 65
 * starts listening for a bridge, 70 puts the window on screen, and 130 starts
 * the first fetch.
 *
 * ENDPOINTS
 *
 * Documented in ENDPOINTS.md, including what each is keyed by and the traps.
 * Banner mixes its path conventions — some endpoints sit under /ssb and some
 * directly under /FacultySelfService — so the prefix is resolved per family at
 * runtime rather than written down. Hardcoding it is what made an early build
 * find no classes at all.
 */
