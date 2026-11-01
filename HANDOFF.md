# Elevate OS — handoff

_Last updated 31 Oct 2026 (debug pass, structure, release package, later fix rounds, leave applications, full sample data). Branch `feature/business-ops-hr-admissions`. Nothing is deployed yet._

## For the owner (plain language)

**What it is.** Elevate OS is the internal system your staff sign in to. Since 22 Oct 2026 it has three **workspaces**, one per kind of work, each at its own address: Business Operations (enquiries, demos, admissions, students, fees, staff tasks), Academic (teachers and coordinators) and Marketing. A fourth address holds Users & roles. Only `@elevateeducation.in` accounts can use it (D-030).

### Status report — 31 Oct 2026 (debug pass, structure, installable package)

```
What's live now: nothing on the internet; nothing is deployed. On your computer, the same four
  addresses as before, once you start them (step 10 below). A package that installs on one
  computer now exists; it has been installed and tested on this PC only, with sample data.
What I did:
- A student who leaves now really leaves. An exit recorded in Business Operations reaches Academic
  when someone presses "Send exits to Academic" (there is no timer yet): the student drops off
  later classes and tests, and what was already marked stays. A corrected name travels the same
  way. When staff leave, their manager, the operations managers and the coordinators are told
  what that person still holds; nothing is moved for them.
- Each person now stays inside their own workspace for data as well as screens. Until now someone
  could read another workspace's records through its data connections if their role held the
  permission, even though the screens sent them away. Tried 3,567 times from outside: all refused.
  Each teacher sees only their own batches, students and marks.
- Messages reach someone who can act. Requests through HR now always tell a person who can decide
  (one gap for your decision is below), notices open in the right workspace, and someone whose
  login has no staff record is told why instead of failing quietly.
- Fee figures agree. Tuition pages show tuition, the case page and exit record show everything
  owed, and each adds up on every screen and paper: 171 figures worked out by hand first, 0
  wrong. Forms, cards and reports now print Hindi names correctly.
- Clicks show a thin bar at once, the Overview opens in 0.2 to 0.5 seconds (was 1.2 to 1.8), and
  everything now builds into one package with a check on every file. On the first package, 266 use
  cases: 260 passed, 3 failed and were fixed afterwards, 3 could not be run here. On the third
  package: 262 passed, 1 failed and was fixed afterwards. On the fourth: 263 passed, 0 failed. The
  same 3 could not be run on either.
- Then, from your two inspections on 31 Oct: leave applications (staff apply, HR approves), settings
  as real fields instead of technical text, sample records on every screen, clearer words when
  Academic is stopped, and a fix for fee pages slowing down with many students. None of this has
  been on a tested package yet.
What I need from you: step 10 below, in order, on your own computer. Then the first group,
  "Stops real use", in "Decisions waiting for you": real staff cannot use this without those three.
What's next:
- The final re-test on the rebuilt package: GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held)
- Your own look at the screens, above all the arrows under tables you mentioned. I fixed four
  arrow-like things and cannot tell which you meant. Pictures of each are under "Pictures you can
  look at" below: please tell me if the arrows you saw are still there.
- Choosing where to host it, once the three decisions are made.
Placeholders still to replace: 26 (the placeholders list says what each one is).
```

**Final state, 1 Nov 2026.** Everything in the test data is made up: normal English names, fake phone numbers, named parents, KYC, forms, fees, attendance, reviews, tasks and reports, all marked sample and removable in one step. Your seven real teachers are not in it.

**Not re-checked after the made-up data went in,** because memory and your usage limit ran short. Each of these passed on the package before it, except the two marked:
- The full list of use cases, money worked out by hand, simultaneous-action tests and attacks. Automatic tests and a page walk did run on the final package.
- The screens by real clicks in a browser, including two layout fixes that have never been seen in the real app (the HR settings form and student codes on My Day; not yet proven).
- The system with Academic switched off, including the new wording on a demo record (not yet proven).
- Speed on large data. Keep the PC plugged in: battery about doubled the times.

**Known in the made-up data.** Sample work reports say "Academic OS was not asked for this report" in their Academic section. Most students have only one to three test results, so the trend lines on their reports say "insufficient data". Files and attachments stay empty because no file storage is chosen. A database that already holds your seven teachers keeps them, blank, beside the made-up ones.

**What this does not mean.** I cannot tell you there are no errors anywhere. These are still true:
- **Not checked by anyone yet:** a real Google sign-in, a real phone on your Wi-Fi, restoring a backup, any server other than this PC, and your own database, which I do not touch.
- **Speed figures** come from sample data on a busy PC. Forty people opening the Overview at the same instant still wait: about 9 seconds at the first measure and about 16.5 seconds on a later run while other checks kept the PC 34 to 54% busy (it was about a minute). That later figure is not shown to be a slowdown in the system, and not shown not to be.
- **Open by design until you choose a host:** until a secure front door (a proxy) is in place, someone can fake the network address recorded for their session.
- **In the office mode of step 10, file uploads are refused,** the same as online: test papers and keys, score imports and task files. Choosing file storage fixes this. Marks by hand and publishing still work.
- **How I read your brief:** "this one" means Elevate OS, and "different teacher, different workspace" means each teacher has their own view inside one Academic workspace. Tell me if you meant something else.

### Known limits (31 Oct 2026)

We know about these and have left them for now. The first one needs your help.

**Keep the PC on mains.** Battery roughly doubled the times we measured. With 40 people opening the Overview at once on the fourth package: 5 seconds on mains and 9.5 on battery on a fresh database; 12 to 16 seconds on mains and 26 on battery on a database grown by testing. The fee fix above came after this and is still to be measured.

**Please try this.** On a simulated slow phone, opening the phone menu took 0.36 to 0.74 seconds against a target of 0.2 seconds, and closing a panel, changing a tab and opening filters were also slower than the target. The older code measured the same in the same minute, so this work did not cause it, and the test PC was on battery. A simulation is not a phone. Please try the system on a real staff phone and tell us how it feels: which screen, which button, and whether you find yourself waiting.

**Requests nobody makes from a screen.** No data is shown and nothing is saved in the first two.
- A hand-made web address with broken letter coding gets a bare error page instead of a worded answer. No screen can make such an address.
- A hand-made request from a command-line tool (curl), with no sign of which site it came from, can answer an error and leave a line in the server log. A web page cannot send this.
- Asking a real data address with the wrong kind of request gets an empty "not allowed" with no sentence. An address that does not exist now answers properly.
- Until a secure front door (a proxy) is in place, someone can fake the network address recorded for their session and get round the limits counted per address. This goes with choosing a host.

**Not proven yet.**
- The automatic checks on GitHub build with a different build tool (Turbopack) from this PC, and those builds pass. Nobody has run one of those builds to watch the check that keeps each person in their own workspace. If that check failed there, every signed-in data request would answer an error. It would not let anyone in.
- Linux has not been run. Everything so far ran on this Windows PC, so a Linux host needs its own build and test.

**How some screens look.**
- Two or three wide tables need sideways scrolling inside the table on a desktop screen: Marketing's weekly report, Today's classes and a test's Roster and marks. The page itself does not scroll sideways. More tables do this on a tablet, and Academic's reports do on a phone.
- Settings now have real fields. Three things are still typed into a box of technical text: the "Schar" recipient setting (the box says how), a test's scoring sections and onboarding templates.

**In office mode (step 10.7).** File uploads are refused, and so are sign-ins ending `@example.test`, so Pooja, Rohit and Sample Schar cannot sign in there. The other demo sign-ins work.

**Small things left as they are.** No figure is wrong in any of these.
- Printing a student's report page before a report exists prints the "Make a report" form on page 2 after a nearly blank page 1. There is no Print button on that page; only Ctrl+P reaches it.
- On a phone, the last date under the Leads chart sits 1 to 3 pixels over the edge of its card.
- On a phone, the date-and-time box on a Marketing content record runs past the card, so the calendar icon is out of sight until the table is pushed sideways.
- On a phone, one word breaks in the middle in a narrow settings table ("Unacknowledg-ed hours").
- A test's Roster and marks gets a small scrollbar for a few pixels at desktop width.
- A panel opened by mouse shows a square outline round "Open full record".

### The sample records, and what you inspected (31 Oct 2026)

You asked for everything to be filled with mock data, so tasks, attendance, leave, requests, feedback, classes and tests now all have sample records. Each is marked sample, with made-up names and no phone number. Real teachers stay off them. A few things stay blank on purpose, because filling them would make a false record: phone numbers, guardian consent, verified documents, signatures, approvals and attached files.

They come off in one step before real use: type `! npm run db:clear-samples`. It removes every sample record and switches the demo sign-ins off, and real records stay. We tried this on a test database, not on yours.

What you inspected on 31 Oct was the test database, not your own. Testing agents had been adding to it, so its counts were larger than real use, and tasks with "race" in the name are left over from those tests. The "connection refused" and the sudden sign-in page were agents stopping servers and switching databases. Please wait for the final package before inspecting again, or a stopped server will look like a fault.

### Pictures you can look at (31 Oct 2026)

Open the folder `C:\OPENBOT\elevate-os\docs\screens-31-oct`. They come from the last package tested, with made-up sample records, so the figures are test data and not your business. Two pictures of a teacher's record were left out because they show a real teacher's name. A made-up phone number on the two admission pictures is covered.

**The arrows.** I still do not know which arrows you meant. Please compare these with your own screen and tell me if the arrows you saw are still there, and which picture comes closest.

| You may have meant | Picture | What it shows now |
|---|---|---|
| The arrow in an empty table | [empty-table.png](docs/screens-31-oct/empty-table.png) | Headings stay, and an orange up-arrow sits before the words "No demos match this search". It used to run into the text |
| The arrows at the ends of a scrollbar under a wide table | [wide-table-with-scrollbar.png](docs/screens-31-oct/wide-table-with-scrollbar.png), [phone](docs/screens-31-oct/wide-table-with-scrollbar-phone.png), [desktop](docs/screens-31-oct/wide-table-with-scrollbar-desktop.png) | A slim scrollbar under the table, with no arrows. Some columns stay out of sight until you push the table |
| The arrows in the row of tabs on a record with many tabs | Left out (a real name). To see it, open any teacher under Teachers | Ten tabs wrap to three rows on a desktop, and sit in one sideways strip on a phone |
| The arrow on the admission stage strip | [admission-stage-strip.png](docs/screens-31-oct/admission-stage-strip.png), [phone](docs/screens-31-oct/admission-stage-strip-phone.png) | Demo, Application, Signed, Confirmed, Active, with an orange arrow on the current stage |
| Broken date labels under a chart | [chart-with-date-labels.png](docs/screens-31-oct/chart-with-date-labels.png), [phone](docs/screens-31-oct/chart-with-date-labels-phone.png) | Dates on one line, every 4 days. They used to break letter by letter |

**Also there.** The Overview, first screen: [desktop](docs/screens-31-oct/overview-1440.png), [phone](docs/screens-31-oct/overview-390.png). The whole page: [desktop](docs/screens-31-oct/overview-1440-whole-page.png), [phone, cut at 6,000 pixels](docs/screens-31-oct/overview-390-whole-page.png). A form refusing a bad phone number, with the reason beside the field and the typing kept: [desktop](docs/screens-31-oct/form-with-refusal.png), [phone](docs/screens-31-oct/form-with-refusal-phone.png).

### Status report — 23–24 Oct 2026 (tests, requests through HR, marketing, fees)

```
What's live now: nothing on the internet yet. On this computer, the same four addresses
  (Business Operations :3000, Academic :3001, Marketing :3002, Users & roles :3003). Both
  database updates (0015 and 0016) are applied on your computer.
What I did:
- Tests and Mock Tests now live in Business Operations: schedule a test for one or more
  batches, upload the question paper and answer key (hidden until you release them), import
  scores from a CSV file or from a PDF that the AI reads (you tick "I confirm" each time, and a
  person checks every row), then publish results with ranks. Teachers see the same test in
  Academic; there is only one copy.
- Staff can send a request through HR from any workspace; HR reads it, answers it or passes it
  on to the right person. "Schar" is a setting HR fills in once you tell us who it is.
- Leads have marketing stages (New → Contacted → … → Converted). A lead becomes Converted only
  after the admission is confirmed in Business Operations. Calls are logged with their outcome.
- Marketing has a content calendar (plan → make → approve → publish by hand), the ideas plan,
  SEO / AI-search work items, targets and a monthly report. Every dashboard tile says plainly
  when a filter does not apply to it.
- Task reminders and pop-up notices; the fee page has a paid-versus-outstanding chart for the
  year whose total always equals the list of students behind it.
- A fuller set of sample records and ten demo sign-ins, all marked "Sample", removable in one step.
What I need from you: step 9 below (load the new sample records), then the rows marked
  "New 24 Oct" at the top of "Decisions waiting for you".
What's next:
- The browser check of every flow below (results go in the "Checks" line of the milestone section).
- Your answers on Schar, the reminder intervals and who runs the reminder job.
Placeholders still to replace: see PLACEHOLDERS.md.
```

### Status report — 23 Oct 2026 (HR area)

