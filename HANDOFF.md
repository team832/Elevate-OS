# Elevate OS — handoff

_Last updated 23 Oct 2026 (HR area). Branch `feature/business-ops-hr-admissions`. Nothing is deployed yet._

## For the owner (plain language)

**What it is.** Elevate OS is the internal system your staff sign in to. Since 22 Oct 2026 it has three **workspaces**, one per kind of work, each at its own address: Business Operations (enquiries, demos, admissions, students, fees, staff tasks), Academic (teachers and coordinators) and Marketing. A fourth address holds Users & roles. Only `@elevateeducation.in` accounts can use it (D-030).

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
  every workspace, AI drafting buttons (OpenAI writes a first draft; a person always checks
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
3. In the Claude Code chat type `! npm run db:seed-demo-accounts` (or run it in a terminal in the `elevate-os` folder). It prints "ready" and the three emails with the address each one opens; it never prints the password. Running it again is safe.
4. Sign in on http://localhost:3000 as `business@elevateeducation.in`, on http://localhost:3001 as `teacher@elevateeducation.in`, or on http://localhost:3002 as `marketing@elevateeducation.in`, with that password.
5. Before real staff use the system, type `! npm run db:clear-samples`: it removes the sample records and switches the three demo sign-ins off. Staff never share these accounts.

**5. Google sign-in — only if you ever set it up.** The sign-in return address moved with the admin app to port 3003. If you created a Google sign-in client (`docs/GOOGLE_SIGN_IN_SETUP.md`):
1. Open https://console.cloud.google.com and sign in with the Google account that owns the project.
2. Choose the Elevate project at the top, then **APIs & Services** → **Credentials**.
3. Click the OAuth client you made for Elevate OS.
4. Under **Authorised redirect URIs**, change `http://localhost:3000/api/v1/auth/google/callback` to `http://localhost:3003/api/v1/auth/google/callback`. Click **Save**.
5. Google sign-in now needs the admin app running (`npm run dev:platform`). If you never set up Google sign-in, skip this step.

**6. Database update for the teacher report — done on your computer on 23 Oct 2026** (database change `0014_teacher_reports`, which only adds the table that keeps generated teacher reports; `db:check` passed 19/19). On another computer: with `npm run db:start` running, type `! npm run db:migrate` in the Claude Code chat (or run `npm run db:migrate` in a terminal in the `elevate-os` folder).

**7. Database update for the HR area (this computer only) — not done yet.** The HR screens need database change `0015`. It also rewrites some existing task and report rows (a task marked "blocked" keeps that as a flag instead of a status; every old end-of-day report becomes a day report), so take a backup first. Only you can do this, because it changes the database on your computer.
1. Make sure the database is running (`npm run db:start` in a terminal in the `elevate-os` folder, left open).
2. In the Claude Code chat type `! npm run db:backup`. If it says `pg_dump` is not installed (likely on this computer), stop and ask the developer to take a backup for you before going on.
3. Type `! npm run db:migrate`. It should say the migrations were applied.
4. Type `! npm run db:check`. It should end with all checks passed.
5. Type `! npm run db:seed`. This adds the Sikar centre, the fictional HR sample user `hr-manager@example.test` and the teaching assignments you gave today. Running it again is safe.
6. Optional: type `! npm run db:seed-demo-accounts` to refresh the demo sign-ins; it also sets up `satish@elevateeducation.in` as a teacher sign-in for testing on this computer only (we assumed the `.in` ending; tell me if his address is different).
If any step shows an error, stop and send the developer the last lines; nothing is half-applied (the update runs as one step).

**8. AI drafting: add credit to your OpenAI account.** The AI buttons use your OpenAI account, which needs credit; only you can pay for it.
1. Open https://platform.openai.com and sign in with the account the key came from.
2. Click the gear icon (**Settings**) at the top right, then **Billing** in the left menu.
3. Click **Add to credit balance**, choose an amount, and confirm with your card.
4. If the key is not yet in the `.env` file in the `elevate-os` folder, open `.env` in Notepad and add two lines: `OPENAI_API_KEY=` followed by your key, and `OPENAI_MODEL=gpt-5.4-mini`. Save. Never paste the key in chat or anywhere else; the code checks refuse any code file that contains a key like it.
5. Before staff use these buttons, please answer the AI data-sharing question in "Decisions waiting for you" (names, phone numbers and codes are hidden before anything is sent, but a name typed in lower case can still slip through).

### Decisions waiting for you

Until you answer, the system uses the safe choice shown and marks it "Proposed".

| Question | Safe choice used today |
|---|---|
| **New 23 Oct (HR).** Are the new HR permissions right? The HR manager runs staff records, attendance, task review, work reports and teacher feedback; every staff member sees their own attendance; the director, coordinators and the marketing manager review their own team's tasks (D-080) | As built, all marked Proposed |
| **New 23 Oct (HR).** Which staff does HR look after? Today: the Academics and Marketing & Growth departments, plus anyone with no department yet (so HR can place them) | As stated (Proposed) |
| **New 23 Oct (HR).** May an operations manager end the employment of another operations manager? (Directors and platform administrators can never be changed from HR) | Yes |
| **New 23 Oct (HR).** HR staff who also teach: they cannot read raw student feedback about teachers and must pass that work to a colleague (D-088) | As stated (Proposed) |
| **New 23 Oct (HR).** When the person who creates a task gives it to themselves, should they be allowed to switch its review off? | No — the owner of a task can never switch its review off |
| **New 23 Oct (HR).** Attendance and report settings: 10 minutes' grace before "late"; half day 4 hours, full day 8 hours; the week starts on Monday; no deadline for weekly or monthly reports; feedback shown only for groups of at least 5 students; ratings 1 to 5; six feedback categories (explanation clarity, pace, doubt resolution, preparedness, classroom engagement, helpfulness of materials); an approved task can be reopened by its reviewer or HR; AI drafts limited to 50 per person per day | As stated (all Proposed) |
| **New 23 Oct (AI).** May student feedback, work reports and task text be sent to OpenAI to draft summaries (Digital Personal Data Protection Act)? Names, phone numbers, emails and codes are hidden first, but a name the system does not know, typed in lower case, can still get through (D-092) | AI buttons on, marked Proposed — please confirm before staff use them |
| **New 23 Oct (Marketing).** Marketing employees cannot assign people to content (only the marketing manager can), and they still see the weekly figures of every social account | As stated (Proposed) |
| **New 23 Oct (staff).** Nikunj Bindal: is CA Foundation Accounting (course `CAF-ACC-SEP27`) right as "waiting for a batch"? This was my pick; on 21 Oct no assignment was made (D-082) | Recorded as waiting, opens nothing |
| **New 23 Oct (staff).** The sign-in `soma@…`: which Soma is it — "Soma" (CLAT Current Affairs) or "Soma Tiwari" (Economics)? The other session made a ruling; please confirm it | As ruled in the other session |
| **New 23 Oct (files).** Where should uploaded files be kept once the system is on the internet? Until you choose, uploads work only on this computer (D-085) | Uploads refused online |
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
| May staff who sign in with Google confirm admissions by signing in with Google again? Today every real staff account is Google-only, so **nobody real can confirm an admission yet** (D-041) | Only an account password is accepted |
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
| Show rank and percentile on Academic progress? | Hidden |
| Academic trends: which results may be compared? | Same kind of test, same subject and same maximum marks (Proposed) |
| Do tasks imported from the old Task Tracker count when measuring how often end-of-day reports were sent? | No; shown as "Imported — not sent" |
| Who may close a task that has no reviewer? | The task owner (Proposed) |
| Should end-of-day reports be sent outside the system (email or WhatsApp)? | Not connected; "Copy summary" and PDF only |
| A staff account cannot be deleted while it is the only person on a Marketing content assignment (writer, reviewer and so on). Keep refusing, or should the system first ask you to hand that work to someone else? | Refused; reassign the work first, then delete |
| The audit history (who changed what) is never changed by the system, but the database itself does not forbid it. Add a database rule later so even a developer mistake cannot edit or delete it? | No database rule yet (the code only adds rows) |

Already decided by you on 21 Oct 2026 and built: registration ₹5,000 (D-044), demo ₹1,000 (D-045), the declaration and terms from your paper form, version 2 (D-046), Nikunj Bindal teaches Accounts (D-047), address and GSTIN as on the form (D-048), public email `team@elevateeducation.in` on documents (D-049), daily tasks and EOD reports (D-052), a new layout (D-054, D-059; the dark look itself was replaced on 22 Oct, D-074), teacher reviews written in Academic (D-058), demo attendance marked by the teacher in Academic (D-060), sample staff named "Sample …" with `@example.test` sign-ins (D-061). On 23 Oct 2026: HR back inside Business Operations, including staff attendance (D-080, D-086; answers the old staff-attendance question OD-026), teachers see approved feedback summaries in Academic (D-088), the charcoal sidebar (D-081), your staff answers on Soma, Satish and Nikunj (D-082), directors make student reports (D-079), AI drafting with the model you chose (D-092).

**What is not connected yet.** Email and text messages, event invitations, the social-media publishing tool, a biometric device and a CRM are "pretend" connections or not connected at all; file uploads work only on this computer until you choose where files are kept online (D-085): they record what would happen and never claim it happened. Hindi (Devanagari) text does not print in PDFs yet; it shows as "?" with a note.

**Security.** Every page checks who is signed in and what they may see. Most students are minors, so phone numbers, addresses and documents are shown only to staff with the private-data permission, and every contact search is logged. Passwords and keys stay in a private settings file (`.env`) that is never uploaded.

---

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

Production-like run: `npm run build`, then `npm run start -w @elevate/<module>-os` for each module, then `npm run start -w @elevate/platform`.

The seed users are fictional `@example.test` accounts. They sign in on your own computer (password: `SEED_USER_PASSWORD` in the root `.env`); a production build refuses them (D-030), so a live site needs real `@elevateeducation.in` accounts.

Checks: `npm run validate` runs typecheck, lint, tests and the secret scan. `npm run build` builds all four apps.

Never run `db:reset` or `db:seed` against a non-local database. `pg_dump` is not installed (D-024), so install the PostgreSQL client tools before relying on `npm run db:backup`.

## 4. How deployment will work

**Nothing is deployed.** The hosting provider, database provider and domain are **owner decisions**. The proposed shape is in `infrastructure/deployment/README.md`:
- Only the platform is public, over HTTPS.
- The three module apps run on a private network.
- PostgreSQL is a managed service with backups.
- CI runs `npm ci`, then `validate`, then `build`, then migrates after a verified backup.
- Request logs on the host and any proxy keep the path **without the query string** (search addresses can hold phone numbers, D-056).
- PDF fonts in `apps/business-ops-os/assets/fonts` must ship with the build (a `standalone` build needs `outputFileTracingIncludes`).

Each workspace gets its own host name (D-072); keep them under one site and the session cookie host-only. Two settings are compiled in at **build** time, so set them before `npm run build`:
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

### Final verification — filled at release
_To be filled by the orchestrator: `npm run validate`, `npm run build`, smoke test, axe, Lighthouse, keyboard pass, `npm audit`._

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
- Signed-in screens were not browser-checked against the CSP.
- No HR module: staff attendance and leave show "HR attendance unavailable". Teacher unavailability in Academic is a planning note, not HR leave.
- Academic reports print from the browser and download as CSV; Academic makes no PDFs.
- Not built: topics below chapter level, homework submissions, teaching-log reminders, bulk task changes, file uploads for evidence (links only).
- Students who left or finished before 21 Oct 2026 have no batch history, so their attendance shows "Not recorded — no batch history before 21 Oct 2026".
- A demo class linked in Academic that Business Ops has not read yet can still be marked by a counsellor until Ops next reads Academic successfully. A teacher can start a demo review only once the student is on an Academic class roster. The job that moves demos forward from Academic marks (`demo-academic-marks`) runs only when someone starts it; there is no scheduler.
- Tasks (D-069): a manager who did not create a task cannot remove its review step (the operations manager can); if work comes back to the person who created it, that person gets back the creator's rights.
- The Task Tracker import is tested with made-up backups only; your real browser exports are still needed (`docs/task-tracker-import-guide.md`).
- The prototype (`C:\OPENBOT\Elevate`) does not show the 21 Oct work or the 22 Oct workspaces, and keeps the old dark look (not redesigned, D-074).
- Workspaces (22 Oct): a panel that shows another workspace's figures says "source unavailable" while that workspace is not running; Google sign-in needs the admin app (:3003) running; on this computer the sign-in cookie is shared by every local port, so other local programs could see its name (use a separate browser profile if you run unknown local apps). Not built: staff attendance ("My Attendance"), teaching resources, Events and Webinars in Marketing, results by campaign.

Next three improvements, in priority order:
1. **Go-live basics.** The owner chooses hosting. Then build HTTPS, CI deploy, error monitoring, an uptime check and a tested backup and restore (§15.1).
2. **Account safety.** Password reset, a shared login rate limit (by IP and account), and account-admin screens.
3. **Release QA.** axe, keyboard and Lighthouse passes on every template, signed-in, with a real `@elevateeducation.in` test user. Then narrow whole-row `select()` calls to the fields each screen needs.

## 11. Licences

- **Logo:** `apps/*/public/brand/elevate-logo.png` and `favicon.ico` belong to the owner (Elevate Education).
- **Fonts:** screens use the computer's own font for text and Bricolage Grotesque for titles and figures (SIL Open Font License 1.1; `packages/shared-ui/fonts/OFL-BricolageGrotesque.txt`, D-074). PDFs embed Noto Sans 2.015 Regular and Bold (SIL Open Font License 1.1; licence file `apps/business-ops-os/assets/fonts/OFL.txt`, D-042).
- **PDF library:** `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 (MIT), owner-approved 21 Oct 2026.
- **No third-party images.**
- **npm dependencies:** all come from the public npm registry, and the project itself is `UNLICENSED` (private). A census of installed packages on 20 Oct 2026 found:
  - MIT 204, Apache-2.0 24, ISC 19, BSD-2-Clause 6, BSD-3-Clause 3, MPL-2.0 2, 0BSD 1, BlueOak-1.0.0 1, CC-BY-4.0 1 (data).
  - One package is "Apache-2.0 AND LGPL-3.0-or-later": `@img/sharp-win32-x64`, the libvips binary used by Next's image optimiser and loaded dynamically.
  - The two MPL-2.0 packages are `lightningcss`, a build-time CSS tool.
  - None are copyleft-incompatible with private use.
- To re-list licences without new dependencies, read the `license` field of every `node_modules/**/package.json`. `npm ls --all` lists the tree.

## 12. Known `npm audit` advisories (8, development tools only)

`npm audit` on 20 Oct 2026 reports 4 high and 4 moderate advisories, 0 critical. None are in code that runs in production:
- **High:** `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`, a stack-exhaustion denial of service from deeply nested glob patterns. It only runs inside ESLint, on our own patterns.
- **Moderate:** `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`, where the esbuild dev server lets a website read its responses. `drizzle-kit` only generates migrations and never starts that server.

They are not fixed because the fixes need a major downgrade or upgrade of the lint plugin or drizzle-kit. Versions are pinned (D-018), and neither tool ships to production. Re-check when Next or drizzle-kit release updates.

## 13. Maintenance

- **Automatic:** nothing yet; there is no deploy or monitoring.
- **Recommended once live:**
  - Dependabot or Renovate for dependency updates, with the owner merging them.
  - Daily database backups with a monthly restore test.
  - An uptime alert to the owner's email.
- **Owner monthly glance:** the site loads, and the reminder emails arrive (once email is connected).

To hand this to a developer, point them to `README.md`, `AGENTS.md`, `docs/DECISIONS.md` and this file.