```
What's live now: nothing on the internet yet. On this computer, the same four addresses
  (Business Operations :3000, Academic :3001, Marketing :3002, Users & roles :3003). The new
  HR screens need one database update first (step 7 below); until then they do not open.
What I did:
- HR is back inside Business Operations, as you asked: a new "HR manager" role with its own
  menu — staff records (with private contact details only HR can see), who teaches what,
  staff attendance, giving work to people and checking what they hand in, daily, weekly and
  monthly work reports, and student feedback about teachers. Every new permission is marked
  "Proposed" until you confirm it.
- Attendance never guesses: a day with no check-in says "not marked", never "absent"; only HR
  can mark someone absent, and nobody can mark or approve their own attendance. Check-ins are
  typed in or imported from a file; no machine is connected.
- Work handed in is frozen as a version; nobody can approve their own work, and a task's
  owner cannot switch its review off. Teachers see only approved summaries of student
  feedback about them, never the raw comments, and nobody sees feedback about themselves.
- Your staff answers are in: the two Somas are two people; Satish teaches IPMAT Quant on the
  April 2027 Class 12 batch from today, with Class 11/12 Maths waiting for a batch; Nikunj's
  CA Accounting is recorded as waiting for a batch (my pick — please confirm).
- Also new: files can be attached to tasks (on this computer only), a notifications page in
  every workspace, AI drafting buttons (a free AI service writes a first draft; a person always checks
  and saves it), the dark charcoal sidebar you chose, and marketing employees now see only
  the campaigns they are members of.
What I need from you: step 7 (the database update) and the new rows at the top of
  "Decisions waiting for you" — first, whether the new HR permissions are right.
What's next:
- After step 7, open Business Operations as the HR sample user and as yourself, and tell me
  what looks wrong; the check in a real browser is still to be done.
- Choose where uploaded files will be kept once the system is on the internet.
Placeholders still to replace: see PLACEHOLDERS.md.
```

### Status report — 22–23 Oct 2026 (new look, dashboards, cross-workspace checks, reports)

```
What's live now: nothing on the internet yet. On this computer, the same four addresses as in the
  report below (Business Operations :3000, Academic :3001, Marketing :3002, Users & roles :3003).
What I did:
- A new look for every screen, as you asked ("completely different", curves, a little blur,
  charts): a light warm background, a white floating menu rail, rounded panels, pill-shaped
  buttons and tabs, and records that open in a frosted panel (a bottom sheet on phones). Only
  the Elevate name, logo and orange are kept. The old dark look is saved as a backup (git tag
  `ui-v1-dark-2026-10-22` and a folder copy), so it can be brought back.
- Dashboards with charts in all three workspaces: the Business Operations Overview (figure
  tiles, leads per day, the admissions funnel, demo outcomes, leads by source), Academic My day
  (a teacher's timeline and tiles; for coordinators, coverage per batch and attendance and
  delivery per programme as bars) and the Marketing Overview (tiles, content by state as bars,
  accounts by connection). Every chart can be shown as a table, and a figure that is not known
  says "Not recorded" or "Not available", never 0.
- Checked what each workspace shows of the others and removed what was never real: four
  figure tiles that could only ever say "Missing" are gone; the attendance percentage is now
  worked out once, in Academic, and printed with its definition beside it; a wrong "no reviews"
  message (for staff with no staff record) now says why nothing can be shown; a placeholder
  "Dashboard" page in Users & roles that showed nothing is gone; the never-finished
  "leads sent from Marketing" connection is retired, because Marketing already works on the
  same lead list since 22 Oct.
- Teacher reviews: each of the six evidence boxes now says what belongs in it and what never
  does (no family or contact details, fee remarks or personality labels), with a proposed limit
  of 1,500 characters, and the "who may see it" choice names its readers.
- Each workspace can now prove which workspace is calling it (one key per workspace instead of
  one shared key), so a workspace cannot pretend to be another. On this computer nothing
  changes until the separate keys are set, which is a go-live step.
- New: an internal teacher report PDF from each teacher's page in Business Operations
  ("Generate teacher report": the period, classes planned and delivered, attendance and marking
  still pending, reviews written, where to work on, a short factual summary), kept in the
  database with a reference number; only the operations manager and the director can make it,
  and a teacher can never make one about themselves.
- Also done: the student folio PDF in two kinds —
  "PTM report (for parents)" and "Internal report (KYC, details, scores, reviews)", with
  scores as bar charts, teachers' reviews, where to work on and a short factual summary; the PTM one is two pages and never carries KYC.
What I need from you: the eight new rows at the top of "Decisions waiting for you" — the
  first is whether the new light look is right. (The database update for the teacher report,
  step 6, is already done on your computer.)
What's next:
- You open each workspace with the demo sign-ins (step 4) and tell me what looks or feels wrong.
- The full checks have been run; the numbers are in IMPLEMENTATION_STATUS.md.
- Choose where to host it, so it can go on the internet.
Placeholders still to replace: see PLACEHOLDERS.md.
```

### Status report — 22 Oct 2026 (workspaces)

```
What's live now: nothing on the internet yet. On this computer each workspace has its own address:
  Business Operations  http://localhost:3000
  Academic             http://localhost:3001
  Marketing            http://localhost:3002
  Users & roles        http://localhost:3003
What I did:
- Each person opens only the workspaces their role allows. Teachers work only in Academic;
  marketing staff only in Marketing; the owner, director and office staff in Business Operations.
  Opening another address sends a person back to their own workspace.
- One sign-in covers every workspace you are allowed into, and signing out anywhere signs you
  out everywhere. People with more than one workspace pick one after signing in and can tick
  "Open the one I pick by default next time".
- Teachers now have their tasks, end-of-day report and meetings inside Academic, plus a list
  of classes that still need student attendance.
- Marketing now has leads, follow-ups, tasks and end-of-day reports inside its own menu, and
  sees each lead's contact details but never documents, date of birth, address or fees.
- The Business Operations home page is a new Overview for a chosen date range (this month by
  default), with new pages for Collections, Outstanding fees, an Academic summary and a
  Marketing summary.
- Each workspace can be started on its own; a panel from a workspace that is not running says
  "source unavailable", never 0.
- Three demo sign-ins for trying it out on this computer only (see step 4 below).
What I need from you: steps 4 and 5 below, then the new questions at the top of
  "Decisions waiting for you".
What's next:
- You try each workspace with the demo sign-ins and tell me what feels wrong.
- Choose where to host it, so it can go on the internet.
Placeholders still to replace: see PLACEHOLDERS.md.
```

How to start a workspace (open a terminal in the `elevate-os` folder; each command also starts the database if it is not running):
- Business Operations: `npm run dev:business`, then open http://localhost:3000
- Academic: `npm run dev:academic`, then open http://localhost:3001
- Marketing: `npm run dev:marketing`, then open http://localhost:3002
- Users & roles and Google sign-in: `npm run dev:platform`, then open http://localhost:3003
- All three workspaces at once: `npm run dev:all`

Demo sign-ins (this computer only, all with the one password you choose in step 4): `business@elevateeducation.in` (operations manager, Business Operations), `teacher@elevateeducation.in` (teacher, Academic), `marketing@elevateeducation.in` (marketing manager, Marketing). The email decides nothing; the role stored for the account decides what it may open. The demo teacher has no classes until a coordinator places them on a batch.

### Status report — 21 Oct 2026

```
What's live now: nothing on the internet yet. It runs on this computer at http://localhost:3000.
What I did:
- Demos now run over three demo days, and a student's record is made at the first booking.
- Admissions follow your paper form: application, printed form, signatures, then a final
  confirmation with the approver's password. The admission number (001, 002 …) is given
  only at that moment, with an acknowledgement and an ID card to print.
- Fees: yearly fee split 50 / 25 / 25, registration ₹5,000 once per student, demo ₹1,000;
  every fee change needs a second person's approval.
- Staff have "My day" tasks and a daily end-of-day report their manager can read.
- A clearer layout and menu (the dark look of that day was replaced on 22 Oct; see the newest report above).
- Academic: teachers get "My day", class pages to mark attendance and "Mark delivered",
  a teaching log, marks entry and student reviews. Coordinators place students in batches,
  publish timetables, handle substitutes and see coverage and reports (print and CSV).
- Teacher reviews are now written in Academic; Business Ops reads them and can acknowledge
  them, but cannot change them. Demo attendance for a linked class is marked by its teacher.
- Tasks: acknowledge, review, block and reassign with full history; end-of-day reports are
  built from what happened that day, with versions and a manager inbox; old Task Tracker
  backups can be imported.
- 12 fictional "Sample" teachers and sample classes for trying it out.
What I need from you: change the password of the team@ account, update the database (step 2a
  below), then the decisions in the table below, one at a time.
What's next:
- Final checks on every screen, then you try a full admission with sample data.
- Choose where to host it, so it can go on the internet.
Placeholders still to replace: see PLACEHOLDERS.md (fees per programme, staff list, logo file and others).
```

### Steps only you can do

Do step 10 first. The numbered steps after it are kept from earlier dates; each says whether it is already done.

**10. Bring your computer up to date (31 Oct 2026). Do these in order, on your own computer.** Only you can do this, because it changes your database and I do not touch it. "Type" means: in the Claude Code chat, type the line as shown, starting with `!`. If any step shows an error, stop and send the developer the last lines.
1. **Start the database.** Open a terminal in the `elevate-os` folder, run `npm run db:start` and leave it open.
2. **Take a backup.** Type `! node .data/json-backup.mjs`. It makes a copy of every table on this computer (not in git). It ends with the number of tables and rows, then "Pre-check OK". (`npm run db:backup` will not work here: `pg_dump` is not installed.)
3. **Check the notification links before the update.** The update adds a rule that no stored link may hold a control character (an invisible character that can break a link). This command only reads. Type:

   ```
   ! node -e "const{Client}=require('pg');const env=require('util').parseEnv(require('fs').readFileSync('.env','utf8'));const c=new Client({connectionString:env.DATABASE_URL});c.connect().then(()=>c.query('select count(*)::int n from core.notifications where link ~ \'[[:cntrl:]]\'')).then(r=>{console.log('Links holding a control character:',r.rows[0].n);return c.end()})"
   ```

   It prints `Links holding a control character: 0`. If it prints any other number, stop and tell the developer. Nothing has changed. This check is for update `0017`. Update `0018` needs no check of its own, because it only adds.
4. **Apply the database updates.** Type `! npm run db:migrate`. It should say the migration files were applied or are already up to date. It applies whichever of `0017` and `0018` your computer does not have. I do not know whether `0017` has already been applied on your computer. `0018` is new, so yours does not have it. `0017` adds seven indexes (so seven kinds of list read faster) and the link rule. `0018` adds an empty table for leave applications and two indexes, for the sales calls and collections lists. Neither changes a stored record. If it stops with an error, nothing is half-applied.
5. **Check the database.** Type `! npm run db:check`. It should end with `db:check — 19/19 checks passed.`
6. **Load anything new.** Type `! npm run db:seed`. Since 31 Oct it only adds what is missing, so running it again is safe: it no longer puts seed text back over what you edited on a screen (until now it did, for example on batches, programmes and staff notes). Sample and demo rows are still refreshed. Anything an earlier run already overwrote stays as it is now. This also loads the fuller sample set. To sign in as Sample Schar too, type `! npm run db:seed-demo-accounts` afterwards.

   Then look at one setting. In Business Operations, open HR → HR settings → Request categories. It should list nine, including Attendance, Leave and Timetable changes. If it lists fewer, your database holds an older list, and loading data does not replace it, so HR changes it there.
7. **Use office mode every day from now on.** Type `! npm run office:build` (about 7 minutes: 427 seconds on this PC; repeat after any code update). Then in a separate terminal in the `elevate-os` folder run `npm run office` and leave it open. It prints your Wi-Fi addresses. Open the printed address, on this computer too. For staff devices, do step 8b once first.

   Why: the `npm run dev` commands are for developers and build each page when it is first opened. Most of the slowness and the false "Source unavailable" messages came from that mode on a computer short of memory.

   | | Development mode | Office mode |
   |---|---|---|
   | Opening a page for the first time, Business Operations | middle 5.9 s, worst 30.4 s | |
   | Opening a page for the first time, Academic | worst 46 s | |
   | Opening a menu page | second visit: middle 0.4 s, 9 in 10 under 9.6 s | middle 0.04 s, 9 in 10 under 0.2 s, worst 1.5 s |

   Measured on sample data on a busy PC. Checked on 31 Oct on a scratch database: `npm run office` with a real sign-in and a Hindi PDF, 32 of 32 checks passed. Not tried from a real phone.

   Two things change in office mode. File uploads are refused (see "What this does not mean" above), so if you need to upload a test paper, score sheet or task file before choosing storage, use `npm run dev:all` for that. Sample sign-ins ending `@example.test` are refused; `business@`, `hr@`, `teacher@` and `marketing@elevateeducation.in` still work.
8. **Replace the AI keys, if you have not yet.** Do step 8a, then stop and start `npm run office` again.

**11. Leftovers that need a person.**

*11a. Stored papers that may hold a wrong fee figure.* Before the fix of 30 Oct, some fee figures were worked out wrongly. For example, a report could say "credit ₹50,000" for a student who owed ₹50,000, and a signed form could overstate the fee after an agreement changed. The screens are right now, but stored papers and frozen records were **not** rewritten. To list what might be affected, type this (it only reads):

   ```
   ! node -e "const{Client}=require('pg');const fs=require('fs');const env=require('util').parseEnv(fs.readFileSync('.env','utf8'));const c=new Client({connectionString:env.DATABASE_URL});c.connect().then(()=>c.query('BEGIN READ ONLY')).then(()=>c.query(fs.readFileSync('scripts/development/find-stored-fee-figures.sql','utf8'))).then(rs=>{for(const r of rs)console.table(r.rows);return c.query('ROLLBACK')}).then(()=>c.end())"
   ```

It prints three lists. They are **candidates to check, not confirmed errors**, and the check is broad.
- **report:** open the student's report. A report saved before the fix now says "Check before relying on this". Make a new report and use that one.
- **form:** only a fingerprint of a printed form is stored, so the paper in your file is the only copy. Compare sections 07 and 08 on the paper (discount, net fee, instalments received, balance) with the student's Fees tab. The form's net fee includes the registration fee from Settings even when it has not been charged yet; that difference is expected. If nothing else differs, there is nothing to do. If it differs, tell the family, then decide whether to print the form again and have it signed again. This is your call, and the system changes nothing by itself. Acknowledgements already downloaded need the same check.
- **exit:** the balance saved on an exit record is frozen. Compare it with the Fees tab. If it differs, tell the developer: no screen corrects it.

*11b. Old marketing records marked "published" that were never posted. Only if you approve.* Until 26 Oct a Publish button marked items published although nothing was posted. Any such records still count as published on the Marketing dashboard. To see how many, type (it only reads):

   ```
   ! node -e "const{Client}=require('pg');const env=require('util').parseEnv(require('fs').readFileSync('.env','utf8'));const c=new Client({connectionString:env.DATABASE_URL});c.connect().then(()=>c.query('select count(*)::int n from marketing.placements where status=\'published\' and publication_mode=\'sandbox\'')).then(r=>{console.log('Sandbox publications stored as published:',r.rows[0].n);return c.end()})"
   ```

If it prints 0, you are done. Otherwise, changing stored records is your decision; if you leave them, the dashboard keeps over-counting those old items. If you approve, take a backup (step 10.2) and tell Claude Code "apply the two sandbox updates in HANDOFF step 11b". They are, in this order:

```sql
UPDATE marketing.content_items i SET state='scheduled' WHERE i.state='published' AND EXISTS (SELECT 1 FROM marketing.placements p WHERE p.content_item_id=i.id AND p.publication_mode='sandbox') AND NOT EXISTS (SELECT 1 FROM marketing.placements p WHERE p.content_item_id=i.id AND p.status='published' AND p.publication_mode IS DISTINCT FROM 'sandbox');
UPDATE marketing.placements SET status='scheduled', published_at=NULL WHERE status='published' AND publication_mode='sandbox';
```

**1. Change the password of the shared look-around account.** The account `team@elevateeducation.in` exists on this computer only. It can look at everything and change nothing, and it can never confirm an admission. Its password was typed in our chat, so treat it as known to others. There is no "change password" screen yet, so:
1. Start the admin app with `npm run dev:platform`, open http://localhost:3003 and sign in with your own account.
2. Click **Users & roles** in the menu.
3. Click **team@elevateeducation.in**, then **Disable account**, then confirm.
4. Ask the developer to set a new password for it; turn it back on with **Enable account** once you have the new password. Do not send the new password in chat.

**2. After pulling new code (on this computer only).** Open a terminal in the `elevate-os` folder and run, one at a time: `npm run db:start` (leave it open), then in a second terminal `npm run db:migrate`, then `npm run db:seed`. Never run these against a live database.

**2a. Update the database for the 21 Oct teacher-workspace and task work (this computer only) — done on your computer on 21–22 Oct (migrations `0009`–`0011` applied, samples seeded).** On another computer: the new screens need database changes `0009`, `0010` and `0011`. With `npm run db:start` running, type `! npm run db:migrate` in the Claude Code chat (or run `npm run db:migrate` in a terminal in the `elevate-os` folder). It also fills in what can be known from existing records: each active enrolment's batch becomes a batch placement, and past end-of-day reports become version 1. Before you run it: the database must not have one student enrolled twice, both active, in the same course (the update adds a rule that forbids this). If it stops with an error that mentions `enrolments_active_student_course_key`, that is the cause: stop and tell the developer; nothing is changed. Then type `! npm run db:seed` to add the sample teachers and sample classes (all named "Sample …").

**2b. If `npm run dev` stops with an Application Control error (this computer).** On this PC, Windows refuses to load one file that Next.js uses to compile pages faster: the error says an Application Control policy blocked `next-swc.win32-x64-msvc.node`. This is a Windows security setting on your computer, so only you (or whoever looks after this PC) control it; the developer does not change it. Since 22 Oct 2026 the start commands (`npm run dev:business`, `dev:academic`, `dev:marketing`, `dev:platform`, `dev:all`) always use the slower mode, so they work on this computer as they are. The production build is blocked the same way; it works with `npm run build -w @elevate/platform -- --webpack` (and the same for the other three apps). Nothing else is needed now. If you later want the normal `npm run dev`, the choice is whether to allow that one file in your Windows security settings; do not turn Windows security off as a whole. The exact screens differ between Windows editions, so the steps are not written here; ask the developer to sit with you for it. On a hosting server this does not apply.

**3. When it goes on the internet.** The search page puts what was typed in the address bar (`/ops/search?q=…`), which can be a phone number. In the hosting account, set request logs to **not keep query strings** (D-056). The developer does this with you on go-live day.

**4. Turn on the demo sign-ins (this computer only, optional).** The database change for workspaces (`0013`) is already applied on your computer.
1. Open the file `.env` in the `elevate-os` folder (Notepad is fine).
2. Find the line `LOCAL_DEMO_PASSWORD=replace-with-a-dev-only-password`. Replace the part after `=` with a password of at least 12 characters that you use nowhere else. Save the file.
3. In the Claude Code chat type `! npm run db:seed-demo-accounts` (or run it in a terminal in the `elevate-os` folder). It prints "ready" and the emails with the address each one opens; it never prints the password. Running it again is safe.
4. Sign in on http://localhost:3000 as `business@elevateeducation.in`, on http://localhost:3001 as `teacher@elevateeducation.in`, or on http://localhost:3002 as `marketing@elevateeducation.in`, with that password.
5. Before real staff use the system, type `! npm run db:clear-samples`: it removes the sample records and switches the demo sign-ins off. Staff never share these accounts.

**5. Google sign-in — only if you ever set it up.** The sign-in return address moved with the admin app to port 3003. If you created a Google sign-in client (`docs/GOOGLE_SIGN_IN_SETUP.md`):
1. Open https://console.cloud.google.com and sign in with the Google account that owns the project.
2. Choose the Elevate project at the top, then **APIs & Services** → **Credentials**.
3. Click the OAuth client you made for Elevate OS.
4. Under **Authorised redirect URIs**, change `http://localhost:3000/api/v1/auth/google/callback` to `http://localhost:3003/api/v1/auth/google/callback`. Click **Save**.
5. Google sign-in now needs the admin app running (`npm run dev:platform`). If you never set up Google sign-in, skip this step.

**6. Database update for the teacher report — done on your computer on 23 Oct 2026** (database change `0014_teacher_reports`, which only adds the table that keeps generated teacher reports; `db:check` passed 19/19). On another computer: with `npm run db:start` running, type `! npm run db:migrate` in the Claude Code chat (or run `npm run db:migrate` in a terminal in the `elevate-os` folder).

**7. Database update for the HR area (this computer only) — done on your computer on 23 Oct 2026** (`0015` and then `0016` applied after a backup; `db:check` 19/19). The steps below are kept for another computer. The HR screens need database change `0015`. It also rewrites some existing task and report rows (a task marked "blocked" keeps that as a flag instead of a status; every old end-of-day report becomes a day report), so take a backup first. Only you can do this, because it changes the database on your computer.
1. Make sure the database is running (`npm run db:start` in a terminal in the `elevate-os` folder, left open).
2. In the Claude Code chat type `! npm run db:backup`. If it says `pg_dump` is not installed (likely on this computer), stop and ask the developer to take a backup for you before going on.
3. Type `! npm run db:migrate`. It should say the migrations were applied.
4. Type `! npm run db:check`. It should end with all checks passed.
5. Type `! npm run db:seed`. This adds the Sikar centre, the fictional HR sample user `hr-manager@example.test` and the teaching assignments you gave today. Running it again is safe (true since 31 Oct, step 10.6).
6. Optional: type `! npm run db:seed-demo-accounts` to refresh the demo sign-ins; it also sets up `satish@elevateeducation.in` as a teacher sign-in for testing on this computer only (we assumed the `.in` ending; tell me if his address is different).
If any step shows an error, stop and send the developer the last lines; nothing is half-applied (the update runs as one step).

**8. AI keys and office Wi-Fi (24 Oct 2026, D-110).** The AI buttons now use free services (Groq first, then Gemini, then OpenRouter) instead of OpenAI, and staff can use the app from their own devices on the office Wi-Fi. Four things only you can do:

*8a. Make new Groq and Gemini keys.* Both were shown in the build chat on 24 Oct, so treat them as seen; the Gemini key is also refused by Google ("Your project has been denied access").
1. Groq: open https://console.groq.com/keys, click **Create API Key**, name it "Elevate OS", copy it. Then delete the old key in the same list (trash icon).
2. Gemini: open https://aistudio.google.com/apikey, click **Create API key**, choose **Create API key in new project**, copy it. Delete the old key.
3. Open `C:\OPENBOT\elevate-os\.env` in Notepad. Replace the text after `GROQ_API_KEY=` and after `GEMINI_API_KEY=` with the new keys (no spaces, no quotes). Save.
4. Never paste a key into a chat, an email or a code file. The checks refuse a commit that contains one.

*8b. Let staff devices reach this computer (once, as administrator).*
1. Click **Start** → **Settings** → **Network & internet** → **Wi-Fi** → click your Wi-Fi name (**Airtel_Airte_anan_2026**) → under **Network profile type** pick **Private network**.
2. Click **Start**, type `PowerShell`, right-click **Windows PowerShell** → **Run as administrator** → **Yes**.
3. Paste this line and press Enter: `New-NetFirewallRule -DisplayName "Elevate OS office Wi-Fi" -Direction Inbound -Protocol TCP -LocalPort 3000-3003 -Action Allow -Profile Private`
4. It prints the new rule. Close the window.

*8c. Start the app for the office.*
1. In the Claude Code chat type `! npm run office:build` (a few minutes; again after any update).
2. Type `! npm run office` in a separate terminal in the `elevate-os` folder and leave it open. It prints the addresses, for example `http://192.168.1.5:3000`.
3. On a staff phone or laptop on the same Wi-Fi, open that address and sign in with that person's own account. Use the same address on this computer too.
4. Google sign-in does not work on a Wi-Fi address; staff use their password.

*8d. Optional: turn on GitHub's own key blocker, if your plan has it.*
1. Open https://github.com/team832/Elevate-OS → **Settings** → **Code security** (left menu, under "Security").
2. If you see **Secret Protection** with an **Enable** button, click it, then enable **Push protection** below it. On some plans GitHub charges for this on private repositories, so it may not be offered; the check on this computer still applies.
3. When on, GitHub refuses any push that contains a key, as a second lock.

**9. Load the new sample records and demo sign-ins (this computer only).** The database updates are already applied. This adds the fictional sample tests, leads, marketing work and requests used in the walkthrough below. Only you can do it, because it changes the database on your computer.
1. Make sure the database is running (`npm run db:start` in a terminal in the `elevate-os` folder, left open).
2. In the Claude Code chat type `! node .data/json-backup.mjs` (a copy of every table, kept on this computer; the file is not in git).
3. Type `! npm run db:seed`. Running it again is safe (true since 31 Oct, step 10.6).
4. Check that `.env` has a line `LOCAL_DEMO_PASSWORD=` followed by a password of at least 12 characters (step 4 above). Then type `! npm run db:seed-demo-accounts`. It prints the sign-ins, never the password.
5. Before real staff use the system, type `! npm run db:clear-samples` (removes every sample record and switches the demo sign-ins off).

### Decisions waiting for you

Until you answer, the system uses the safe choice shown and marks it "Proposed". The newest questions come first, most important at the top of the list.

#### New 31 Oct: 1. Stops real use (answer these first)

| Question | Safe choice used today |
|---|---|
| How do real staff sign in, and how do they confirm an admission? New accounts have no password, no screen sets or resets one, and confirming an admission asks for a password. Either signing in with Google again counts for confirming (D-041), or a set-password screen gets built | Sign-in needs Google. Confirming refuses anyone with no password, so no real admission can be confirmed yet |
| Where should uploaded files be kept? This covers test papers and answer keys, score imports and task files | Refused with a plain message in office mode and online. Marks by hand and publishing still work |
| Who runs the background jobs, and how often? An exit or a corrected name reaches Academic only when someone presses the button. The same goes for reminders, Academic replies and demo attendance | Buttons on the Business Operations Overview, operations manager only. Pressing one twice is safe |

#### New 31 Oct: 2. Going live and the first install

| Question | Safe choice used today |
|---|---|
| Going live: one address with one port per app is the only shape that works today. Any other shape needs more work (see the release notes). Is that shape acceptable? | One address, four ports |
| Wrong-password limits are counted separately in each app and forgotten at restart, and 20 wrong tries on someone's email lock that person out of one app for 15 minutes. Acceptable until you have a host? | As built |
| On a first install, load the 8 real staff and their assignments? Their names ship inside the package either way, so keep it private | Not loaded |
| Load the old marketing history (59 ideas, 36 placements)? | Not loaded |
| Load the two planning batches, the draft syllabus courses and the website-stated prices? | Loaded, labelled |
| Starting names (departments, programmes, lead sources) are loaded once and staff can then edit them. Must any of them go back to the loaded wording each time the starting data is loaded again? | None: staff edits are kept |
| Who may add lead sources and programmes on a screen? | No screen: they come from the starting data |
| Office mode runs your database from a beta build of the database tool. Acceptable until you have a host? | As built |
| Business Operations settings say "In use, not yet approved", and no screen approves them. How should your approval be recorded? | They stay in use as they are; you tell the developer and it is written down |

#### New 31 Oct: 3. Money

| Question | Safe choice used today |
|---|---|
| Money above the whole agreement, such as ₹2,00,000 recorded on a ₹1,00,000 agreement: refuse, warn or allow? A typing slip saves silently today; an advance may be real | Accepted, and shown as a credit |
| A finance officer cannot open a student's Fees tab, so no screen lets finance record a payment on an admitted student's yearly agreement. Give finance read access to students, make a fee-only page, or show the fee section on the admitted case? | Finance sees Collections and Outstanding; the operations manager records the payment |
| A signed paper turns out to hold a wrong fee figure (step 11a): print and sign it again, or keep it with a note? | Nothing is rewritten; the case page shows the right figure |
| May one receipt number be recorded twice, for example one receipt across two instalments? Refuse, warn or allow? | The same receipt, amount, date, charge and instalment is refused; a different amount is accepted. This changes the earlier "a second identical payment is deliberate" rule |
| A discount, waiver or credit above what is owed: refuse it? | Refused (Proposed). Demo credits are exempt |
| A demo fee credited to tuition: must the credit be undone before it can be refunded? | Yes (Proposed). Credits already refunded stay ₹1,000 short until reversed |
| A refund dated before the payment it returns: refuse it? | Refused (Proposed) |
| An added charge (a debit): which instalment does it belong to, if any? | None: no due date, never overdue, still counted as owed (Proposed) |
| Should an added charge have its own line on the signed form? | Yes: printed on its own line as "Added charge (debit)" (Proposed) |
| An agreement closed on purpose with money unpaid: is that money still owed? | Counted on the Fees tab, fee year, statement and exit record; left out of Outstanding, Overview and fee status (Proposed) |
| The case page and exit record show everything the student owes across all cases, including registration and demo fees; the Fees tab, Outstanding, Overview and fee year show tuition. Is that the right split? | As stated (Proposed) |
| Two leads merged: should the ₹1,000 demo fee on the lost lead's case move across? | It stays on the lost case |
| Fee structure rows: entered on the fee screen, or imported? | No screen adds them; the page says it waits for you |
| Count tiles on the HR page and task reports are not marked when they include sample records (money figures are). Mark them too? | Not marked |

#### New 31 Oct: 4. Marks and tests

| Question | Safe choice used today |
|---|---|
| Who may correct a mark that is already checked or final? | Only the academic coordinator, with a reason typed for each mark that changes. Old and new marks go in the audit history (Proposed). Teachers, directors, auditors and operations managers cannot |
| A correction on a test whose results are already final publishes a new version of the results at once, with no second person and no press of Publish. Should it wait for someone to publish it? | Published at once as a new version marked "Re-scored"; the earlier version stays on record as Replaced (Proposed) |
| A teacher's typed mark counts as checked the moment it is saved, and after that the teacher cannot change it: they see "Ask the academic coordinator". Should it stay checked at once, or wait until someone else checks it? | Checked at once (as built) |
| Ranks say "Hidden" on a fresh system until the Academic setting is turned on, although the walkthrough shows 1, 2, 2, 4. Turn it on? | Hidden (D-103, Proposed) |

#### New 31 Oct: 5. Students leaving, corrected names, merged leads

| Question | Safe choice used today |
|---|---|
| Who may end an enrolment before it starts? Academic is refused until the start date | Refused in Academic, with an explanation: record an exit on the student's record in Business Operations instead |
| A student leaves before their first day: delete the unstarted batch place? | Deleted; the audit history keeps it |
| An exit dated in the future: close the case today and let attendance run to that date? | As stated |
| On exit: cancel open catch-up tasks and remove untouched later test rows, and keep rows that hold marks? | As stated |
| A transferred or "other inactive" exit ends as "withdrawn" in Academic. Separate statuses need another database update. Is "withdrawn" enough? | Withdrawn in Academic; the true outcome stays in Business Operations and the audit history |
| A coordinator ending an enrolment in Academic does not tell Business Operations. Should it? | Not told |
| "On hold" in Business Operations does not pause Academic, and leave HR records directly does not flag anything there. Should they? | No link. An approved leave application does tell coordinators (see Teachers, HR and tasks) |
| When a teacher leaves, should assignments end and tasks move automatically? | No. Their manager, operations managers and coordinators are told what they held |
| After a student's name is corrected: reprint the acknowledgement and ID card, or leave them as issued? | Left as issued (Proposed); the case page says so. An application form already generated or signed must be redone |
| When a case is lost or merged, should its demo classes be cancelled automatically? | A person closes them and the page warns; the slot stays held until then |
| "Active" students means admitted, awaiting enrolment or enrolled. Is that right? | As stated (Proposed) |
| After a real merge, the old lead still shows the new lead's id and code. Is that acceptable? | Left as is: it records the merge |

#### New 31 Oct: 6. Duplicate checks

| Question | Safe choice used today |
|---|---|
| A duplicate check matches a lead the person may not see: how much should they be told? | Only "exact" or "possible", with no name, code, owner or count. A name-and-school match with no shared contact is left out for them and still flagged for merge review (Proposed) |
| Someone could try phone numbers one after another to learn which are on file. Should duplicate checks have a limit per person per day? There is no shared counter today; one needs a small database update | Every check is logged, with no limit (Proposed) |

#### New 31 Oct: 7. Teachers, HR and tasks

| Question | Safe choice used today |
|---|---|
| A student moves to another batch: should the old teacher's read access end on the transfer date? | It ends with the teacher's assignment to that batch |
| Should a replaced teacher be told about a substitute? | No |
| A teacher named on a batch but on no class sees its students and marks and no classes. Is that right? | As built |
| The Teachers list shows only staff with a subject on their record, so someone assigned to a batch with no subject recorded is missing from it (on the test data, IPMAT: 9 assigned, 5 listed). Should it list everyone assigned? | As built |
| Requests from counsellors, finance, directors and operations managers go to the operations managers, not the HR manager, because of the Proposed HR scope. With only one operations manager, their own request reaches nobody. What should happen? | As stated |
| HR cannot add a staff record, and the HR manager cannot send a request. Should they? | No (grants Proposed) |
| A request forwarded to someone with no permission to send requests is refused. Should they be able to reply anyway? | Refused; HR chooses someone else or answers it |
| When HR makes a task from a request, should the sender be told? | Not told |
| May HR move someone to a department outside HR's scope? Today it works, then HR can no longer open that record | Allowed; only an operations manager can undo it |
| Should a screen offer unlinking a login from a staff record? | No screen |
| An address in the first-administrator setting gets its roles back at every sign-in, so it cannot be permanently demoted. Is that acceptable? | As built, recorded in the audit history |
| Who should hear a comment or a blocker on a task? | Nobody: it shows on the task only |
| Should teachers and counsellors also get Personal Settings (pop-ups off, reminder spacing)? | Marketing only |
| You said the HR manager approves leave, but HR reaches only the departments it looks after. Should the operations manager approve as well? | Both approve, each within their reach (Proposed), so applications from other departments reach someone |
| Approved leave can be cancelled only by HR, with a reason. Should the person who applied be able to cancel it themselves? | No (Proposed). They can cancel while it is still waiting |
| Leave dates more than a year back or ahead, or one application over a year, are refused to catch a mistyped year. Should that limit stay? | It stays, with no setting to change it |
| An auditor can read leave lists but cannot apply for leave, while every other staff role, the director included, can. Should an auditor be able to apply? | No (Proposed) |
| With only one operations manager, outside the departments HR looks after, their own leave application reaches nobody, because nobody decides their own. What should happen? | It waits, and nobody is told |
| When a teacher's leave is approved, coordinators get only a count of planned classes, and no notice if it is later cancelled. Is that enough? | Count only, nothing reassigned, not told of a cancellation |
| May the director and auditor read why someone is on leave? It can be medical | No (Proposed). They see the type, dates and status; only the person and those who manage attendance read the reason |
| HR can record leave directly, with no application, and this skips the check for overlapping dates. Should that check apply? | No check on direct records |
| Must a new task have details and an expected result? | Neither is required |
| On HR Attendance, should the Who filter start on everyone, teachers or other staff? | Everyone |

#### New 31 Oct: 8. Academic set-up

| Question | Safe choice used today |
|---|---|
| Coordinators see student and guardian phone and email in Academic; directors, auditors and teachers do not. Is that intended? | As built |
| Subjects and chapters cannot be added on a screen. Is the loaded curriculum enough? | Loaded curriculum only |
| Paused programmes still accept new courses. Should they? | Accepted |
| A class length set on one batch counts as approved, and scheduled classes of another length then show as hard conflicts. Is that right? | As built |
| "Plan in use for teaching" on Curriculum means an active course with a locked or provisional plan. That wording was ours: is it what you mean? | As stated |
| Should Progress and support be on a teacher's menu? | Not on the menu; teachers reach a student's progress from their own lists |

#### New 31 Oct: 9. Marketing and events

| Question | Safe choice used today |
|---|---|
| Old records marked published with nothing posted (step 11b): change them? | Not changed; the dashboard over-counts them |
| A monthly report for a month still to come answers "not found". Is that right? | As built |
| Should an event's capacity also limit invitations? | Limits registrations only |

#### New 31 Oct: 10. Names and look

| Question | Safe choice used today |
|---|---|
| After the rebuild, are the arrows you saw still there on your screen? Four arrow-like things were fixed, and I cannot tell which you meant. Pictures are under "Pictures you can look at" above | The four fixes stand |
| Which name for each pair: Requests through HR or HR Requests; My reports or My Work Updates; My tasks or My Tasks; Tests and Mock Tests or Assessments? | As they are today |
| Slim scrollbars with no arrows, and table headers on several lines: do they suit the look you chose? | As built |

#### New 31 Oct: 11. Tidying

| Question | Safe choice used today |
|---|---|
| Clearing expired sign-ins keeps ended sessions for 30 days. Is that long enough? | 30 days |
| 17 data connections no screen uses, and 60 that repeat what a screen does directly: keep them? | Kept |
| Two permissions nobody holds, and an empty leftover folder: remove them? | Left as they are |
| A script that prepares old data holds real staff names and roles (no phones or emails). Acceptable in a private repository? | Left as is |

#### Earlier questions, still open

| Question | Safe choice used today |
|---|---|
| **New 24 Oct (staff).** Is `soma@elevateeducation.in` the "Soma" who teaches CLAT Current Affairs (not Soma Tiwari)? I assumed so for the demo sign-in | Linked to "Soma" (CLAT Current Affairs), marked as an assumption |
| **New 24 Oct (requests).** Which staff record is Schar? (D-096) | The sample records name a fictional Sample Schar. On a database with no samples, or after clearing them, it is not set and requests for Schar wait in HR's queue |
| **New 24 Oct (leads).** Does an admission that was later withdrawn, transferred or completed still count as a conversion? (D-105) | Yes, with a flag (Proposed). Cancelled before enrolment and lost never count |
| **New 24 Oct (reminders).** Task reminders: once 24 hours before the due time, every 24 hours while overdue, every 4 hours until a new task is acknowledged? (D-108) | As stated (Proposed) |
| **New 24 Oct (reminders).** There is no automatic timer yet, so task reminders and follow-up reminders go out only when someone starts them, and only the operations manager may start them. Who should run them, and how often? | Run by hand by the operations manager. Answered together with "Who runs the background jobs" above |
| **New 24 Oct (requests).** May HR pass a request to staff outside the departments it looks after? | No, except to the person the request was meant for; the operations manager may pass it to anyone |
| **New 24 Oct (marketing).** Should monthly marketing reports go to HR (as the brief says) or to the employee's reporting manager? (D-109) | Reporting manager |
| **New 24 Oct (tests).** When a teacher types scores, are they verified at once, or "imported" until someone else checks them? | Verified at once (as built). The same question as in "Marks and tests" above |
| **New 24 Oct (tests).** Show ranks the competition way (1, 2, 2, 4), counting only students who were present with checked marks? (D-103) | Built that way; display Proposed |
| **New 24 Oct (tests).** When may a question paper and answer key be released: from the test day, or any time? (D-094) | From the test day (Proposed) |
| **New 24 Oct (tests).** A score arrives for a student recorded absent: refuse it, or let a person overwrite after confirming? | The whole import is refused until the attendance is corrected |
| **New 24 Oct (marketing).** For admission targets, who gets the credit: the lead's owner when the admission is confirmed? | Lead owner at confirmation (Proposed) |
| **New 24 Oct (marketing).** May employees move their own calendar items to another date? May someone cancel an approved item they own? | Employees cannot move dates (needs the scheduling permission); they can cancel any open item they own, approved ones included (Proposed) |
| **New 24 Oct (teachers).** May teachers see published reviews that have no subject? | As built (Proposed) |
| **New 24 Oct (tasks).** May a task's backup person comment on it? | No (HR and reviewer only, D-098) |
| **New 24 Oct (requests).** Request categories: Tasks and deadlines, Attendance, Leave, Timetable changes, Classes and batches, Students, Resources, Development support, Something else? | Those nine since 31 Oct (Proposed). See step 10.6 if your database holds an older list |
| **New 24 Oct (fees).** A closed fee agreement with money unpaid: does it stay "outstanding" until someone waives it? Is "due now" today only, or should it include the next few days? May the finance officer open a student's record from the fee list? (D-101) | Since 31 Oct: still owed on the Fees tab, fee year, statement and exit record, left out of Outstanding, Overview and fee status (see Money above); today only; no |
| **New 24 Oct (requests).** May the operations manager read every request through HR, including complaints about administrators? | Yes |
| **New 24 Oct (samples).** May a sample admission be confirmed, so a sample lead can reach Converted in the demo? | No: sample leads stop at "Admission in progress" |
| **New 24 Oct (marketing).** Every marketing employee can read every calendar item and every SEO / AI-search work item, even outside the campaigns they belong to (they can change only their own). Keep that, or limit reading to their campaigns like content (D-093, D-107)? | Everyone in Marketing reads all (Proposed) |
| **New 24 Oct.** Every new permission from this milestone (tests, requests through HR, lead merge, calendar, SEO/AI-search work, targets, reports) is marked Proposed (`PROPOSED-GRANTS-2026-10-23b`). Are they right? | As built, all Proposed |
| **New 23 Oct (HR).** Are the new HR permissions right? The HR manager runs staff records, attendance, task review, work reports and teacher feedback; every staff member sees their own attendance; the director, coordinators and the marketing manager review their own team's tasks (D-080) | As built, all marked Proposed |
| **New 23 Oct (HR).** Which staff does HR look after? Today: the Academics and Marketing & Growth departments, plus anyone with no department yet (so HR can place them) | As stated (Proposed) |
| **New 23 Oct (HR).** May an operations manager end the employment of another operations manager? (Directors and platform administrators can never be changed from HR) | Yes |
| **New 23 Oct (HR).** HR staff who also teach: they cannot read raw student feedback about teachers and must pass that work to a colleague (D-088) | As stated (Proposed) |
| **New 23 Oct (HR).** When the person who creates a task gives it to themselves, should they be allowed to switch its review off? | No — the owner of a task can never switch its review off |
| **New 23 Oct (HR).** Attendance and report settings: 10 minutes' grace before "late"; half day 4 hours, full day 8 hours; the week starts on Monday; no deadline for weekly or monthly reports; feedback shown only for groups of at least 5 students; ratings 1 to 5; six feedback categories (explanation clarity, pace, doubt resolution, preparedness, classroom engagement, helpfulness of materials); an approved task can be reopened by its reviewer or HR; AI drafts limited to 50 per person per day | As stated (all Proposed) |
| **New 23 Oct (Marketing).** Marketing employees cannot assign people to content (only the marketing manager can), and they still see the weekly figures of every social account | As stated (Proposed) |
| **New 23 Oct (staff).** Nikunj Bindal: is CA Foundation Accounting (course `CAF-ACC-SEP27`) right as "waiting for a batch"? This was my pick; on 21 Oct no assignment was made (D-082) | Recorded as waiting, opens nothing |
| **New 23 Oct (staff).** The sign-in `soma@…`: which Soma is it — "Soma" (CLAT Current Affairs) or "Soma Tiwari" (Economics)? The other session made a ruling; please confirm it | As ruled in the other session |
| **New 23 Oct (files).** Where should uploaded files be kept once the system is on the internet? Until you choose, uploads work only on this computer (D-085) | Uploads refused online. Answered together with "Where should uploaded files be kept" above |
| **New 23 Oct (samples).** The fictional sample teacher is also the main Quant teacher on the real IPMAT April 2027 batch, beside Satish. Run `npm run db:clear-samples` before real use (step 4.5) | Sample stays until you clear samples |
| **New 23 Oct.** Is the new light look right? Open each workspace on your own screen and phone (D-074) | As built; the dark look is kept as a backup |
| **New 23 Oct.** Users & roles still has an "Overview" page for signed-in people, left from before the workspaces. Keep it, or delete it and keep only Users & roles? | Kept |
| **New 23 Oct.** May counsellors see the three staff-only parts of a teacher review (attendance evidence, homework evidence, academic concerns) for their own students? | Yes (Proposed) |
| **New 23 Oct.** Teacher review boxes: is 1,500 characters each the right limit? | 1,500 (Proposed); older reviews up to 4,000 still open |
| **New 23 Oct.** Should Business Operations see campaign results from Marketing? | No |
| **New 23 Oct.** May the marketing manager see the contact details of every lead, or only the leads Marketing brought in? (D-073) | Every lead (Proposed) |
| **New 23 Oct.** Will another system ever send leads into Elevate OS (a website form, a CRM, Meta lead ads)? The unfinished Marketing-to-Business-Operations lead connection was retired (D-075) | No connection; leads are typed in or worked on the shared lead list |
| **New 23 Oct.** Who may generate and read the new internal teacher report, and should the auditor see it? | Operations manager and director (Proposed); the auditor cannot |
| **New 22 Oct (workspaces).** Who opens which workspace: teachers only Academic; academic coordinators Academic and Business Operations; marketing staff only Marketing, with leads, lead contact details and their own tasks (D-073)? | As stated (Proposed) |
| **New 22 Oct.** Should Marketing see Events and Webinars? It needs a new permission that covers only events, because today's meeting permission also covers private counselling | Hidden in Marketing |
| **New 22 Oct.** An enquiry's campaign is typed as free text. Should it be chosen from the list of campaigns, so results by campaign (leads → demos → admissions) can be counted? | Free text; results by campaign not shown |
| **New 22 Oct.** When a lead comes in several times from different sources, which source counts in "leads by source": the first enquiry, or every enquiry? | Not decided; shown as recorded |
| **New 22 Oct.** Keep a student's guardian name and relationship hidden from teachers, directors and auditors in Academic (phone and email were already hidden)? | Hidden |
| **New 22 Oct.** Menu names and defaults: Business Operations groups "Teaching and work" and "Insight"; the Overview opens on this month to date; in Marketing, Ideas is a tab under Content Calendar and Accounts a tab under Campaigns | As built |
| **New 22 Oct.** Google sign-in now returns to `http://localhost:3003/api/v1/auth/google/callback` (step 5 above), so the admin app must run for Google sign-in | As built |
| May staff who sign in with Google confirm admissions by signing in with Google again? Today every real staff account is Google-only, so **nobody real can confirm an admission yet** (D-041) | Only an account password is accepted. Answered together with "How do real staff sign in" above |
| Who may confirm admissions? | Director and operations manager (Proposed) |
| Is the ₹5,000 registration fee charged again each academic year? (D-044) | Once per student |
| Should the director see students' private details (phone, address, documents)? The director can confirm admissions but sees "Details hidden" | Hidden |
| Discounts, waivers or credits on a running fee agreement: is one approver enough, or must a second person approve each one? (D-057) | One approver who did not make the agreement |
| Should a paid demo fee be credited automatically when the student joins? | No — staff post the credit by hand |
| Onboarding checklist items, due days and owners | A proposed standard list, marked "(proposed)" |
| Who may add extra demo days, and who may correct demo attendance? | Extra days off |
| Student or parent reports: which audiences, and should teacher names appear? | Staff-only reports |
| The menu grouping (changed on 22 Oct to Overview, Admissions, Students, Money, Teaching and work, Insight — see the question above) | As built |
| The five draft syllabus courses and their codes; CA chapter weights (D-051) | Drafts, not used for teaching |
| After a student moves to another batch, how long may the old teacher still write a review about them? | Only while the student is in a batch the teacher teaches that day |
| The two review labels, "Staff only" and "May inform a reviewed parent summary": right words, right two choices? | As built |
| May a teacher see a student before the teacher's assignment or the student's batch place starts? | No |
| May coordinators link any class to a review, or only classes the writer taught? | Only classes the writer taught |
| Who may read and acknowledge teacher reviews in Business Ops: counsellors (their own students) and the operations manager? | As stated (Proposed) |
| Does a manager see only the end-of-day reports sent to them, or also older reports sent to someone else? | Only reports sent to them (Proposed) |
| Must staff give a reason for every unfinished task when they send the end-of-day report? | No |
| Who may cancel work that someone else assigned? | The person who created the task, or the operations manager |
| When a task needs a review but no reviewer is named, who reviews it? | Only the operations manager can approve it |
| Is there a time by which the end-of-day report must be sent? | No deadline (open) |
| If Academic cannot be reached, may counsellors mark demo attendance for a class that is linked to an Academic class? | No; they wait until Academic is back |
| Should staff with nobody reporting to them see the report "Inbox"? | Shown to managers and to everyone who may review reports |
| Who should see the Reports item in the tasks menu? | Everyone who can open Tasks (they see only tasks they may see) |
| Six sample teachers have no Academic classes because their subjects exist only in draft syllabus courses. Add sample batches on those draft courses? | No |
| Academic attendance: does "late" count as attended, and are "excused" classes left out of the percentage? | Late counts; excused left out (Proposed) |
| Show rank and percentile on Academic progress? | Hidden. Answered together with the ranks question in "Marks and tests" above |
| Academic trends: which results may be compared? | Same kind of test, same subject and same maximum marks (Proposed) |
| Do tasks imported from the old Task Tracker count when measuring how often end-of-day reports were sent? | No; shown as "Imported — not sent" |
| Who may close a task that has no reviewer? | The task owner (Proposed) |
| Should end-of-day reports be sent outside the system (email or WhatsApp)? | Not connected; "Copy summary" and PDF only |
| A staff account cannot be deleted while it is the only person on a Marketing content assignment (writer, reviewer and so on). Keep refusing, or should the system first ask you to hand that work to someone else? | Refused; reassign the work first, then delete |
| The audit history (who changed what) is never changed by the system, but the database itself does not forbid it. Add a database rule later so even a developer mistake cannot edit or delete it? | No database rule yet (the code only adds rows) |

Decided by you on 24 Oct 2026 (D-110): no OpenAI; free AI services Groq, then Gemini, then OpenRouter; student feedback, work reports and task text may be sent with names hidden; staff use the app over the office Wi-Fi.

New on 24 Oct 2026 (D-111): **Build draft timetable** in Academic (Timetable → Patterns; drafts only, you publish), an AI-drafted **Overall comment** on the progress and teacher reports, the monthly marketing report draft now uses the marketing figures, and **Write an AI summary** on a student's Overview. Admission documents got no AI: every field is personal or your fixed legal text. Questions for you: (1) a standard school day (for example 09:00–17:00) to prefill the timetable form? (2) a daily AI limit per person in Academic too? (3) may the AI-drafted comment on the PTM report go to parents, or internal only? (4) a generated report's comment cannot be edited; a new report is needed. Is that acceptable?

Already decided by you on 21 Oct 2026 and built: registration ₹5,000 (D-044), demo ₹1,000 (D-045), the declaration and terms from your paper form, version 2 (D-046), Nikunj Bindal teaches Accounts (D-047), address and GSTIN as on the form (D-048), public email `team@elevateeducation.in` on documents (D-049), daily tasks and EOD reports (D-052), a new layout (D-054, D-059; the dark look itself was replaced on 22 Oct, D-074), teacher reviews written in Academic (D-058), demo attendance marked by the teacher in Academic (D-060), sample staff named "Sample …" with `@example.test` sign-ins (D-061). On 23 Oct 2026: HR back inside Business Operations, including staff attendance (D-080, D-086; answers the old staff-attendance question OD-026), teachers see approved feedback summaries in Academic (D-088), the charcoal sidebar (D-081), your staff answers on Soma, Satish and Nikunj (D-082), directors make student reports (D-079), AI drafting with the model you chose (D-092). Later on 23 Oct 2026: tests are one record in Academic run from Business Operations (D-094), score sheets as CSV or PDF only (D-095), Schar as a setting (D-096), "business administrator" = operations manager (D-097), task comments by HR and the reviewer only (D-098), AI reading of PDF score sheets with your tick each time (D-099). On 31 Oct 2026: leave applications, with the HR manager approving and Casual, Sick, Earned and Unpaid leave, both settings HR can change and no balances counted (D-126; answers the old leave question OD-026), and mock data everywhere, with a fictional Sample Schar (D-127).

**What is not connected yet.** Email and text messages, event invitations, the social-media publishing tool, a biometric device and a CRM are "pretend" connections or not connected at all; file uploads work only on this computer until you choose where files are kept online (D-085): they record what would happen and never claim it happened. Hindi (Devanagari) now prints correctly in every PDF, with two limits: copying or searching Hindi from a PDF can give the letters in the wrong order, and Tamil, emoji and rare Devanagari letters still print as "?" with a note at the foot of the page (no warning appears when such a name is typed).

**Security.** Every page checks who is signed in and what they may see. Most students are minors, so phone numbers, addresses and documents are shown only to staff with the private-data permission, and every contact search is logged. Passwords and keys stay in a private settings file (`.env`) that is never uploaded.

---

## Milestone 23–24 Oct 2026 — tests, requests through HR, marketing workflows, fee chart

_Decisions D-094 … D-109. Status words per D-013; nothing is Deployed. Details and test files: `IMPLEMENTATION_STATUS.md`, section "Milestone 23–24 Oct 2026"._

### What was built (plain words)
- **Tests and Mock Tests** (Business Operations → Tests): schedule a test for one or more batches with sections and negative marking; a roster taken from the batches; upload the question paper and answer key (each upload a new version, hidden until released); import scores from CSV, or from a PDF read by AI after a tick; review matches (unclear rows wait for a person); publish results with ranks; correct and withdraw. The record lives in Academic, so teachers see the same test (D-094, D-102, D-103).
- **Requests through HR** in every workspace: write, submit, follow; HR reviews, answers, declines or passes it on; the person it is passed to sees only what HR forwards (D-096, D-106).
- **Lead stages and sales calls** in Business Operations and Marketing: 12 stages, history, reasons for Lost / Duplicate / Do not contact, Converted only after a confirmed admission, calls with outcome and length, a duplicate-merge review (D-105).
- **Marketing**: content calendar with item types, briefs, owners and a linked task; the ideas plan; SEO / AIO / GEO work items with observations; targets with defined measures; a monthly report; personal notification settings; honest dashboard filters (D-107, D-109).
- **Notifications**: task reminders (due soon, overdue, not acknowledged), pop-up notices, and opening a notice re-checks access (D-108).
- **Fees**: the year's tuition as a paid-versus-outstanding chart with tiles; clicking "outstanding" lists the students behind it, and the two totals always match (D-101).
- **Task discussion**: HR and the reviewer only (D-098). **Teachers** see marks only for their own batch and subject (D-104).
- **Sample data**: about 36 fictional students, about 40 fictional leads, two fictional marketing employees, tests with ties, absences and a pending import, fee cases (paid, part paid, unpaid, future instalments), tasks in every state, all marked Sample.

### Workspace addresses (this computer only)
| Workspace | Address |
|---|---|
| Business Operations (incl. HR, Tests, Fees) | http://localhost:3000/ops |
| Academic | http://localhost:3001/academic |
| Marketing | http://localhost:3002/marketing |
| Users & roles (and Google sign-in) | http://localhost:3003 |

### Demo sign-ins (development only)
All share one password, `LOCAL_DEMO_PASSWORD`, which you set yourself in the git-ignored `.env` file in the `elevate-os` folder (at least 12 characters, used nowhere else). It is never written in the code, never printed and never sent in chat. `npm run db:seed-demo-accounts` refuses production and any non-local database; `npm run db:clear-samples` switches all of them off.

| Email | Role (from the stored roles) | Opens |
|---|---|---|
| `business@elevateeducation.in` | Operations manager, "Business administrator (demo)" (D-097) | :3000 |
| `hr@elevateeducation.in` | HR manager | :3000 |
| `teacher@elevateeducation.in` | Teacher (co-teaches Quant on `SAMPLE-IPMAT-B`) | :3001 |
| `marketing@elevateeducation.in` | Marketing manager (the two employees below report to it) | :3002 |
| `pooja.verma@example.test`, `rohit.saini@example.test` | Marketing employees (fictional) | :3002 |
| `schar.sample@example.test` | Sample Schar (fictional): answers requests forwarded to Schar (D-127) | :3000 |
| `satish@`, `soma@`, `nikunjbindal@`, `tushar@elevateeducation.in` | Teachers — development assumptions (real assignments only: Satish 3, Nikunj 1, Soma 1, Tushar 0; `soma@` = "Soma", CLAT Current Affairs, to confirm) | :3001 |

These email addresses are sign-in names only; no mailbox receives anything.

### Startup
`npm run db:start` (terminal 1, leave open), then `npm run dev:all` (terminal 2), or one workspace: `npm run dev:business`, `dev:academic`, `dev:marketing`, `dev:platform`.

### Database and sample data
- Migrations: `0015_hr_staff_workspaces` and `0016_milestone_hr_marketing_tests` are applied on the owner's computer (23 Oct; `npm run db:check` 19/19). `0016` is frozen (sha256 `87d96f7f…eec`); `0017` and `0018` came after it (step 10) and the next change is `0019`. On another computer: `npm run db:migrate`, then `npm run db:check`.
- Seeds (local only): `node .data/json-backup.mjs` (a local, git-ignored backup helper; `pg_dump` is not installed, D-024) → `npm run db:seed` → `npm run db:seed-demo-accounts` (after `db:seed`). Before real use: `npm run db:clear-samples`.

### Connections
- **AI (D-110)**: Groq connected and working (checked 24 Oct); OpenRouter connected as the backup (slower); Gemini connected but its key is refused by Google until you make a new one (step 8a). OpenAI is no longer used. Data sharing approved by you on 24 Oct, names hidden.
- **External analytics** (social, search, website): **not connected**; dashboards say "Not connected". SEO / AIO / GEO observations are typed in by staff.
- **Email, text messages, calls, social publishing**: none. Reminders and notices are inside Elevate OS only; "Published" on a calendar item is recorded by a person with a link or evidence.

### Limitations
- No scheduler: every job runs only when the operations manager presses its button. Since 31 Oct the buttons are on the Business Operations Overview ("Background jobs", D-117).
- Nothing is deployed; sign-in emails are not mailboxes; no outbound email, calls or publishing.
- A request through HR cannot link a campaign or a test (Business Operations cannot check them); HR's "create task from request" cannot carry a batch link.
- Between uploading a new paper or key version and releasing it, readers see no version at all.
- The sales-calls list shows at most the newest 500 calls for any filter, and the Tests page lists at most the newest 200 pending imports (shortcuts). Since 31 Oct the count tiles on leads and calls are counted in the database, so they stay right above those limits. Other capped lists, with no note on screen: calendar and deliverables 500, ideas and optimisation 500, funnel drill-down 2,000, placements 2,000, teaching-log exceptions 1,000 sessions, pickers 200 and 500. Not near these at current volume.
- The database rule on notification links now refuses control characters too, once `0017` is applied (step 10). `0017` also adds seven indexes (`placements_campaign_idx`, `attempts_student_idx`, `results_assessment_idx`, `duplicate_flags_matched_idx`, `demos_lead_idx`, `appointments_lead_idx`, `fee_records_lead_idx`).
- Sample leads never reach Converted (sample admissions still need legacy verification).
- The prototype `Elevate.html` does not show this milestone.
- Browser pass: run on 31 Oct 2026 on the first, second and third packages, on production builds; results in §6. The development mode was not walked for Academic, Marketing or Platform.

### Decisions waiting for you
The 21 questions from this milestone are the rows marked **New 24 Oct** under "Earlier questions, still open" in "Decisions waiting for you" above.

### Walkthrough of the main flows
1. **HR task to a teacher.** Sign in as `hr@` on :3000 → HR → Tasks → new task, owner a teacher, reviewer HR → Assign. Sign in as `teacher@` on :3001 → Tasks: the task is there (with a notice) → Start → Submit. Back as `hr@` → HR → Submission Review → Approve or Request changes. Collaborators can read but not comment (D-098). Reminders appear only after `business@` runs the task-reminders job.
2. **A request through HR.** As `teacher@` on :3001 → Requests through HR → new request (category, message, meant for HR or a named person) → Submit. As `hr@` on :3000 → HR → Requests → open it → mark reviewed, then answer and resolve, decline, or forward to a person in HR's scope. The person it is forwarded to sees only the forwarded note on their own Requests page and replies; HR relays the answer. The sender's message cannot be edited after submitting.
3. **Lead → admission.** As `business@` on :3000 → Leads → a lead → change stage (Contacted, Qualified, Demo booked …; Lost, Duplicate and Do not contact ask for a reason) and log a call. Book the demo and start the admission as before; once the admission is confirmed and has an admission number, Converted becomes available on the lead. Marketing (`marketing@` on :3002) sees the same stages, the funnel and the sales calls; stage credit goes to whoever owned the lead when it entered the stage.
4. **Calendar item to published.** As `pooja.verma@example.test` on :3002 → Content calendar → New item (type, channel, date, brief) → plan → start → submit. As `marketing@` → open it → Approve (nobody approves their own item) → Schedule → Publish, giving the post's link or evidence. Nothing is posted automatically.
5. **A test from schedule to published.** As `business@` on :3000 → Tests → New (batches, date, sections and marking) → open it → roster (taken from the batches) → upload paper and key → import scores (CSV, or PDF with the "I confirm" tick) → review the import (fix ambiguous and unmatched rows; "mark scored students present" is a separate button) → confirm → Publish. The sample `SAMPLE-CLAT-CA-01` has a pending import with an ambiguous row; `SAMPLE-IPMAT-MOCK-01` has a tie, ranked 1, 2, 2, 4 when ranks are shown (on a fresh system they say Hidden until the Academic setting `progress.show_rank_percentile` is turned on, D-103). The teacher sees the same test in Academic → Assessments.
6. **Fee donut drill-down.** As `business@` on :3000 → Fees → choose the academic year and course → the chart shows paid and outstanding tuition with due-now, overdue and future tiles → click "outstanding": the list of students and its header total match the chart exactly.

### Checks
Checks (31 Oct 2026): `npm run validate`, four webpack builds and the final re-test: GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held). First re-test, on the first package: 266 use cases, 260 pass, 3 fail, 3 held. Third package: 262 pass, 1 fail (ACH-01, fixed in source after), 3 held. Last re-test so far, on the fourth package: 263 pass, 0 fail, 3 held. Work after commit `a1f6ec7` is on no package yet. Details in §6.

Checks (24 Oct 2026, run by the coordinator): typecheck PASS; lint PASS (0 warnings); tests 4,074 of 4,075 passed in the full run — the 1 failure was a 30 s timeout under load in `applications.test.ts`, which passes 30/30 on its own; secret scan OK (1,775 files); webpack builds exit 0 for all four apps (platform, marketing-os, academic-os, business-ops-os). **Browser pass: not done** that day (skipped at the owner's request to save time). The browser pass of 31 Oct is in §6.

## 1. What was built and what was not

| Area | State | Where to read more |
|---|---|---|
| Foundation (sign-in, Google sign-in, Users & roles, sessions, roles, audit, outbox, approvals, shared UI) | Implemented, Tested | `IMPLEMENTATION_STATUS.md` |
| Marketing OS, Academic OS | Implemented, Tested | `IMPLEMENTATION_STATUS.md`, `apps/*/README.md` |
| Business Ops: admissions lifecycle, fees, students, events, exits, reports, search, daily tasks & EOD, new layout (D-038 … D-057) | Implemented, Tested (API); screens checked in Chrome by the coordinator | `IMPLEMENTATION_STATUS.md` "admissions lifecycle" section |
| Academic teacher workspace: placements, classes and attendance, delivery, substitutes, timetable patterns, teaching log, coverage, reviews, marks and publication, progress, reports (D-058 … D-071) | Implemented, Tested (API); screens checked in Chrome on 22 Oct at 1440 and 390 px | `IMPLEMENTATION_STATUS.md` "teacher workspace" section, `apps/academic-os/README.md` |
| Business Ops task tracker: task lifecycle and history, work updates, dependencies, end-of-day versions and manager inbox, task and period reports, tracker import, teacher directory, reviews read from Academic | Implemented, Tested (API); screens checked in Chrome on 22 Oct at 1440 and 390 px | same section, `apps/business-ops-os/README.md`, `docs/task-tracker-implementation.md` |
| Migrations `0000` … `0008` | Implemented; applied to the local database only | `docs/DATABASE_MIGRATION_PLAN.md` |
| Migrations `0009_academic_teacher_workspace_tasks`, `0010_link_academic_students_to_core`, `0011_mark_sample_academic_students` | **Applied on the owner's computer** 21–22 Oct (all frozen) | `packages/database/migrations/` |
| Migration `0012_missing_checks` (22 database rules the 22 Oct tests found missing; no data changed) | **Applied on the owner's computer** 22 Oct after a check found no rows breaking them (frozen) | `docs/DATABASE_MIGRATION_PLAN.md` |
| Role workspaces (D-072, D-073): Business Operations :3000, Academic :3001, Marketing :3002, platform :3003; one sign-in; chooser; demo sign-ins; teacher tasks/EOD/meetings in Academic; leads, follow-ups and tasks in Marketing; new Ops Overview, Collections, Outstanding, Academic and Marketing summaries | Implemented, Tested (rules and API); grants **Proposed** | `docs/WORKSPACES.md`, `IMPLEMENTATION_STATUS.md` "Role workspaces" |
| Migration `0013_workspace_preference` (remembered workspace per person) | **Applied on the owner's computer** 22 Oct (`db:check` 19/19) | `docs/DATABASE_MIGRATION_PLAN.md` |
| New look (D-074): light theme, floating rail, pill tabs, frosted panels and bottom sheets, charts in `packages/shared-ui`; dashboards in all three workspaces | Implemented, Tested (UI contract tests per app); the coordinator's browser pass on the final apps is pending | `IMPLEMENTATION_STATUS.md` "Redesign and integrity", `apps/*/README.md` |
| Cross-workspace integrity (D-075 … D-077): one attendance definition, dead tiles and the dead lead-handoff flow removed, unavailable-not-empty, per-workspace service keys, placeholder dashboard removed | Implemented, Tested | same section; `INTEGRATION_CONTRACT.md` §5, §7 |
| Migration `0014_teacher_reports` (table for generated teacher reports) | **Applied on the owner's computer** 23 Oct (`db:check` 19/19) | `packages/database/migrations/` |
| Teacher report PDF (D-078): generate, list and download from a teacher's page; stored snapshot with a `TR-` reference | Implemented, Tested (API; the page itself not yet browser-checked) | `apps/business-ops-os/README.md`, `docs/DECISIONS.md` D-078 |
| Student folio PDF in two kinds (PTM / internal, D-078) | Implemented and tested (sample PDFs looked at; the screen was not opened in a browser) | `docs/DECISIONS.md` D-078 |
| Security headers and CSP with per-request nonces (all four apps) | Implemented, Tested (unit test + production smoke, §6) | §5 below |
| Deployment, hosting, domain, monitoring, backups schedule | **Not built** (Proposed only) | `infrastructure/deployment/README.md` |
| Password reset / change screen, shared login rate limit, outbox scheduler, Google re-authentication for confirmation | **Not built** | `infrastructure/deployment/README.md`; `C:\OPENBOT\Elevate-Not-Working` |
| Migrations `0015_hr_staff_workspaces`, `0016_milestone_hr_marketing_tests` | **Applied on the owner's computer** 23 Oct (`db:check` 19/19; frozen) | `packages/database/migrations/` |
| Milestone 23–24 Oct (D-094 … D-109): Tests and Mock Tests, score import, ranks and publication, requests through HR, lead stages and calls, Marketing calendar / ideas plan / SEO-AIO-GEO / targets / monthly report, reminders and pop-ups, annual fee chart, sample data | Implemented, Tested (rules and API); grants **Proposed**; browser pass pending | "Milestone 23–24 Oct 2026" above; `IMPLEMENTATION_STATUS.md` |
| Debug pass 26 Oct and 30–31 Oct (D-112 … D-125): exit reaches Academic, workspace membership enforced on data connections, one fee statement, insert-only seeds, jobs panel, Hindi PDFs, release package | Implemented; tested on the first, second and third packages; final re-test GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held) | `IMPLEMENTATION_STATUS.md` "Debug pass", `docs/RELEASE.md`, `docs/CASELETS.md` |
| Migration `0017` (seven indexes, link rule) | Written and tested; **status on the owner's computer unknown** (step 10) | `docs/DATABASE_MIGRATION_PLAN.md` |
| Work after commit `a1f6ec7` (D-126 … D-131): leave applications, mock data everywhere, honest words with Academic stopped, settings as real fields, fee positions grouped once, the owner's two inspection lists | Implemented; automated tests in source; on no package yet; final re-test GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held) | `IMPLEMENTATION_STATUS.md` "Debug pass", `docs/DECISIONS.md` |
| Migration `0018` (leave applications, two indexes) | Written and tested; **not applied on the owner's computer** (step 10) | `docs/DATABASE_MIGRATION_PLAN.md` |
| Business facts (fees per programme, staff, holidays, targets) | **Missing — owner** | `PLACEHOLDERS.md`; OD-001…OD-048 in `docs/EXISTING_PROJECT_AUDIT.md` §9 |

Status words follow D-013: Proposed → Approved → Implemented → Tested → Deployed. Nothing is Deployed.

Sections of `website-build-guidelines` judged **not applicable**, and why: §10 SEO (an internal app behind a login; every response sends `X-Robots-Tag: noindex, nofollow` and pages set `robots: noindex`), and the public-site parts of §13 (no cookie banner: the only cookies are the essential session and sign-in-state cookies; no analytics or third-party embeds). The privacy notice for staff data (DPDP) is still owed, needs the owner's input and is marked `needs lawyer review`.

## 2. Stack and why

Node 24, npm workspaces, TypeScript (strict), Next.js 16.4.2 App Router as **four apps**: one per workspace (`/ops` on :3000, `/academic` on :3001, `/marketing` on :3002) and the platform (:3003) for Users & roles and Google sign-in. One session cookie covers every port (D-072); the platform's rewrites of the module paths remain as an optional single-site gateway (D-004). The database is PostgreSQL with one schema per domain, through Drizzle ORM (D-005, D-006), with zod validation (D-007), vitest and ESLint module-boundary rules (D-023). Styling is plain CSS tokens from `packages/shared-ui` (D-074): one vendored display font (Bricolage Grotesque, OFL) for titles and figures, the computer's own font for text; no CSS or chart library. No external CDN and no tracking scripts. Every version is pinned (D-018). The full reasoning is in `docs/DECISIONS.md` and README §3.

## 3. How to run locally

```bash
npm install
cp .env.example .env        # fill every "replace-with-…" value (README §5)
npm run db:start            # terminal 1: local PostgreSQL 18 on 127.0.0.1:54320; leave running
npm run db:migrate
npm run db:seed             # local databases only (refuses others)
npm run dev:all             # terminal 2: the three workspaces on :3000, :3001, :3002
```

One workspace alone: `npm run dev:business`, `dev:academic`, `dev:marketing`; Users & roles and Google sign-in: `npm run dev:platform` (:3003). Each starts the database if it is not running. Demo sign-ins: step 4 above. Guide: `docs/WORKSPACES.md`.

Daily use on this computer: `npm run office:build`, then `npm run office` (owner step 10.7, why and what changes). Installable package: `docs/RELEASE.md`.

Production-like run: `npm run build`, then `npm run start -w @elevate/<module>-os` for each module, then `npm run start -w @elevate/platform`.

The seed users are fictional `@example.test` accounts. They sign in on your own computer (password: `SEED_USER_PASSWORD` in the root `.env`); a production build refuses them (D-030), so a live site needs real `@elevateeducation.in` accounts.

Checks: `npm run validate` runs typecheck, lint, tests and the secret scan. `npm run build` builds all four apps.

Never run `db:reset` or `db:seed` against a non-local database. `pg_dump` is not installed (D-024), so install the PostgreSQL client tools before relying on `npm run db:backup`.

## 4. How deployment will work

**Nothing is deployed.** The hosting provider, database provider and domain are **owner decisions**. How to build, install and check the package, and every go-live blocker: `docs/RELEASE.md`. Outline: `infrastructure/deployment/README.md`.
- One host with one port per app is the only shape that works today (F-05). A gateway with only the platform public needs a second URL variable, written once a host is chosen.
- The proxy must overwrite `X-Forwarded-For` (API-010).
- PostgreSQL is a managed service with backups.
- CI runs `npm ci`, then `validate`, then `build`, then migrates after a verified backup.
- Request logs on the host and any proxy keep the path **without the query string** (search addresses can hold phone numbers, D-056).
- PDF fonts in `apps/business-ops-os/assets/fonts` must ship with the build; `npm run release:package` does this and refuses a package that lacks them.

Two settings are compiled in at **build** time, so set them before `npm run build`:
- The workspace URLs (`BUSINESS_OPS_OS_URL`, `ACADEMIC_OS_URL`, `MARKETING_OS_URL`): they are the allowlist for sign-in redirects and cross-origin form posts, and the targets of the optional rewrites.
- `PLATFORM_URL`. If it starts with `https://`, the build turns on HSTS and `upgrade-insecure-requests`.

## 5. Security headers (what was added 20 Oct 2026)

- **Static headers** come from `packages/configuration/src/security-headers.ts` → `securityHeaders()`, used by each app's `next.config.ts` `headers()`:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `X-Robots-Tag: noindex, nofollow`
  - `Strict-Transport-Security: max-age=31536000`, only when served over https.
  - `poweredByHeader: false`, so there is no `X-Powered-By`.
- **CSP with a fresh nonce per request** is set by each app's `src/proxy.ts` through `withContentSecurityPolicy()`. Next reads the nonce from the request's CSP header and stamps it on its own scripts and styles. The production policy:
  - `default-src 'self'`
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`
  - `style-src 'self' 'nonce-…'`
  - `style-src-attr 'unsafe-inline'`
  - `img-src 'self' data:`
  - `font-src 'self'`
  - `connect-src 'self'`
  - `object-src 'none'`
  - `base-uri 'self'`
  - `form-action 'self'`
  - `frame-ancestors 'none'`
  - plus `upgrade-insecure-requests` over https.
- **Why `style-src-attr 'unsafe-inline'`:** React `style={…}` props, which the pages use, render as `style=""` attributes, and nonces cannot cover attributes. Style attributes cannot run script. `<style>` elements still need the nonce.
- **Development** (`next dev`) relaxes the policy only for what Next needs: `'unsafe-eval'` for React dev error stacks, `'unsafe-inline'` styles for the dev overlay, and `ws:`/`wss:` for hot reload.
- **Multi-zone:** the platform's `headers()` skips `/marketing`, `/academic` and `/ops`. Each module app sets its own headers and CSP, and they pass through the platform's rewrite unchanged (verified with curl, §6).
- Nonces require per-request rendering. Every page is dynamic, including `not-found.tsx`, which calls `connection()`.
- **Do not** add a `<form action>` that redirects to another site, such as a Google sign-in start. `form-action 'self'` blocks it. Use a plain link.
- HSTS has no `includeSubDomains` yet. Add it once the owner confirms that no `elevateeducation.in` subdomain is HTTP-only.

## 6. Verification results

Run by the security agent on 20 Oct 2026 (Windows 11, Node 24.19.0):

| Check | Result |
|---|---|
| `npm test` (whole suite) | `Test Files 95 passed (95)` · `Tests 1064 passed \| 1 todo (1065)` |
| `npx vitest run --project configuration` | 2 files, 12 tests passed (incl. `tests/security-headers.test.ts`) |
| `npx eslint . --max-warnings=0` | 0 problems |
| `npm run typecheck` | exit 0 on the final run (an earlier run showed 3 errors in `apps/platform/tests/integration/overview.test.ts` from the Overview work in progress; they were fixed by the end) |
| `npm run secret-scan` | `secret-scan — OK (974 files checked, no secrets or .env files found).` |
| `npm run build` | exit 0; every route is dynamic (ƒ), including `/_not-found` |
| Signed-out GET via platform `:3000` | `/` (and the since-removed `/dashboard`, D-077) → 307 `/login`. `/ops`, `/marketing`, `/academic` and `/academic/{timetable,assessments,batches,curriculum,intake,progress,students,teaching}` → 307 to the zone's `/login`. `/ops/leads`, `/marketing/ideas` → 307 |
| Missing pages | `/ops/no-such-page`, `/academic/no-such-page`, `/marketing/no-such-page` → 404. `/no-such-page` → 307 to login when signed out (by design), 404 with a session cookie |
| `curl -sI` headers | All headers in §5 are present on platform and module pages, and through the rewrite. No `X-Powered-By`. Each response has a new nonce. Every `<script>` (12 on `/login`) carries the matching nonce |
| Browser (Chrome) | Production `/login`, `/academic/login`, `/marketing/login`, `/ops/no-such-page`: no console errors (no CSP violations). Dev: `/academic/login` through the platform shows `[HMR] connected` and no CSP errors |
| Banned-pattern grep (Appendix C) | No hits in production code. `console.log` appears only in CLI scripts (`scripts/**`), on purpose, as their output. Prose "any" in comments is not a type. Copy grep: brand-name hits only (exempt) |
| Data exposure spot check (§6.6) | `password_hash` is read only in `packages/authentication/src/login.ts`. Every join with `core.users` selects named columns. Session `token_hash` never leaves `sessions.ts` |

Not verified: pages behind sign-in in a browser (the seed users are `@example.test`, which D-030 rejects); axe, Lighthouse and keyboard passes. These belong to the release run.

Later runs: on 22 Oct 2026 a scripted headless-Chrome pass opened every static page and the sample detail pages at 1440 and 390 px (console errors, sideways scroll, one h1, labels, button names, image alt, duplicate ids, skip link, first-Tab focus, text contrast); its findings were fixed or filed in `C:\OPENBOT\Elevate-Not-Working`. Details: `IMPLEMENTATION_STATUS.md` "22 Oct 2026 — full test session". Lighthouse and axe are still for the release run.

### Final verification — 31 Oct 2026

`npm run validate`: GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held). Four webpack builds: GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held). Re-test on the final package: GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held).

First re-test, on the **first package** (database `elevate_v2`, ports 3000 to 3003, other checkers running). The failures below were fixed in the source afterwards, so these numbers describe that package only:

| Check | Result |
|---|---|
| Use-case register (`docs/CASELETS.md`) | 266 rows: 260 pass, 3 fail (TASK-17, HR-01, APP-06), 3 held (AUTH-13 needs real Google; STU-03 needs Academic stopped, a second process passed 16/16; WIFI-01 needs free ports) |
| Workspace membership | 22 of 22 refused, 42 of 42 own workspace answered 200. 481 handlers × 11 roles, 6,281 requests: 3,567 from non-members all refused, 0 server errors, 0 false refusals on 1,343 member reads. 28 path and header tricks refused |
| Interface per login | 19 logins: 0 of 671 denied pages opened, 418 of 418 allowed pages opened, 0 links to a page the login cannot open; 44 landings and 26 menus match; 11 roles, 11 menu sets |
| Attacks earlier marked NOT RUN | All RUN and held, each with a control. Self-approval 42 of 42; nested ids; XSS through review, PDF and score import text; EOD CSV; server-action replay (held, answers 500, RVA-004); log privacy (247 private values, 0 hits in 8.6 MB of logs); `@example.test` bypass; bootstrap; demo seed refusal; jobs by low roles; per-module tokens; Secure cookie; SSRF |
| Still failing at that point | API-010 (session address can be forged until a proxy overwrites the header: go-live item). API-011, Low (unknown API path answers HTML 404, wrong method an empty 405): left |
| Parallel use | Races 18 of 18, decided by the database. 50 sessions for 2 minutes: 6,473 requests, 0 server errors, median 58 ms, 95th percentile 811 ms, slowest 4,683 ms; PostgreSQL peak 41 of 100 |
| Fee figures | 160 hand-worked values across every surface: 0 mismatches |
| Exit | 44 of 44 per outcome. Leaver 37 of 37. 64 of 65 notice pairs open (the 65th was RVA-006) |
| PDFs | 7 kinds with a Hindi name, downloaded and looked at: shaped correctly |
| Browser | 6,160 production page loads: 14 console errors (8 dead link, 6 blocked print stylesheet), 0 warnings, 0 hydration messages. All 147 pages visited. Finance, counsellor and director list runs were **not** done. Dev mode **not** walked |
| Speed on `/ops` | Alone 264 to 298 ms (was 1,220 to 1,802). Forty at once: median 9.47 s (was 61.9 s). First visible change after a click 28 ms (was 517). Layout shift 0 (was 0.429) |

Later re-tests, each on a newer package. Their failures were fixed in the source afterwards, so these numbers describe that package only:

| Check | Second package (`elevate_v3`) | Third package (`elevate_v4`) |
|---|---|---|
| Automated checks before the package | Lint 0, typecheck 0, 285 test files, 4,952 tests, 0 failed, secret scan OK | 4,972 tests |
| Package | 11,016 files, 310.7 MB, archive 92.7 MB, 425 s | 11,032 files |
| Use-case register | 266 rows: 262 pass, 1 fail (APP-18, RVB-009), 3 held | 266 rows: 262 pass, 1 fail (ACH-01, RL1-001), 3 held. Held in both: AUTH-13, STU-03, WIFI-01 |
| Workspace membership | 22 of 22 refused, 42 of 42 own workspace 200. 6,281 requests: 3,567 non-member refused, 0 server errors, 0 false refusals on 1,343 member reads | The same numbers |
| Interface per login | 19 logins: 0 of 671 denied pages opened, 418 of 418 allowed, 0 links to a page the login cannot open, 0 dead links; 11 roles, 11 menu sets | The same numbers |
| Attacks and bad input | All held with controls: self-approval 43, nested ids and XSS 45, private server 31. 8,335 bad requests, 0 server errors. 252 private values, 0 in the logs | All held: 0 failed across every attack script. Sweep 7,839, fuzz 3,891, crawl 192: 0 server errors, 0 leaks |
| Races | 18 of 18, decided by the database | 21 of 21 |
| Fee figures | 171 hand-worked values over 15 tables: 0 wrong | 171 of 171 |
| PDFs | 7 kinds with a Hindi name, looked at | Form, card and report looked at; no page of any kind ends on a heading |
| Browser | 11 logins, 3,480 page loads: 0 console errors, 0 warnings, 0 hydration messages, 0 failed requests; page overflow 0 on 1,740 shapes. 241 lists, 438 row opens, 272 Escapes on 5 logins, including finance, counsellor and director | 3 logins, 1,152 page loads: the same zeros. 237 Ops shapes not reached in the time allowed |
| 50 sessions for 2 minutes | 6,763 requests, 0 server errors, median 51 ms, 95th percentile 554 ms, slowest 2,971 ms; PostgreSQL peak 41 of 100 | Not run |
| Speed on `/ops` | Alone 163 to 530 ms. Forty at once: median 16.53 s, 877 MB, with the PC 34 to 54% busy (first package 9.47 s, 685 MB): to be measured again on a quiet PC. First visible change after a click 27 ms | Not measured |
| New defects found | RVC-025 to 033, RVA-007, RVA-008, RVB-008 to 010 | RL1-001 (Medium, made by the last fix), RL1-002, RL1-003, RL2-001 to 009, all Low |

**Fourth package** (`elevate_v5`, built from commit `a1f6ec7`; it holds none of the later work): lint 0, typecheck 0, 285 test files, 4,980 tests, 0 failed; 11,032 files, 310.8 MB, archive 92.7 MB. Register 263 pass, 0 fail, 3 held (AUTH-13, STU-03, WIFI-01). Membership 22 and 42. Walks: 0 denied pages opened, 0 server errors, 0 no-access links. Races 21 of 21. Fee figures 171 of 171. Browser, 4 roles, 1,110 loads: console, warnings, hydration, failed requests and overflow all 0. New, Low, not fixed: RL2-010 (from the Blocked list "Awaiting approval 5" opens all 46), RL2-011 and RL2-012 (ISO dates on `/academic/my-reports` and in a notice). Not reached: 245 Ops page shapes; a real phone. RV-D's volume run on this package found the slowdown fixed by D-131 and the false words fixed by D-129.

Not run: axe and Lighthouse; a keyboard pass of every template (the browser passes drove keyboard opens on lists); a real Google sign-in; a real phone. `npm audit`: see §12.

## 7. Where secrets live and how to rotate them

Real values live only in the git-ignored root `.env` (locally) or in the host's secret store (later). `.env.example` lists the keys without values. `npm run secret-scan` fails on credential-like text.

| Secret | Rotate by |
|---|---|
| `SESSION_SECRET` | Set a new value (≥ 32 chars) in all four apps and restart them. Everyone is signed out |
| `INTERNAL_SERVICE_TOKEN`, or `INTERNAL_SERVICE_TOKENS` (one key per workspace, D-077; recommended for go-live) | Set a new value, the same in all four apps, and restart them together |
| `DATABASE_URL` password | Change the password in PostgreSQL, update `DATABASE_URL`, restart |
| `GOOGLE_CLIENT_SECRET` | Google Cloud console → the OAuth client → reset the secret, paste the new one, restart the platform |
| `SEED_USER_PASSWORD` | Local development only; change it and re-run `db:seed` |
| `LOCAL_DEMO_PASSWORD` | Local development only; change it and re-run `npm run db:seed-demo-accounts` |

If a secret is ever committed, rotate it. Deleting the commit is not enough.

## 8. Third-party services

| Service | Purpose | Status | Account owner |
|---|---|---|---|
| Google OAuth | "Sign in with Google" | Built (D-030); needs the owner's client ID and secret | Owner (to create) |
| Email sending | Reminders | Mock adapter (`packages/notifications`): records, sends nothing | — |
| Publishing / metrics tool (e.g. Metricool, YouTube) | Marketing posting and numbers | Mock adapter: "SANDBOX: nothing was posted" | — |
| CRM | Lead sync | Mock adapter (`apps/business-ops-os/src/server/adapters/crm.ts`) | — |
| Document storage | Admission documents | Not connected: identity documents keep a masked reference only, no files | — |
| Messaging (SMS / WhatsApp / email) | Event invitations, sending EOD reports | Event messages simulated and audited (never marked sent without a provider reference); EOD reports: "Copy summary" and PDF, "External delivery not configured" | Owner (to choose) |
| Attendance device / provider | Staff attendance | Mock adapter; manual entry and CSV import work | — |
| Hosting, managed PostgreSQL, domain | Going live | Not chosen (owner decision) | Owner |

None of these costs money today.

## 9. Where to change content

Business content is data, so it is entered on the screens, not in code. For example, to change the demo fee: sign in as an operations manager, open **Business Ops → Settings**, find the admissions group and edit the value (every change is recorded). Programmes, departments, onboarding templates and fee structures are edited the same way under each module's settings. Interface wording is in each app's `src/app/**/page.tsx` and needs a developer.

## 10. Known limitations and the next three improvements

Limitations:
- No password reset or change screen.
- Google-only accounts cannot confirm admissions (D-041).
- The login throttle is per process.
- There is no outbox scheduler; the intake is run by hand.
- Module services often `select()` whole module rows. None are secret, but §6.6 prefers named columns, so that is a follow-up.
- Error and 404 pages use an `h2` with no `h1`.
- Since 31 Oct signed-in screens are browser-checked against the CSP (§6). The first pass found one block, on the student report's print stylesheet; fixed in source.
- Teacher unavailability in Academic is a planning note, not HR leave.
- Academic reports print from the browser and download as CSV; Academic makes no PDFs.
- Not built: topics below chapter level, homework submissions, teaching-log reminders, bulk task changes, file uploads for evidence (links only).
- Students who left or finished before 21 Oct 2026 have no batch history, so their attendance shows "Not recorded — no batch history before 21 Oct 2026".
- A demo class linked in Academic that Business Ops has not read yet can still be marked by a counsellor until Ops next reads Academic successfully. A teacher can start a demo review only once the student is on an Academic class roster. The job that moves demos forward from Academic marks (`demo-academic-marks`) runs only when someone starts it; there is no scheduler.
- Tasks (D-069): a manager who did not create a task cannot remove its review step (the operations manager can); if work comes back to the person who created it, that person gets back the creator's rights.
- The Task Tracker import is tested with made-up backups only; your real browser exports are still needed (`docs/task-tracker-import-guide.md`).
- The prototype (`C:\OPENBOT\Elevate`) does not show the 21 Oct work or the 22 Oct workspaces, and keeps the old dark look (not redesigned, D-074).
- Workspaces (22 Oct): a panel that shows another workspace's figures says "source unavailable" while that workspace is not running; Google sign-in needs the admin app (:3003) running; on this computer the sign-in cookie is shared by every local port, so other local programs could see its name (use a separate browser profile if you run unknown local apps). Not built: staff attendance ("My Attendance"), teaching resources, Events and Webinars in Marketing, results by campaign.

- Milestone 23–24 Oct: see "Limitations" in the milestone section above (no scheduler for reminders, request links to campaigns/tests refused, no paper visible between upload and release, list caps of the newest 500 calls and 200 pending imports).
- Debug pass 31 Oct: see "What this does not mean" and "Known limits" at the top, and `IMPLEMENTATION_STATUS.md` "Debug pass" for what stayed partial.
- The prototype `Elevate.html` does not show the 26 Oct or 30–31 Oct work (register `OPS-P-DEBUG-31OCT`).

Next three improvements, in priority order:
1. **Go-live basics.** The owner chooses hosting. Then build HTTPS, CI deploy, error monitoring, an uptime check and a tested backup and restore (§15.1).
2. **Account safety.** Password reset, a shared login rate limit (by IP and account), and account-admin screens.
3. **Release QA.** axe, keyboard and Lighthouse passes on every template, signed-in, with a real `@elevateeducation.in` test user. Then narrow whole-row `select()` calls to the fields each screen needs.

## 11. Licences

- **Logo:** `apps/*/public/brand/elevate-logo.png` and `favicon.ico` belong to the owner (Elevate Education).
- **Fonts:** screens use the computer's own font for text and Bricolage Grotesque for titles and figures (SIL Open Font License 1.1; `packages/shared-ui/fonts/OFL-BricolageGrotesque.txt`, D-074). PDFs embed Noto Sans 2.015 Regular and Bold (SIL Open Font License 1.1; licence file `apps/business-ops-os/assets/fonts/OFL.txt`, D-042) and Noto Sans Devanagari 2.007 Regular and Bold (OFL; `OFL-NotoSansDevanagari.txt`, D-118).
- **PDF library:** `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 (MIT), owner-approved 21 Oct 2026.
- **No third-party images.**
- **npm dependencies:** all come from the public npm registry, and the project itself is `UNLICENSED` (private). A census of installed packages on 20 Oct 2026 found:
  - MIT 204, Apache-2.0 24, ISC 19, BSD-2-Clause 6, BSD-3-Clause 3, MPL-2.0 2, 0BSD 1, BlueOak-1.0.0 1, CC-BY-4.0 1 (data).
  - One package is "Apache-2.0 AND LGPL-3.0-or-later": `@img/sharp-win32-x64`, the libvips binary used by Next's image optimiser and loaded dynamically.
  - The two MPL-2.0 packages are `lightningcss`, a build-time CSS tool.
  - None are copyleft-incompatible with private use.
- To re-list licences without new dependencies, read the `license` field of every `node_modules/**/package.json`. `npm ls --all` lists the tree.

## 12. Known `npm audit` advisories (4, development tools only)

`npm audit` on 30 Oct 2026 reports 4 moderate advisories, 0 high, 0 critical; with `--omit=dev --audit-level=high` it reports 0. None are in code that runs in production:
- **Moderate:** `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`, where the esbuild dev server lets a website read its responses. `drizzle-kit` only generates migrations and never starts that server.

They are not fixed because the fix needs a major change of drizzle-kit. Versions are pinned (D-018), and neither tool ships to production. Re-check when Next or drizzle-kit release updates.

## 13. Maintenance

- **Automatic:** nothing yet; there is no deploy or monitoring.
- **Recommended once live:**
  - Dependabot or Renovate for dependency updates, with the owner merging them.
  - Daily database backups with a monthly restore test.
  - An uptime alert to the owner's email.
- **Owner monthly glance:** the site loads, and the reminder emails arrive (once email is connected).

To hand this to a developer, point them to `README.md`, `AGENTS.md`, `docs/DECISIONS.md` and this file.
