# Product requirements

**Prepared:** 2026-10-17 by the Audit agent (Build Plan wave 1b). **Evidence base:** `docs/EXISTING_PROJECT_AUDIT.md` (abbreviated **AUDIT**). **Architecture constraints:** `docs/DECISIONS.md` (D-001 to D-016).

Path shorthand, the same as in AUDIT:
- `A/` = `C:\OPENBOT\OLD\01-original-elevate-os\` (the content OS)
- `B/` = `Elevate-Education/` inside `A/Elevate-Education-Agent-Handover-2026-10-15.zip`

## 0. How to read this document

| Field | Meaning |
|---|---|
| ID | `PLT-` shared platform, `MKT-` Marketing OS, `ACD-` Academic OS, `OPS-` Business Operations OS. IDs are stable and never reused. Legacy codes such as `MKT-01` (a marketing SOP) or `OPS-001` (a legacy task) are a **different namespace** (AUDIT DI-21). |
| Source | The legacy file that evidences the requirement, or "standard practice" / "prompt requirement" when no legacy file covers it |
| Priority | **P0**: first vertical slice. **P1**: next. **P2**: later. |
| Status | **Approved** only where a legacy file records the owner's approval, lock or confirmation of that rule. Everything else is **Proposed**. Approval of a *rule* does not mean the *software feature* is approved; it means the system must enforce that rule. Statuses then move along D-013 (`Implemented`, `Tested`, `Deployed`) in the module's `requirements/REQUIREMENTS.md`. |
| OD-nnn | An owner decision that is still open (AUDIT §9). Where a requirement depends on one, the system must ship a **configurable default marked "proposed"**, never a silent choice. |

### 0.1 Cross-cutting principles (every module)

1. **Keep states apart.** The states are proposed, approved or locked, implemented in the system, and delivered or verified. A locked plan is not evidence that work happened. Sources: `B/Claude.md` §2.2; D-013.
2. **Missing is not zero.** A metric or measure with no data is stored as `null` with a state, and is shown as "no data" or "source unavailable", never as 0. Sources: `A/tools/import-metrics.mjs` (`num()`); Marketing-Easy `Start Here!C18`; D-011.
3. **Completion needs evidence.** A finished task, session, test step or publication requires an owner, a timestamp and evidence (a note or link). Sources: `B/elevate-education-operations/PROJECT_CHARTER.md` principle 3; Online-Easy `Actions!J`.
4. **Preserve baselines.** Original plans and original deadlines are never overwritten. Revisions are new versions, kept with a change log. Sources: `B/Claude.md` §2.3; Marketing-Easy `Home!A30`.
5. **Roles, not names.** Responsibilities attach to roles. People are assigned to roles separately, and one person may hold several roles. Sources: `B/Claude.md` §2.4; Online-Easy `Roles!A18`.
6. **Fictional seeds.** Development data must use fictional people. Non-personal legacy planning data keeps its legacy status label (D-016).
7. **No claimed integrations.** External systems (Metricool, CRM, Vacademy, Tally, WhatsApp) are adapters with a mock default and an honest connection status. Sources: D-014; `B/Claude.md` §2.11.
8. **IST business time.** Business dates and weeks follow Asia/Kolkata, and weeks run Monday to Sunday. Timestamps are stored in UTC. Sources: Marketing-Easy `Start Here!B12`; standard practice.

---

## 1. Platform and shared services (PLT)

### 1.1 Purpose
One login, one permission model, one audit trail, one approval service and one integration backbone for the three modules (D-004, D-005, D-008, D-010, D-011).

### 1.2 Users and roles
These are the D-008 starting roles. Mapping real staff to roles is **OD-009**. The legacy role labels map as follows:

| D-008 role | Legacy role labels covered (B/ Online `Roles`, Marketing `Content!I` list) |
|---|---|
| `platform_admin` | Technical Lead |
| `director` | Main authority, Institute Authority, Co-Founder (content approver per OD-002) |
| `marketing_manager` | Marketing Lead |
| `marketing_contributor` | Content Coordinator, Editor/Designer, Publishing Executive, Paid Marketing Owner, Outreach Coordinator, Webinar Coordinator |
| `academic_coordinator` | Academic Coordinator, Academic Head, Academic Reviewer (as academic checker) |
| `teacher` | Faculty |
| `admissions_counsellor` | Admissions Coordinator, Academic Counsellor, Reception (enquiry capture) |
| `operations_manager` | Operations Lead, Support Coordinator |
| `auditor` | Read-only review |

The legacy "Accounts Officer" role has no D-008 equivalent. Whether one is needed depends on the fee-data scope (OD-013).

### 1.3 In scope and out of scope
- **In scope:** identity and sessions, roles and permissions, audit, approvals, notifications (in-app), the integration outbox and summaries, the programme catalogue and staff directory as core tables, the legacy import framework, consent records, adapter status.
- **Out of scope (D-015):** payroll, biometric device integration, HRIS and legal employment records, parent or student portals, the public website, AI content generation, and staff leave (pending OD-026).

### 1.4 Functional requirements

| ID | Requirement | Source | Priority | Status |
|---|---|---|---|---|
| PLT-001 | Users sign in once and are recognised in all four zones through a shared HTTP-only session. Users can sign out. Sessions expire. | D-008; D-004 | P0 | Proposed |
| PLT-002 | Every protected route and server action checks a permission string `<module>:<resource>:<action>` on the server. Hiding UI is never the control. | D-008 | P0 | Proposed |
| PLT-003 | An admin assigns one or more roles to a user. A role holder and a backup can be recorded per responsibility (see OPS-015). Roles do not imply headcount. | `B/Claude.md` §2.4; Online-Easy `Roles!A2`, `A18` | P0 | Approved (rule: "use role names, not people"; "roles do not imply separate hires") |
| PLT-004 | Separation of duties: the creator or last editor of an item cannot be its sole approver. This is configurable per approval type and enforced on the server. | Marketing-Easy `SOP Register!G8` ("No sole self-approval") | P0 | Proposed |
| PLT-005 | Every business-state change writes an append-only audit event: actor, UTC time, entity, action, before and after values, reason. Auditors can read events and nobody can edit them. | `PROJECT_CHARTER.md` principle 3; `Elevate-Operations.xlsx` `Guide!B6` ("fixed verified-at fields"); standard practice | P0 | Proposed |
| PLT-006 | A shared approval service records requests and decisions (`approved`, `rejected`, `changes_requested`). Each binds an entity ID, an **entity version or content hash**, the approver, the time, a note and an evidence link. History is immutable. An approval is void if the subject changes after approval. | Marketing-Easy `SOP Register!E8` ("approve a specific version"); `Content!U:V` | P0 | Proposed |
| PLT-007 | A shared vocabulary for rules, policies and plans: `proposed`, `approved`, `locked`, `pending_verification`, `superseded`. `approved` and `locked` require an approver, a date and a source. The UI badges each state visibly. | `B/Claude.md` §2.2; Online-Easy `Rules!B` decision states | P0 | Approved (rule: keep confirmed, proposed, implemented and delivered separate) |
| PLT-008 | Cross-module commands use the transactional outbox. Consumers are idempotent (unique on event and consumer), retry, park failed deliveries for review, and expose delivery status. | D-011 | P0 | Proposed |
| PLT-009 | Versioned read-only summary endpoints (`/<zone>/api/internal/v1/summary`) with shared zod contracts. If a source fails, consumers render "source unavailable", never zero. | D-011; Marketing-Easy `Start Here!C18` | P1 | Proposed |
| PLT-010 | In-app notifications for: task assigned, approval requested or decided, item overdue, escalation raised, handoff pending. External channels (email, WhatsApp, SMS) go only through adapters, mock by default. **No message to a student or parent is sent unless the owner enables that channel.** | `B/Claude.md` §2.11; D-014 | P1 | Proposed |
| PLT-011 | Legacy import framework. It reads legacy sources read-only and records the source path, SHA-256 (matched against `B/MANIFEST.json` where applicable) and the sheet or row of each imported record. It supports dry runs with a diff report, can be re-run idempotently, keeps legacy status labels, namespaces legacy codes (AUDIT DI-21), ignores cached volatile values (AUDIT DI-24), and **never converts planned items into completed ones**. | D-016; AUDIT §11 | P0 | Proposed |
| PLT-012 | Seeds and fixtures contain only fictional people. A test fails if any name on a maintained "real names" deny-list appears in seed files. | D-016; AUDIT §10.2 | P0 | Proposed |
| PLT-013 | Business dates use Asia/Kolkata. Weeks start Monday. Storage is UTC. Reports state their window and data "as-of" time. | Marketing-Easy `Start Here!B12`, `Dashboard!E5`; standard practice | P0 | Proposed |
| PLT-014 | Personal-data minimisation. Students hold only operational fields. Guardian contact is required for under-18s. Phone numbers and emails are visible only to roles with a need. Exports are permissioned and audited. Identity documents, passwords and payment credentials are not stored (unless OD-014 decides otherwise). | Online-Easy `Rules!C15`, `C23`; Marketing-Easy `Start Here!C34`; `B/Claude.md` §2.12 | P0 | Approved (rule: "Registered guardian for under-18 students" is Locked; data-handling controls are recorded as operating controls) |
| PLT-015 | A core programme catalogue (stewarded by Academic OS) with stable codes used by all modules. Proposed codes: `CLAT`, `IPMAT` (combined IIM entrance), `CUET`, `COM11`, `COM12`, `CAF` (CA Foundation). Marketing course prefixes (`CLAT`, `IPMAT`, `CUET`, `COM`, `GEN`) map onto it. The 2026–27 catalogue contents are OD-021. | D-010; `A/CLAUDE.md` "Idea IDs"; `A/brand/BRAND.md` §1 | P0 | Proposed |
| PLT-016 | A core staff directory and departments (stewarded by Business Ops). A staff member may exist without a login. A user may link to one staff member. | D-010 | P0 | Proposed |
| PLT-017 | An adapter registry shows each integration's status (`not_configured`, `sandbox`, `connected`, `error`) and its last verification time. `connected` is set only after a successful real verification call. | D-014; `B/Claude.md` §2.5 | P1 | Proposed |
| PLT-018 | Shared consent records. Each holds: subject (student or guardian), scope (on camera, name shown, testimonial, results), granted by, date, evidence reference, withdrawal or expiry. Marketing assets and Ops admissions reference them. Withdrawal flags dependent assets. | `A/library/_broll/README.md` ("student's and a parent's OK"); CLAT calendar v3 rule 1; OD-008 | P1 | Proposed |
| PLT-019 | Approval delegation: an approver can delegate approval types to another role holder for a dated period. Delegation is audited and shown on each decision. | OD-002; standard practice | P2 | Proposed |

---

## 2. Marketing OS (MKT)

### 2.1 Purpose
Run Elevate's social content from idea to published post and measured result, under the brand and claims rules, with explicit approval and honest numbers. This replaces the CSV tracker, the Markdown routines and the marketing workbook (AUDIT §8).

### 2.2 Users and roles
- `marketing_manager` plans, assigns and reviews.
- `marketing_contributor` writes, edits and publishes once approved.
- The brand approver (default `director` = the Co-Founder, per OD-002) approves.
- `academic_coordinator` and `teacher` check academic facts.
- `auditor` reads.
- Other modules' users see summaries only.

### 2.3 In scope and out of scope
- **In scope:** the social account registry; ideas and the inbox; pillars and series; briefs and a fact register; content items (placements) and versions; the content state machine and approval; claims, collab, stagger and LinkedIn checks; calendars; organic and paid campaigns; repurposing; production assets, consent and rights gating; assignment; publishing records; publishing adapters (mock by default); duplicate-publication prevention; analytics CSV import; metric semantics; weekly reporting; competitor tracking (P2); handing enquiries to Business Ops; legacy import.
- **Out of scope:** AI generation of copy, images or video (D-015); video editing and rendering (the Remotion studio is absent and stays external); storing binary media (assets are referenced by URL); posting to platforms without explicit approval; lead management beyond the handoff (that is OPS).

### 2.4 Business rules the system must enforce

**BR-MKT-1 Accounts and codes.** Approved 6 Oct 2026 in `A/HANDOFF.md` §5 and `A/CLAUDE.md`, subject to OD-001.

| Code | Account | Platform | Legacy status | Metricool brand |
|---|---|---|---|---|
| `LI` | Nikunj Bindal (personal) | LinkedIn | live | Nikunj Bindal |
| `LIP` | Elevate Education (company page) | LinkedIn | live | Elevate Education |
| `IGC` | Elevate CLAT (`@elevate.clat`, confirmed) | Instagram | live | Elevate CLAT |
| `YTC` | Elevate CLAT | YouTube | live, handle TBD | Elevate CLAT |
| `IGU` | Elevate CUET + Class 12 (Commerce & CUET) | Instagram | live, handle TBD | Elevate CUET + 12th |
| `YTU` | Elevate CUET + Class 12 | YouTube | live, handle TBD | Elevate CUET + 12th |
| `IGI` | Elevate IPMAT | Instagram | starting, handle TBD | Elevate IPMAT |
| `YTI` | Elevate IPMAT | YouTube | starting, handle TBD | Elevate IPMAT |
| `IGS` | Elevate Sikar (local; the only account where Sikar or offline is the point) | Instagram | live, handle TBD | Elevate Sikar |
| `IGN` | Nikunj (personal) | Instagram | later | — |

YouTube placements append `S` (Short) or `L` (long) when one idea gets both, for example `-YTCS` and `-YTCL`. There are 9 active accounts and 1 later account, with no general "Elevate main" page.

**BR-MKT-2 IDs.**
- An idea ID is `<PREFIX>-<NNN>` with prefix `CLAT`, `IPMAT`, `CUET`, `COM` or `GEN`.
- A placement ID is `<ideaID>-<CODE>`.
- IDs are generated under a unique constraint and are never reused or renumbered (D-009; fixes AUDIT DI-01).
- Status: Proposed (agent convention in use).

**BR-MKT-3 Restricted claims.** Seeded into the claims check (MKT-012).

| # | Rule | Source | Status |
|---|---|---|---|
| 1 | Nothing is scheduled or published without the brand approver's explicit yes | `A/CLAUDE.md` Non-negotiables | Approved |
| 2 | No student results, toppers, AIR, ranks, selection numbers, percentages or testimonials (year one), and no "100% results". "Full marks" or "99%ile" are allowed only as a goal, never as a promise or past result. | `BRAND.md` §1, §6 | Approved (confirmed 5 Oct) |
| 3 | No "best faculty", AIR or topper claims | `BRAND.md` §1c | Approved |
| 4 | No Sikar, offline-centre or "online" labels in public content, except on `IGS` | `BRAND.md` §1b | Approved |
| 5 | Never mention NLSIU or the MBL; never mention RP Mody & Co | `BRAND.md` §1b, §3 | Approved |
| 6 | CA is not marketed as a course; no CA exam content; never imply CA Inter or Final | `BRAND.md` §1, §1b | Approved |
| 7 | No CA vs CLAT comparisons (IPMAT pending OD-005) | `ideas.csv` `CLAT-003` | Approved (CLAT) |
| 8 | Never "after 12th" as join framing (allowed in searchable titles) | `BRAND.md` §1b; CLAT strategy rules | Approved |
| 9 | Founder title is "Co-Founder" (never "Founder"). Deloitte is "about 1 year" (never "four years"). NMIMS is "Rank 3". The team is "15–20 teachers", never rounded up. | `BRAND.md` §2, §3 | Approved |
| 10 | Do not use the "44 lakh commerce students" or "78% unaware (CBSE 2024)" figures | `BRAND.md` §1c | Proposed (agent research rule) |
| 11 | No invented anecdotes. Founder stories are used only if confirmed by the founder. Comments and screenshots are never edited or invented. Private people's names and handles are blurred, and DMs are always blurred. | `BRAND.md` §3b; `A/CLAUDE.md` | Approved |
| 12 | LinkedIn: no student exam tips | `A/CLAUDE.md` Non-negotiables | Approved |
| 13 | LinkedIn (personal): no hashtags, no polls, no "comment X"; at most 1 post a day | `accounts/linkedin-nikunj/README.md`; `/weekly-plan` | Proposed |
| 14 | "Taught by Nikunj" only for CA Foundation, CLAT Legal Reasoning and Class 11–12 BST; otherwise "our faculty" | `BRAND.md` §3 | Approved |
| 15 | CLAT faculty on screen: name and subject only; no credentials until a course launches | `BRAND.md` §3 (7 Oct, final) | Approved |

**BR-MKT-4 Collab rule.** Approved 6 Oct.
- Pure exam content is posted solo, on that exam's accounts only.
- Comparisons and "every path" content are posted as a Collab across every exam account involved, on Instagram and YouTube.
- Founder stories go on `LI` (and `IGN` later), with a Collab when relevant.
- `IGS` content is solo; a Collab with `IGS` is only for Sikar events.

Sources: `A/HANDOFF.md` §5; account READMEs; CLAT calendar v3 rule 5.

**BR-MKT-5 Students on camera.** Only with the student's and a parent's OK. Otherwise faces are blurred, or only hands and papers are shown. Mock footage never implies results. Source: `A/library/_broll/README.md`. Proposed; consent evidence is OD-008.

### 2.5 Content state machine (MKT-009)

```
draft ──submit──▶ in_review ──approve──▶ approved ──schedule──▶ scheduled ──publish/confirm──▶ published ──archive──▶ archived
  ▲                 │   ▲                   │                     │
  │                 │   └──resubmit── changes_requested ◀─request changes
  └─────────────────┘ (withdraw)            │ edit after approval → in_review (approval voided)
draft / in_review / changes_requested / approved / scheduled ──cancel (reason)──▶ archived
scheduled ──unschedule──▶ approved
```

A `hold` flag (with reason and date) pauses work without changing state. Legacy statuses map as follows:

| Legacy status | Target state |
|---|---|
| Planned, Brief ready, In production, Editing/design, `planned`, `todo`, `needs recording`, `drafted` | `draft` |
| Awaiting approval, "ready to post (needs Nikunj yes)" | `in_review` |
| Changes required | `changes_requested` |
| Approved | `approved` |
| Scheduled, `scheduled` | `scheduled` |
| Published, `published` | `published` |
| On hold, `held`, `parked` | `draft` with hold |
| Cancelled | `archived` (reason: cancelled) |

Sources: Marketing-Easy `Content!K` list; `A/tracker/versions.csv`.

### 2.6 Functional requirements

| ID | Requirement | Source | Priority | Status |
|---|---|---|---|---|
| MKT-001 | A social account registry records: platform, display name, handle (nullable until confirmed), account code (BR-MKT-1), status (`live`, `starting`, `later`, `retired`), job and audience, owner role, publishing-tool brand, and a proposed cadence target. Seeded with the 10 rows in BR-MKT-1. | `A/HANDOFF.md` §5, §8; `A/accounts/*/README.md` | P0 | Approved (structure, 6 Oct 2026; conflict OD-001) |
| MKT-002 | A placement's code must be a registered account code. A YouTube placement may carry `S` or `L`. One idea has at most one placement per code (and suffix). | `A/CLAUDE.md` "Idea IDs" | P0 | Proposed |
| MKT-003 | A user can create an idea with: course prefix, title, pillar, source, master-asset type, notes and course link (PLT-015). The ID is generated as max + 1 under a lock or unique constraint, never reused, never renumbered, and stays unchanged when the idea is archived. | `A/CLAUDE.md`; `/idea` skill; AUDIT DI-01 | P0 | Proposed |
| MKT-004 | Ideas have their own lifecycle, separate from content items: `idea` → `in_development` (scripted, edited) → `ready` → `archived`, plus `held` and `rejected` (with reason). Legacy mapping: `idea`→`idea`; `scripted`, `edited`→`in_development`; `ready`→`ready`; `held`, `parked`, `on hold`→`held`; `rejected`→`rejected`; `published`, `scheduled`→`ready` (state derived from placements). | `A/tracker/ideas.csv` status values (AUDIT DI-06) | P0 | Proposed |
| MKT-005 | An idea inbox holds one-line raw entries (date, source, text, course guess). "File" converts an entry into an idea and links it ("filed as <ID>"). Entries are never deleted. | `A/ideas/inbox.md`; `/idea` skill | P1 | Proposed |
| MKT-006 | Pillars and series are configurable lists. The default pillars are BRAND.md's four, and legacy pillar values are kept as tags (OD-004). A series records its name, account, weekday, format and face (role or teacher), for example "Legal Reasoning in 60 seconds" on Tuesday. | `BRAND.md` §4; CLAT strategy "Recurring series" | P1 | Proposed |
| MKT-007 | Each content item has a brief: objective and CTA, audience, hook, script or draft link, and a fact list. Each fact either links to a fact-register entry or is marked `[CONFIRM]`. | `/write-post` step 3; Marketing-Easy `Content!F`, `Q`, `R` | P1 | Proposed |
| MKT-008 | A content item is one placement of an idea on one account (MKT-002). It records: format, **original publish time (immutable once set)**, revised publish time (a change needs a reschedule approver), current publish time (derived), owner, who works next, next deadline, collab accounts, campaign, and series. | `A/tracker/versions.csv`; Marketing-Easy `Content!A:AA`, `Home!A30` | P0 | Proposed |
| MKT-009 | The state machine in §2.5 is enforced on the server. An invalid transition returns `INVALID_STATE_TRANSITION`. Every transition is audited (PLT-005). | Prompt requirement; Marketing-Easy `Content!K` | P0 | Proposed |
| MKT-010 | Every saved change to copy, caption, media references or brief creates an immutable content version (number, hash, author, time). Editing an `approved` or `scheduled` item creates a new version, returns the item to `in_review` and voids the approval (unscheduling it if needed). | Marketing-Easy `SOP Register!E8` ("approve a specific version"); PLT-006 | P0 | Proposed |
| MKT-011 | **Explicit approval gate.** `approved` requires all of: an approval decision (PLT-006) for the current version by a role holding `marketing:content:approve`, which is not the sole author (PLT-004); checks and permissions set to `cleared` or `not_required`; and no unresolved blocking flags (MKT-012, MKT-014, MKT-022). Content that touches fees, offers or sensitive claims needs `director` approval. No item reaches `scheduled` or `published` without a valid approval. | `A/CLAUDE.md` ("Nothing is scheduled or published without Nikunj's explicit yes"); Marketing-Easy `Content!AC`, `SOP Register!G8`; OD-002 | P0 | Approved (rule) |
| MKT-012 | **Claims check.** On each version, configurable rules (phrases, patterns and context, per account and platform) built from BR-MKT-3 run against the copy and brief. Each hit is a flag with the rule's ID. A blocking flag must be resolved by editing, or overridden by the approver with a written reason (audited). Rules can be added or retired without a deploy. | `BRAND.md` §1b, §6; `/write-post` step 3 "never-list" | P0 | Proposed (rule contents Approved as listed in BR-MKT-3) |
| MKT-013 | A fact register: statement, value, source URL or document, date researched, verification state (`official`, `approximate`, `unverified`), expiry or "re-check before use" date. Brief facts link to entries. Using an `unverified` or expired fact raises a flag. | `BRAND.md` §1c; `A/courses/*/facts.md`; `/video-script` step 4 | P1 | Proposed |
| MKT-014 | **Collab rule check.** Each idea has a scope: `single_exam(<prefix>)`, `cross_exam(<prefixes>)`, `founder`, `local_sikar` or `general`. Placements that break BR-MKT-4 raise a blocking flag. For example: single-exam content on another exam's account; a cross-exam placement without collab accounts covering every exam involved; an `IGS` collab for a non-Sikar topic. | `A/HANDOFF.md` §5; CLAT calendar v3 rule 5 | P1 | Approved (rule, 6 Oct 2026) |
| MKT-015 | LinkedIn checks: at most one `LI` post per calendar day (blocking at scheduling); flags for exam-tip content, hashtags, polls and "comment KEYWORD" on `LI`. | `/weekly-plan` step 3; `accounts/linkedin-nikunj/README.md` | P1 | Proposed (the no-student-tips part is Approved, BR-MKT-3 #12) |
| MKT-016 | **Stagger rule.** Scheduling two placements of the same idea on the same IST day on different accounts raises a warning, unless they are a declared Collab or a YouTube Short mirroring the same Instagram reel. | `/repurpose` step 3; `A/reports/2026-10-11-next-week-plan.md` "Stagger check" | P1 | Proposed |
| MKT-017 | Calendars show, per account and across accounts, week and month views of placements by current publish time. Each account shows its cadence target against planned and published counts. Dated "calendar moments" (for example an exam registration deadline) carry a source and verification state. Reserved or empty slots are not counted as posts. | CLAT calendar; Marketing-Easy `Start Here!C19`; OD-007 | P1 | Proposed |
| MKT-018 | Campaigns. An **organic campaign** groups ideas and placements with a goal and dates. A **paid campaign** adds platform, offer, approved budget (₹) and approver, daily budget, owner, the admissions receiving owner, and five launch checks: claims and permissions, targeting and dates, form and links, CRM test lead, assignment accepted. A paid campaign cannot move to `live` until all checks pass. Status: `draft`, `approved`, `live`, `paused`, `ended`, `cancelled`. Spend records are dated and must fall within the campaign period. Cost per lead and per admission are blank when inputs are missing. | Marketing-Easy `Campaigns`, `Spend`; `SOP Register` MKT-06, MKT-07 | P2 | Proposed |
| MKT-019 | Repurposing creates placements for chosen accounts from one master idea. Each placement has its own adapted version and a proposed staggered date. A monthly job flags evergreen candidates (top performers older than a configurable 60–90 days) for a fresh version. | `/repurpose` steps 1–7 | P1 | Proposed |
| MKT-020 | A placement history view shows, in order, every version, state change, approval, reschedule (with approver), publication record and metric snapshot. | `A/tracker/versions.csv` (legacy had no history); PLT-005 | P1 | Proposed |
| MKT-021 | Production assets. Each asset record holds: type (recording, script, image, carousel, video cut, B-roll, brand asset), external URL, linked ideas and placements, master or derived, usable notes, rights state (`own`, `third_party_cleared`, `third_party_pending`) and a "shows students" flag. Binary media is not stored in P1. | `A/library/README.md`; `_broll/README.md`; `GEN-011/README.md` | P1 | Proposed |
| MKT-022 | **Consent and rights gate.** An asset flagged "shows students" or `third_party_pending` cannot be attached to a version that is approved, unless a linked consent record (PLT-018) or rights record exists, or the approver attests that "no identifiable faces or names" appear (audited). | `_broll/README.md` rules; `BRAND.md` §3b; OD-008 | P1 | Proposed |
| MKT-023 | Assignment and handoff. Owner, who works next and next deadline are required for open items. Overdue and "missing owner/deadline" flags appear. A recording session (date, face, items to record, script references) can be planned and linked to items. | Marketing-Easy `Content!I`, `J`, `M`, `AB`; CLAT calendar "Recording" | P1 | Proposed |
| MKT-024 | A publishing adapter interface: `schedule`, `publish`, `cancel`, `fetchStatus`, `fetchPostMetrics`. The default **mock adapter** never claims a real post; it returns sandbox IDs labelled as such. Real adapters (Metricool, then native platforms) are enabled only through PLT-017 after OD-006. Media must be passed as a public URL (Metricool constraint). | D-014; `A/HANDOFF.md` §4; `/repurpose` step 4 | P1 (mock), P2 (real) | Proposed |
| MKT-025 | Manual publication record. A user with publish permission can mark an approved or scheduled item as `published` only with the **actual publish time and live link** (both required). | Marketing-Easy `Content!AC` ("Missing publication proof") | P0 | Proposed |
| MKT-026 | **Duplicate-publication prevention.** At most one active publishing record per placement. Publish and schedule calls carry an idempotency key (placement ID + version). Before publishing, the adapter must check for an existing external post ID. Re-publishing requires an explicit "republish" action with a reason (audited). Two placements with identical copy and media on the same account within a configurable window raise a warning. | Prompt requirement; D-012 (idempotency); Marketing-Easy `Content!AF` (duplicate ID check) | P1 | Proposed |
| MKT-027 | Scheduling lead time (default 24 h, configurable): an approved item inside the lead time and not scheduled is flagged "at risk". A past current-publish time without publication is flagged "overdue publication". On-time is measured against the **original** publish time. | Marketing-Easy `Start Here!B11`, `Content!AC`, `AD`; `SOP Register` MKT-04 | P1 | Proposed |
| MKT-028 | **Analytics CSV import** for Meta Business Suite (Instagram) and YouTube Studio exports. It detects the format from headers, maps headers loosely, validates each row, and runs a dry-run preview. Date formats are declared explicitly. Impressions are never stored as views. Duration-based "Short" classification is marked `estimated`. Provenance (file hash, row) and capture time are recorded. A re-import updates the snapshot for that capture instead of duplicating it. Files are archived after import. | `A/tools/import-metrics.mjs` (AUDIT §3.2 and its defects); `A/reports/inbox/README.md` | P1 | Proposed |
| MKT-029 | **Metric semantics.** Every metric value has `value` (nullable), `state` (`reported`, `missing`, `estimated`, `not_applicable`), `source` (import, adapter, manual), `captured_at` and `window` (`24h`, `7d`, `lifetime_at_capture`). Missing values are never shown or summed as 0. Aggregates show coverage (for example "reported for 3 of 5 posts"). Estimated values carry a visible marker. | `import-metrics.mjs` `num()`; `A/courses/cuet/scans/2026-10-12.md` ("approximate… judged by eye"); `A/reports/2026-10-11-week.md` ("Accounts with no numbers") | P1 | Proposed |
| MKT-030 | Imported metric rows are matched to placements by live link, otherwise by account + date + title with a manual confirmation step. Unmatched rows are listed, not dropped. | `/weekly-report` step 2 | P1 | Proposed |
| MKT-031 | A post-performance review falls due a configurable 7 days after publication (and a 24 h result note). It records reviewer, learning and next action, with flags for overdue reviews. | Marketing-Easy `Start Here!B10`, `Post Performance`; `versions.csv` `result_24h` | P2 | Proposed |
| MKT-032 | **Weekly report** (IST Monday–Sunday, also monthly). Per account it shows: placements planned vs published; median and best post; LinkedIn engagement rate = (reactions + comments + reposts) ÷ impressions; Instagram (saves + shares) ÷ reach; YouTube views, watch hours and CTR; top and bottom 3; "do more / stop / test next" notes; accounts with no data, listed by name. Below 6 posts it shows a "pattern not reliable" notice. Exports to Markdown. | `/weekly-report` steps 3–6; `A/reports/2026-10-11-week.md` | P1 | Proposed |
| MKT-033 | Competitor tracking. A register of competitor channels per course, and a YouTube scan through an adapter (mock by default) that ports `yt-scan.mjs`: outlier score = video views per day ÷ the channel's median views per day in the window; format buckets; live streams correctly detected. Manually entered competitor numbers are `estimated`. | `A/tools/yt-scan.mjs` (AUDIT §3.1); `A/courses/*/channels.json` | P2 | Proposed |
| MKT-034 | **Legacy import.** Seeds the accounts (MKT-001), 59 ideas and 36 placements from `A/tracker/*.csv`, with statuses mapped (MKT-004, §2.5). The 4 duplicate-ID pairs (AUDIT DI-01) are imported as **quarantined** records and are never auto-renumbered until OD-003 is decided. Placements whose idea is ambiguous are linked to the quarantine. Teacher names in notes are replaced by role labels (AUDIT §10.2). | AUDIT §11; D-016 | P0 | Proposed |
| MKT-035 | Legacy import of `A/accounts/instagram-clat/post-audit.csv`: 60 historical posts as `published` records (external, pre-system), with metric snapshots captured 7 Oct 2026 (`lifetime_at_capture`; blanks = `missing`), keeping the verdict and reason as tags. | AUDIT DI-13 | P1 | Proposed |
| MKT-036 | Enquiries that arrive as DMs or comments are handed to Business Ops as leads through a contract (`marketing.enquiry.captured.v1`) carrying the source account, channel and content ID if known. Marketing does not keep contact details after the handoff. | Marketing-Easy `SOP Register` MKT-05; `CRM Import!F`, `I` | P1 | Proposed |
| MKT-037 | Marketing summary contract (`GET /marketing/api/internal/v1/summary`): per account per week, placements planned (by original time), published, on time to original, awaiting approval, overdue. Used by the Ops dashboard (OPS-024). | D-011 | P1 | Proposed |

---

## 3. Academic OS (ACD)

### 3.1 Purpose
Plan and run teaching: programmes, curricula and their versioned baselines, batches, timetables, delivery logs, attendance, assessments and results, enrolled students and their progress. Planned work and verified delivered work stay separate throughout.

### 3.2 Users and roles
- `academic_coordinator` plans, schedules, verifies delivery and manages assessments.
- `teacher` logs sessions, attendance and marks for assigned batches.
- `director` locks baselines (approval).
- `operations_manager` and `admissions_counsellor` see enrolment handoff status.
- `auditor` reads.

### 3.3 In scope and out of scope
- **In scope:** the programme, course, subject, chapter and subtopic catalogue; batches; teacher assignments; curriculum plan versions (locked or provisional); session duration rules; planned vs completed hours; holiday and closure calendars; capacity; timetable and conflict detection; teaching log and verification; cancellations and rescheduling; attendance; assessments with configurable scoring; results validation; enrolments (from the Business Ops handoff); late joiners and catch-up; progress; interventions; concept-book indices as reference curriculum; legacy planning-data import.
- **Out of scope:** biometric device integration (D-015); the LMS itself (Vacademy is reached through an adapter, if at all); writing concept-book content or questions; importing third-party OCR material (AUDIT §10.6); parent or student portals (D-015); fee handling (OPS and OD-013).

### 3.4 Business rules and legacy planning data

| # | Rule or data | Source | Status |
|---|---|---|---|
| BR-ACD-1 | IPMAT / combined-entrance teaching and practice classes are **75 minutes** | `B/elevate-education-operations/IPMAT_LOCKED_BASELINES.md` | Approved (locked) |
| BR-ACD-2 | CA Foundation classes are 75 minutes and the batch starts 1 March 2027 | `IPMAT_REFERENCE_NOTES.md` ("confirmed"), contradicted by D-016 "Open" (AUDIT DI-18) | Proposed until OD-019 |
| BR-ACD-3 | Online Class 12 boards + CUET classes are **60 minutes** | `B/Claude.md` §9; Online-Easy `Rules!C22` | Proposed (stream paused; OD-020) |
| BR-ACD-4 | Assessment durations are in minutes and independent of the class unit. A blank duration is unknown, not zero. Full mocks use the applicable exam duration. | `IPMAT_LOCKED_BASELINES.md` (Verbal assessment); `Assessment budget!F20` | Approved (locked text) |
| BR-ACD-5 | Locked baselines: Quant 151 teaching (114 + 37 higher maths), Verbal 57, LR 32, DI 13 = **253 teaching classes**; LR/DI sequence of 27 topics; Verbal tests VT01–VT14, rounds A and B (28 papers) | `IPMAT_LOCKED_BASELINES.md` (10 Sep 2026) | Approved (locked) |
| BR-ACD-6 | Class 12 accelerated override (this batch only): **253 + 52 = 305 classes / 381.25 h**; 2 classes a day; Mon–Fri Apr–Jun; Mon–Sat from July plus a Tue/Thu third class to 15 Oct; DI from 7 June; higher maths from 14 July; teaching target 15 Oct. It must not be applied to Class 11, dropper or fast-track batches. | `CLASS12_ACCELERATED_BASELINE.md`; `Class-12-Course-Planner.xlsx` | Approved (counts); dates provisional |
| BR-ACD-7 | Capacity: 345 gross pre-IIMB slots − 28 reserved (5 holiday + 5 school-exam days, monthly weighted) = **317 net** against 305, leaving **12 headroom**. Weekends are already excluded and must not be deducted twice. Capacity totals alone do not prove a feasible dated schedule. | `Assessment budget!B28:B35`, `A41:F54` | Approved (allowance locked; dates provisional) |
| BR-ACD-8 | Chapter tests: Quant 25, Verbal 28, LR 11, DI 6 = 70. A test may be scheduled only after its prerequisite lessons' planned completion. Saturday tests and Sunday discussions are capped at 210 minutes per weekend (draft). | `Assessment budget!F5:F8`; `Chapter tests!L`; `Weekend map` | Approved (counts); weekend map Proposed (OD-017) |
| BR-ACD-9 | Full mocks: 70 vs 50 IIM-focused (conflict) | AUDIT DI-16 | Proposed until OD-016 |
| BR-ACD-10 | Stable chapter IDs: never renumber to close gaps. Retired and moved IDs stay as aliases: B4-11 merged into B4-10; B1-12…B1-17 moved to B6-18…B6-23; B1-25 moved to B5-07 (later CR IDs shifted by one). | `B/Claude.md` §2.7, §7; concept-book workbook | Approved (indices locked) |
| BR-ACD-11 | Delivered hours count only sessions that are completed or partial **and verified** (verified by, verified at). Combined lessons are split across topic IDs without double-counting minutes. Teaching completion is not testing completion, which is not mastery. | `Elevate-Operations.xlsx` `Accountancy Plan!H`, `Guide!B5:B7`; `CA_FOUNDATION_ACCOUNTANCY_DRAFT.md` | Approved (operating rule recorded in the workbook guide; formula implemented) |
| BR-ACD-12 | The test workflow is tracked step by step: conducted → checked → (re-evaluation) → discussed (compulsory) → parent report. Each step has its own date and evidence. Checked originals are returned after the relevant checking stage. | `B/Claude.md` §4; `Test Tracker` columns; Decisions D-011 | Approved (D-011 "Confirmed"; workflow described) |
| BR-ACD-13 | Offline: call the parent or guardian after **15 minutes** of unexplained absence; record the reason and next action | Decisions D-006; Work Inventory OP-014 | Approved |
| BR-ACD-14 | Online: absence check about 15 minutes after start; present ≥ 45 of 60 minutes counts as present, less as partial; reconcile technical issues first | Online-Easy `Rules!C22`; SOP docx | Proposed (OD-022) |
| BR-ACD-15 | Late joiners join live classes immediately and receive earlier recordings and materials (online). CA uses temporary subject-specific catch-up groups that merge when ready, not permanent new batches. Catch-up hours are tracked separately from main delivery. | Online-Easy `Rules!C19`; Decisions D-015; `Catch-up Log!A2` | Approved |
| BR-ACD-16 | Scoring is configurable per assessment and section. Examples from the legacy files: CLAT +1 / −0.25 per wrong answer, 0 for unanswered, 120 questions in 2 h; IPMAT Indore has an MCQ penalty, no penalty on short answers, and three separately timed 40-minute sections. Official patterns must be re-verified each cycle. | CLAT strategy; `ideas.csv` `CLAT-011`; `IPMAT_WEB_REFERENCE_REVIEW.md` | Proposed (external facts, dated) |

**Legacy planning data to import (status labels preserved; nothing seeded as delivered):**

| Data | Path | Status label |
|---|---|---|
| IPMAT full-year locked baselines (subtopic allocations, practice, Verbal tests) | `B/elevate-education-operations/IPMAT_LOCKED_BASELINES.md`; `B/outputs/Verbal-Teaching-Estimates-v2.md` | `locked` (full-year template), `superseded` for Class 12 |
| IPMAT Class 12 planner: 305 lessons, 70 chapter tests, assessment budget, 28-slot allowance, 8 homework items | `B/outputs/class12-planner/Class-12-Course-Planner.xlsx` | counts `locked`; lesson dates `provisional`; test dates `draft`; mocks `conflict` |
| Six concept-book indices (133 + 1 chapters), CR counts 1,150 | `B/outputs/concept-books/Elevate-Concept-Book-Indices.xlsx` | `locked` (content empty) |
| CA Foundation Accountancy: 46 topics (`ACC-01-01…`), 11 tests, batch `CAF-SEP27-REG` | `B/outputs/CA-Foundation-Accountancy-Full-Plan.md`; `B/outputs/elevate-operations/Elevate-Operations.xlsx` | `provisional` |
| Online Class 12 Accountancy (14 chapters, 118 CBSE h → 226 h total) | `B/Claude.md` §9 (text only) | `provisional` |
| Combined IIM entrance syllabus (Q01–Q17, V…) | `B/outputs/Combined-IIM-Entrance-Syllabus.md` | `draft` (reference) |

### 3.5 Functional requirements

| ID | Requirement | Source | Priority | Status |
|---|---|---|---|---|
| ACD-001 | Maintain the curriculum hierarchy programme → course → subject → chapter → subtopic, with stable codes. A code is never renumbered. Retired or moved codes stay as aliases that resolve to the current record (BR-ACD-10). | `B/Claude.md` §2.7, §7 | P0 | Approved (rule) |
| ACD-002 | Batches record: code (for example `CAF-SEP27-REG`), programme, target exam or attempt, route (`regular`, `dropper`, `class11_two_year`, `fast_track`), mode (`offline`, `online`), start date (nullable), coverage target, revision window, mock window, weekly pattern, status (`planning`, `active`, `completed`, `cancelled`). | `Elevate-Operations.xlsx` `Batch Register`; `B/Claude.md` §6 | P0 | Proposed |
| ACD-003 | Assign teachers (core staff, PLT-016) to batch and subject with an employment type (full- or part-time) and availability windows. One teacher may serve several batches. | `B/Claude.md` §4; Work Inventory OP-025 | P1 | Proposed |
| ACD-004 | **Curriculum plan versions.** A plan (for a programme template or a batch) has items: subtopic, session type (`teaching`, `practice`), planned class count and minutes. Version states are `draft`, `proposed`, `locked`, `superseded`. Locking records approver, date and scope note (PLT-007). A locked version is immutable; a change creates a new version linked to its predecessor with a change log. A batch-scoped override never alters the template or other batches (BR-ACD-6). | `IPMAT_LOCKED_BASELINES.md`; `CLASS12_ACCELERATED_BASELINE.md`; `B/Claude.md` §2.3 | P0 | Approved (rule: preserve baselines and change log; locks recorded) |
| ACD-005 | Session duration is configured per programme or batch, never hard-coded. Hours = classes × minutes ÷ 60. Seed values: IPMAT 75 (Approved); online Class 12: 60 (Proposed); CA: 75 (Proposed, OD-019). Assessment minutes are independent of the class unit (BR-ACD-4). | BR-ACD-1 to BR-ACD-4 | P0 | Proposed |
| ACD-006 | **Planned vs completed.** Per plan item, chapter, subject and batch, show baseline (from the locked version), planned to date, verified completed (BR-ACD-11), variance (actual − planned minutes), forecast remaining (entered manually and reviewed) and forecast variance (actual + forecast remaining − baseline). The baseline is never overwritten by actuals. | `Accountancy Plan!G:J`; `Guide!B8` | P0 | Approved (rule implemented in the legacy workbook) |
| ACD-007 | **Teaching log.** One record per dated session per topic: date, batch, topic, activity (`main`, `practice`, `catch_up`, `test`, `discussion`), teacher, planned and actual minutes, status (`planned`, `completed`, `partial`, `cancelled`, `rescheduled`), evidence or notes, updated by and at. A coordinator verifies (verified by and at, both fixed once set). | `Elevate-Operations.xlsx` `Teaching Log`, `Guide!B5:B6` | P0 | Proposed |
| ACD-008 | **Legacy planning import.** Imports the data in §3.4 with status labels preserved. Every delivery field (actual date, actual minutes, faculty, verification, test status) stays empty. Volatile cached values are ignored. Conflicts (full mocks, CA start) are imported with a visible conflict flag. P0 covers the IPMAT Class 12 planner and the concept-book indices; P1 covers CA and online Accountancy. | D-016; AUDIT §11 | P0 | Proposed |
| ACD-009 | **Holiday and closure calendar** per centre or batch. Dated closures carry type (holiday, school exam, other), slots lost and status (`provisional`, `confirmed`). Undated monthly allowances (for example 28 reserved slots) are separate records and are replaced, not added to, when dated closures are entered. Weekends and other non-teaching days are never deducted twice. | `Assessment budget!A41:F54`; `Weekend map!C45` | P1 | Approved (allowance locked; dates provisional, OD-018) |
| ACD-010 | **Capacity calculation** per month and per period: gross = teaching days × classes per day + extra slots; net = gross − closures or allowances; headroom = net − planned. It flags months that are over capacity ("relocation needed") and states that totals alone do not prove feasibility. | `Monthly allocation!D`, `M`; `Assessment budget!B30:B53` | P1 | Approved (formula and allowance locked for Class 12) |
| ACD-011 | **Timetable.** Dated sessions (date, slot, start time, batch, subject, teacher, room or online link), generated from a weekly pattern (for example two 75-minute classes Mon–Fri Apr–Jun, Mon–Sat from July, a third class Tue/Thu) and editable one by one. | `IPMAT_LOCKED_BASELINES.md` "Class 12 weekly timetable — locked"; `CLASS12_ACCELERATED_BASELINE.md` | P1 | Approved (Class 12 pattern) |
| ACD-012 | **Conflict detection** (reports, never silent auto-fix): teacher double-booked; batch double-booked; session on a closure; daily slot count exceeded; lesson before its prerequisite; test before its prerequisite lessons' planned completion; weekend assessment cap exceeded; teacher on recorded leave (if OD-026 brings leave into scope). | `Chapter tests!L`; `Weekend map`; SOP docx ("check batch and faculty clashes") | P1 | Proposed |
| ACD-013 | **Cancellation and rescheduling.** Cancelling needs a reason and an approver. Rescheduling creates a linked replacement session and carries any unfinished topic. Teacher and batch are notified (PLT-010). Dependent tests are flagged, not moved automatically. | SOP docx ("obtain the required approval, arrange a replacement slot"); `CLASS12_ACCELERATED_BASELINE.md` ("does not automatically reschedule tests") | P1 | Proposed |
| ACD-014 | **Attendance** per session per enrolled student: `present`, `partial`, `late`, `absent`, `excused`. Thresholds are configurable (online default ≥ 45/60 minutes, Proposed). Sessions without attendance are reported as missing, not as 0%. Import from an LMS adapter (mock) is P2. | Online-Easy `Rules!C9`, `C22`; OD-022 | P1 | Proposed |
| ACD-015 | **Absence follow-up.** An unexplained absence creates a follow-up item due 15 minutes after the session starts (offline, configurable), with owner, contact outcome, reason and next action. Unanswered calls stay open. Repeated absences escalate to the coordinator. | Decisions D-006; SOP docx "Attendance and absence calls" | P1 | Approved (offline 15-minute rule) |
| ACD-016 | **Assessments.** Types: chapter test, sectional, full mock, practice paper. Variants such as Paper A and Paper B are distinct papers. Each has linked chapters or lessons, test duration (minutes, nullable = unknown), discussion duration, scheduled dates and a workflow of separately dated states per BR-ACD-12. Per-student status: `absent`, `retest_due`. | `Chapter tests`; `Test Tracker`; `IPMAT_LOCKED_BASELINES.md` Verbal assessment | P1 | Approved (workflow, D-011; Verbal A/B locked) |
| ACD-017 | **Configurable scoring schemes**, versioned. Each holds: sections, questions per section, marks per correct answer, penalty per wrong answer (for example −0.25), unanswered score, per-question-type overrides (for example short answers with no penalty), section time limits and maximum marks. Scores are computed deterministically from responses or counts. A change to a scheme never rescores released results silently. | BR-ACD-16 | P1 | Proposed |
| ACD-018 | **Results entry and validation.** Rejected: correct + wrong + unanswered ≠ the number of questions; a score outside the scheme's [min, max]; a duplicate entry per student and assessment; marks for a student not enrolled in the batch. Absent is not a zero score. Released results are locked; corrections need a reason and are audited. | Standard practice; BR-ACD-12 | P1 | Proposed |
| ACD-019 | **Students and enrolments.** A student record holds minimal personal data and a guardian contact for under-18s (PLT-014). An enrolment (student, batch, start date, status `active`, `paused`, `withdrawn`, `completed`) is created **only** by consuming the Business Ops admission event (idempotent: one enrolment per admission) or manually by a coordinator with a reason. Academic replies with an enrolment-created or enrolment-rejected event. | D-011; `B/Claude.md` §4 (admission → onboarding → classes) | P0 | Proposed |
| ACD-020 | **Late joiners and catch-up.** An enrolment after the batch start is flagged as a late joiner, with missed topics computed from the plan. Catch-up groups (temporary, subject-specific) hold intake, missed topics, sessions, readiness and merge date. Catch-up hours are logged separately (BR-ACD-15). | `Catch-up Log`; Decisions D-015; Online-Easy `Rules!C19` | P1 | Approved (rule) |
| ACD-021 | **Progress views.** Per batch: planned vs verified completed classes and hours by subject and chapter, tests conducted against plan, and attendance rate with coverage. Per student: attendance, assessment results, missed topics and catch-up status. Teaching completion, test completion and results are shown as separate measures. | BR-ACD-11; `CA_FOUNDATION_ACCOUNTANCY_DRAFT.md` | P1 | Proposed |
| ACD-022 | **Interventions.** Rule-based risk flags (repeated absence, missed tests, scores below a configurable threshold, overdue catch-up) open an intervention with owner, action, due date, outcome and parent-communication status. Escalation follows PLT-010. | `SYSTEM_ARCHITECTURE.md` "Student Success"; OD-023 | P2 | Proposed |
| ACD-023 | **Concept-book reference.** Six books, chapter IDs, subtopic index, content status (all `not_started`) and planned question counts by tier (CR counts imported; Quant and Higher Maths blank pending OD-024). | Concept-book workbook | P1 | Approved (indices and CR counts locked) |
| ACD-024 | **Target exam calendar** per batch: exam, date, date status (`official`, `tentative`, `assumed`), source and as-of date. The access-expiry date for online batches derives from the target exam date. The UI warns when a plan relies on an `assumed` date. | `IPMAT_WEB_REFERENCE_REVIEW.md`; `Overview!B30`; Online-Easy `Rules!C17` | P1 | Proposed |
| ACD-025 | Practice removed from the classroom is tracked as a homework assignment (topic, batch, status `to_assign`, `assigned`, `done`). The 8 legacy items are imported. | `Overview!A34:G45` | P2 | Approved (user-approved practice removal) |
| ACD-026 | A weekend assessment map: a configurable weekend cap (default 210 minutes); tests on Saturday and discussions on Sunday; Paper B on a later weekend than Paper A; readiness-based placement with a list of spillover beyond a target date. The legacy draft is imported as `draft`. | `Weekend map`; `CLASS12_ACCELERATED_BASELINE.md` "Weekend chapter assessment map — draft" | P2 | Proposed (OD-017) |
| ACD-027 | Academic summary contract (`GET /academic/api/internal/v1/summary`): per batch, planned to date vs verified completed hours, sessions cancelled, attendance rate with coverage, tests planned vs conducted, enrolment handoffs pending or failed. | D-011 | P1 | Proposed |
| ACD-028 | A private parent communication log for test results and reports: recipient verified against the guardian record, channel, sent at, failed deliveries followed up. Sending goes through PLT-010 adapters only. | Online-Easy `Rules!C13`, `C15`; SOP docx | P2 | Approved (rules "Reports… team verifies and sends privately" and "Registered guardian" are Locked) |

---

## 4. Business Operations OS (OPS)

### 4.1 Purpose
Run the institute's operations: enquiries and leads through counselling, demo, admission and the enrolment handoff; staff, responsibilities and backups; tasks with dependencies and escalation; SOPs; decisions; risks; projects; and one management dashboard with defined KPIs.

### 4.2 Users and roles
- `admissions_counsellor` (reception and academic counsellor) works leads.
- `operations_manager` owns tasks, SOPs, escalations and responsibilities.
- `director` approves admissions exceptions, policies and SOPs.
- Department heads (role assignments) own departmental tasks.
- `auditor` reads.

### 4.3 In scope and out of scope
- **In scope:** leads and enquiries with sources; duplicate-contact detection; counselling; demos; the admission pipeline and transitions; admission checklist; enrolment handoff; onboarding tasks; staff directory, departments, responsibilities and backups (core stewardship); tasks with dependencies, escalation and routines; the SOP register and versions; the decision log; the policy register; risks, issues and blockers; projects and milestones; outreach events as lead sources (P2); the management dashboard.
- **Out of scope (explicit):** payroll; biometric devices and their attendance feeds; HRIS (hiring, contracts, leave, appraisal) and legal employment records; **employee rankings, scorecards or individual performance scoring**; accounting and invoicing (Tally stays the source; fee scope is OD-013); parent and student portals; the public website (D-015).

### 4.4 Business rules

| # | Rule | Source | Status |
|---|---|---|---|
| BR-OPS-1 | Pipeline: lead → (first successful contact) → academic counselling → demo → admission → onboarding → enrolment in Academic OS. Reception gives basic information; the academic counsellor does detailed counselling and conversion. | `B/Claude.md` §4; Work Inventory OP-004 | Approved |
| BR-OPS-2 | **Demo: 2 days; ₹1,000; non-refundable if the student does not join; adjusted against course fees on joining; separate demo classes, never the ongoing main batch; teachers booked and notified.** The earlier 3-day demo is superseded. | `Elevate-Operations.xlsx` Decisions D-003, D-004; `B/Claude.md` §4 | **Approved** ("Confirmed") |
| BR-OPS-3 | Demo limits (consecutive days, subject cap, missed day) | Decisions D-005 | Open (OD-012) |
| BR-OPS-4 | "Contacted" means the first successful two-way contact; unanswered calls do not count | Marketing-Easy `Start Here!A32` | Proposed |
| BR-OPS-5 | One primary source per lead; the discovery source is kept separately; Unknown stays Unknown; a campaign is recorded only when identifiable | Marketing-Easy `Start Here!A33` | Proposed |
| BR-OPS-6 | Confirmed admission = an approved fee arrangement + required documents + a verified down payment. A demo fee alone is not admission. | Marketing-Easy `Start Here!A31` | Proposed |
| BR-OPS-7 | A fee agreement needs two verifications and an authorised signed approval; documents are verified and retained | Work Inventory OP-010, OP-008 | Approved ("Confirmed") |
| BR-OPS-8 | Do not report this week's admissions ÷ this week's new leads. Conversion is reported by lead cohort over 7, 14 and 30-day windows. | Marketing-Easy `SOP Register!G14`; `Cohorts`; `B/Claude.md` §10 | Proposed |
| BR-OPS-9 | Every follow-up has an owner and a due date | `B/Claude.md` §4 | Approved (stated requirement) |
| BR-OPS-10 | Work status standard: Not started, In progress, Waiting, At risk, Blocked, Completed, Cancelled. Escalation levels: L1 owner; L2 department head; L3 cross-department or operations lead; L4 leadership decision. | `SYSTEM_ARCHITECTURE.md` | Proposed (starting model) |
| BR-OPS-11 | Completion requires evidence, owner and date, not just a tick | `PROJECT_CHARTER.md`; Online-Easy `Actions!J` | Approved (principle in charter; recorded as operating rule) |
| BR-OPS-12 | Every important outcome has one accountable owner; critical processes have approved SOPs and trained backups | `PROJECT_CHARTER.md` principles and success measures | Proposed |
| BR-OPS-13 | Rules and policies carry a decision state. A proposed rule (for example the 15-minute online absence check or monthly reports by the 5th working day) is shown as proposed and is never presented as policy. | `B/Claude.md` §11; Online-Easy `Rules` | Approved (working rule) |
| BR-OPS-14 | Online office hours are Mon–Sat 11:00–18:00 IST; Sunday events need assigned event cover; there is no routine Sunday support | Online-Easy `Rules!C5:C6` | Approved ("Locked") |
| BR-OPS-15 | Exceptions (refunds, waivers, special fees, extensions) need authorised approval; the limits are pending | Online-Easy `Rules!C20`; Actions ON-005 | Proposed (OD-013) |

### 4.5 Functional requirements

| ID | Requirement | Source | Priority | Status |
|---|---|---|---|---|
| OPS-001 | **Lead capture.** Fields: student name, student and parent contacts, previous school, course interest (programme code), interest mode (`offline`, `online`, `undecided`), received at, first enquiry source, account or channel, discovery source, campaign or activity ID, content ID if known. Entry is manual (reception and counsellors). Leads arriving from Marketing (MKT-036) are accepted through the contract. | `B/Claude.md` §4; Marketing-Easy `CRM Import!A:I` | P0 | Proposed (system of record: OD-010) |
| OPS-002 | Source lists are configurable. The default list is Instagram organic, Meta ads, Google ads, Google search/Maps, Seminar, Webinar, Newspaper, Walk-in, Referral, YouTube organic, Other, Unknown. Attribution follows BR-OPS-5. | `CRM Import!E` list; `B/Claude.md` §4 | P0 | Proposed |
| OPS-003 | **Duplicate-contact detection.** Phone numbers are normalised (Indian numbers to +91 E.164; spaces, dashes and a leading 0 removed) and emails lower-cased. When a lead is created, an exact match on any normalised phone or email shows "existing contact", with a link and the option to attach as a new enquiry on the existing person. A fuzzy match (similar name + same school or parent phone) shows "possible duplicate". Nothing is merged automatically. Merging is explicit, audited and keeps both enquiries and sources. | `B/Claude.md` §11 ("CRM deduplication"); Marketing-Easy `SOP Register` MKT-05 ("deduplicate"); `CRM Import!V` | P0 | Proposed |
| OPS-004 | **Assignment and handoff acceptance.** A lead has an assigned owner. It is `handoff_pending` until the owner accepts (acceptance timestamp). Flags: `unassigned`, `handoff_pending`, `accepted`. | `CRM Import!J`, `L`, `Y`; MKT-05 | P0 | Proposed |
| OPS-005 | **Lead pipeline states:** `new` → `contacted` → `counselling_booked` → `counselled` → `demo_booked` → `demo_in_progress` → `demo_completed` → `admission_pending` → `admitted`. `lost` and `not_interested` are reachable from any open state, with a reason. Reopening needs a reason. Stages may be skipped forward (for example a walk-in counselled on the spot), with intermediate first-attainment timestamps left empty. The server enforces transitions and records each stage's first-attainment time once. | `CRM Import!K` list, `M:Q`; BR-OPS-1 | P0 | Proposed |
| OPS-006 | Contact attempts are logged as activities (call, WhatsApp, visit, email), each with an outcome. Only a successful two-way contact sets `first_successful_contact_at` (BR-OPS-4). | `Start Here!A32` | P0 | Proposed |
| OPS-007 | **Follow-ups.** Open leads require a next action and due date. Flags: `missing_next_action`, `overdue`, `upcoming`. Due dates and SLAs use configurable service hours (OD-011). | `CRM Import!X`; BR-OPS-9; Work Inventory OP-007 | P0 | Approved (rule BR-OPS-9) |
| OPS-008 | **Counselling sessions:** date, counsellor, mode, attendees (student and/or parent), programme recommended, objections, outcome, next step. | `B/Claude.md` §4; OP-004 | P1 | Proposed |
| OPS-009 | **Demo** per BR-OPS-2. It records the subjects, the two demo days, the separate demo sessions (never linked to a main-batch session), the teachers booked and notified, and the demo fee status (`not_paid`, `paid_verified`), with ₹1,000 as a configurable amount. The fee is marked "adjust against fees" on admission and "non-refundable" if lost. Limits are configurable (OD-012). | Decisions D-003, D-004; OP-005, OP-006 | P0 | Approved |
| OPS-010 | **Admission confirmation** is allowed only when: the fee arrangement is approved (two verifications by different users + authorised approval through PLT-006); the required-documents checklist is complete; and the down payment is marked verified by the role holding fee verification. A demo fee alone cannot satisfy this (BR-OPS-6, BR-OPS-7). The system stores verification **status and references**, not accounting entries (OD-013). | Marketing-Easy `Start Here!A31`; OP-010, OP-011 | P0 | Approved (two-verification and authorised-approval rule, OP-010 "Confirmed"; the full definition is Proposed) |
| OPS-011 | **Admission checklist:** admission form; documents (checklist status only, no file storage unless OD-014); school-admission coordination and hostel coordination as separate linked records; kit issued (box, T-shirt, bag); added to communication group; timetable communicated. | OP-008, OP-009, OP-012 | P1 | Approved (items "Confirmed" in Work Inventory) |
| OPS-012 | **Enrolment handoff.** Confirming an admission writes `ops.admission.confirmed.v1` (admission ID, student and guardian details, programme, preferred batch, start date, mode) to the outbox in the same transaction. Ops shows the handoff status (`pending`, `enrolled`, `rejected` with reason, `failed` with retry). Duplicate events never create duplicate enrolments (ACD-019). | D-011 | P0 | Proposed |
| OPS-013 | **Onboarding tasks** generated on admission: login and access (online), correct course and batch access, groups, timetable, kit, late-joiner materials. Each task has an owner and is closed with evidence. | Online-Easy `Routine!A16`; SOP docx "Student onboarding"; OP-012 | P1 | Proposed |
| OPS-014 | **Departments and staff directory** (core stewardship, PLT-016). Departments are seeded as `proposed` from the 13 suggested in `SYSTEM_ARCHITECTURE.md`. Staff records hold: fictional seed names only, employment type, department, reporting line, linked user, roles held. | `SYSTEM_ARCHITECTURE.md`; D-010 | P0 | Proposed |
| OPS-015 | **Responsibilities and backups:** function or process → accountable role, named holder, backup, manager, "hand over to" role. Gap reports list items with no holder, no backup, or the same person as holder and backup. | Online-Easy `Roles`; SOP docx "Assigned staff / Backup"; `PROJECT_CHARTER.md` | P1 | Proposed |
| OPS-016 | **Tasks:** title, department, owner, due date, priority, status (BR-OPS-10), related record, dependencies (blocked-by tasks), escalation level, evidence. A task cannot be `Completed` without a completion note or evidence (BR-OPS-11), or while a blocking dependency is open unless overridden with a reason. Dependency cycles are rejected. Flags: `missing_owner`, `missing_due`, `overdue`, `due_today`. | `templates/master_tracker.csv`; Online-Easy `Actions!J`; `SYSTEM_ARCHITECTURE.md` | P0 | Proposed |
| OPS-017 | **Escalation.** Configurable thresholds (for example overdue by N working days, blocked for N days) propose or raise escalation L1 → L4 per BR-OPS-10. Each escalation has a recipient, a reason, a required response time, and is acknowledged and resolved. The original owner keeps follow-up ownership until handover is acknowledged. | `SYSTEM_ARCHITECTURE.md`; SOP docx "Records escalation and authority" | P1 | Proposed |
| OPS-018 | **Routine templates** (daily opening, each class, daily closing, weekly, monthly) generate dated tasks. A routine checklist is never treated as proof of completion. | Online-Easy `Routine!A2` | P2 | Proposed |
| OPS-019 | **SOP register and lifecycle:** SOP ID, department, process, owner role, named owner, backup, risk level, priority, status (`not_drafted` → `draft` → `in_review` → `approved` → `effective` → `under_revision` → `retired`), version, approver, effective date, next review date, training complete, document link. `approved` needs a PLT-006 decision. A new version never erases the previous one. Section structure follows `sop_template.md` (purpose, scope, roles, trigger, inputs, procedure, quality checks, exceptions and escalation, records, measures, training, revision history). Review-due flags appear. | `templates/sop_register.csv`, `sop_template.md`; three legacy registers | P1 | Proposed |
| OPS-020 | **SOP training acknowledgements** per staff member per SOP version (acknowledged at). An SOP is "fully trained" only when the holder and backup have acknowledged it. | `sop_template.md` §11; SOP docx "Staff acknowledgement" | P2 | Proposed |
| OPS-021 | **Decision log:** decision ID, area, statement, state (`open`, `proposed`, `confirmed`, `provisional`, `superseded`), decided by, date, source, linked records, superseded-by. Legacy decisions are imported with namespaced IDs and their legacy state (AUDIT §4). | `Elevate-Operations.xlsx` `Decisions`; AUDIT DI-21 | P0 | Proposed |
| OPS-022 | **Policy register:** each operational rule that drives behaviour (demo fee, office hours, grace period, SLAs, absence threshold) has a decision state (PLT-007). Configuration values that implement a policy link to the policy record. The UI marks values that implement a `proposed` policy. | Online-Easy `Rules`; BR-OPS-13 | P1 | Approved (working rule BR-OPS-13) |
| OPS-023 | **Risks, issues and blockers.** A risk has description, likelihood, impact, owner, mitigation, review date and status. An issue or blocker links to tasks or projects and has an owner and a target date. Open high-severity risks and items without an owner are flagged. | `SYSTEM_ARCHITECTURE.md` "Common records" | P1 | Proposed |
| OPS-024 | **Management dashboard** showing the KPIs in §4.6, each with its definition visible on hover, as-of time, coverage, and "source unavailable" for failed module summaries (PLT-009). Targets are configurable and marked `proposed` until OD-027. | `PROJECT_CHARTER.md` success measures; Marketing-Easy `Dashboard`, `Cohorts` | P1 | Proposed |
| OPS-025 | **Projects and milestones:** project, workstream, owner, start and end, milestones with dates and status, linked tasks, a timeline view. | Marketing-Easy `Project Plan`; `IMPLEMENTATION_ROADMAP.md` | P2 | Proposed |
| OPS-026 | **CRM export import** (if OD-010 keeps an external CRM). Column mapping is validated, an extract as-of date is required, and lead-ID duplicates in the file must be zero. Until validated, pipeline KPIs from imported data show "pending validated export", not numbers. | Marketing-Easy `Start Here!B6:B14` | P1 | Proposed |
| OPS-027 | **Outreach events** (school seminar, school visit, webinar, workshop, newspaper, local promotion): partner permission, budget approval, material approval, presenter. Attendance is recorded separately from genuine leads. Leads are attributed by activity ID. Review within 3 working days. | Marketing-Easy `Outreach`, `SOP Register` MKT-08; `B/Claude.md` §11 (two webinars a week) | P2 | Proposed |
| OPS-028 | **Lead data protection.** Contact fields are visible only to admissions and operations roles. Exports are permissioned and audited. Lost or not-interested leads have a retention period (configurable; owner decision). | PLT-014; Marketing-Easy `Start Here!C34` | P1 | Proposed |
| OPS-029 | A **department intake form** (profile, recurring work, projects, KPIs, problems and risks, SOP inventory, improvement priorities) feeds the task, SOP and risk registers. | `templates/department_intake.md`; `README.md` "Next milestone" | P2 | Proposed |

### 4.6 Management dashboard KPI definitions (OPS-024)

The default window is the selected IST week (Monday 00:00 to Sunday 23:59). Every KPI shows an as-of time.

| KPI | Numerator | Denominator | Window | Source | Missing-data behaviour |
|---|---|---|---|---|---|
| K-01 New leads | Leads with `received_at` in the window, excluding records merged as duplicates | — | Week (also month) | `ops.leads` | If lead intake depends on an import whose as-of date is before the window end, show "partial to <date>". If no source is configured, show "no data". |
| K-02 First contact within SLA | Leads in the window whose `first_successful_contact_at − received_at` ≤ SLA (service hours) | Leads in the window whose SLA deadline has passed | Week | `ops.leads`, activities | "n/a" if the denominator is 0. If no SLA is configured (OD-011), show only K-03. |
| K-03 Median time to first contact | Median hours, received → first successful contact | Leads in the window that were contacted | Week | same | Shows the count "not yet contacted (n)" separately. Never treats uncontacted leads as 0 hours. |
| K-04 Cohort counselling rate (7/14/30 d) | Cohort leads with counselling completed within N days of receipt | Leads received in the cohort week | 13 cohort weeks ending in the selected week | `ops.leads` stage timestamps | Each N-day value is blank ("window not elapsed") until the as-of date ≥ cohort week end + N |
| K-05 Cohort demo rate (7/14/30 d) | Cohort leads with a demo started within N days | Leads in the cohort week | as K-04 | same | as K-04 |
| K-06 Cohort admission rate (7/14/30 d) | Cohort leads admitted (BR-OPS-6) within N days | Leads in the cohort week | as K-04 | same | as K-04. **Never** this week's admissions ÷ this week's leads (BR-OPS-8). |
| K-07 Demo → admission (30 d) | Demos completed in the week whose lead is admitted within 30 days of demo completion | Demos completed in the week | Weeks whose 30 days have elapsed | `ops.demos`, `ops.admissions` | Blank until 30 days have elapsed |
| K-08 Admissions confirmed | Admissions with `confirmed_at` in the window | — | Week, month | `ops.admissions` | None needed (internal source) |
| K-09 Source mix | Leads per primary source in the window | All leads in the window | Week, month | `ops.leads` | Unknown is shown as its own category with its share highlighted, never dropped |
| K-10 Follow-up health | (a) open leads with next action overdue; (b) open leads with no next action or date | — (counts) | Point in time | `ops.leads` | — |
| K-11 Ownership health | Open leads `unassigned`; `handoff_pending` past the acceptance SLA | — | Point in time | `ops.leads` | — |
| K-12 Duplicate rate | Leads created in the window flagged as exact duplicates | Leads created in the window | Week | `ops.leads` | If unresolved exact duplicates exist, K-01 to K-09 are labelled "provisional" (legacy readiness gate, `Start Here!B13:B14`) |
| K-13 Enrolment handoff | (a) median hours from admission confirmed → enrolment created; (b) handoffs pending > 24 h; (c) failed | — | Week; point in time | `core.integration_events`, ACD summary | If the ACD summary is unavailable, show "source unavailable" for (a). (b) and (c) come from the Ops outbox. |
| K-14 Task ownership coverage | Active tasks (not Completed or Cancelled) with an owner **and** a due date | Active tasks | Point in time | `ops.tasks` | Target ≥ 95% from the charter, marked proposed (OD-027) |
| K-15 Overdue and blocked tasks | Active tasks with due < today; tasks `Blocked`; by department | — | Point in time | `ops.tasks` | — |
| K-16 Open escalations | Unresolved escalations by level L1–L4; median age in days | — | Point in time | `ops.escalations` | — |
| K-17 Critical SOP coverage | Processes marked critical whose SOP is `effective` **and** has a backup owner **and** has training complete | Processes marked critical | Point in time | `ops.sops`, responsibilities | If no process is marked critical, show "not configured", not 100% |
| K-18 Open decisions | Decisions in `open` or `proposed`; median age | — | Point in time | `ops.decisions` | — |
| K-19 Risk exposure | Open risks rated high; risks with no owner | — | Point in time | `ops.risks` | — |
| K-20 Academic delivery (per batch) | Verified completed teaching hours to date (BR-ACD-11) | Planned hours to date in the current locked or active plan version | Cumulative to today | ACD summary (ACD-027) | "source unavailable" if the summary fails. "No plan" if the batch has no active version. Never computed from unverified logs. |
| K-21 Attendance (per batch) | Student-sessions present (partial counted per the configured rule) | Student-sessions with attendance recorded | Week | ACD summary | Sessions without attendance are shown as a separate count, never as absences or 0% |
| K-22 Marketing publishing (per account) | Placements published in the window; on time to their original time | Placements with an original publish time in the window | Week | MKT summary (MKT-037) | "source unavailable" if the summary fails |

---

## 5. Cross-module contracts (summary)

| Contract | Producer → consumer | Style (D-011) | Priority |
|---|---|---|---|
| `ops.admission.confirmed.v1` and reply `academic.enrolment.created.v1` / `academic.enrolment.rejected.v1` | OPS → ACD → OPS | Outbox command and reply event; idempotent | P0 |
| `marketing.enquiry.captured.v1` | MKT → OPS | Outbox event; OPS dedupes (OPS-003) | P1 |
| `GET /academic/api/internal/v1/summary` | ACD → platform and OPS dashboard | Versioned read contract | P1 |
| `GET /marketing/api/internal/v1/summary` | MKT → platform and OPS dashboard | Versioned read contract | P1 |
| `GET /ops/api/internal/v1/summary` (leads by source, campaign and content; admissions) | OPS → MKT reporting and the platform | Versioned read contract | P2 |
| `core.programmes` (stewarded by ACD); `core.departments` and `core.staff_members` (stewarded by OPS) | Core → all | Foreign keys into core are allowed (D-005) | P0 |
| `core.approvals`, `core.audit_events`, `core.notifications`, consent records | Shared services → all | Shared packages | P0 (approvals, audit); P1 (notifications, consent) |

---

## 6. Open questions for the owner

Each question below maps to an AUDIT §9 decision. Until it is answered, the system uses a configurable default visibly marked "proposed".

| Question | AUDIT OD | Requirements affected |
|---|---|---|
| Which social accounts exist: the approved 9, or also "Elevate CA" and "Elevate Online"? | OD-001 | MKT-001, MKT-002 |
| Who may approve content, and who covers when the Co-Founder is unavailable? | OD-002 | MKT-011, PLT-004, PLT-019 |
| For each duplicated idea ID, which item keeps the ID? | OD-003 | MKT-034 |
| Which pillar list is canonical? | OD-004 | MKT-006 |
| Does the "no CA comparisons" rule cover IPMAT? | OD-005 | MKT-012 |
| Confirm the publishing tool and media host, and provide credentials | OD-006 | MKT-024 |
| Approve the CLAT strategy, calendars and cadence targets, and choose the weekly production cycle | OD-007 | MKT-017, MKT-027 |
| What evidence counts as consent for minors, and is publishing hard-blocked without it? | OD-008 | MKT-022, PLT-018, OPS-011 |
| Which named staff hold which roles, and who are the backups? | OD-009 | PLT-003, OPS-014, OPS-015 |
| Does Elevate OS replace the CRM, or import from it? | OD-010 | OPS-001, OPS-026 |
| Enquiry service hours and response SLAs? | OD-011 | OPS-007, OPS-017, K-02 |
| Demo limits (days, subjects, missed day)? | OD-012 | OPS-009 |
| Fee data scope, and the authority limits for refunds and waivers? | OD-013 | OPS-010, BR-OPS-15 |
| Store identity documents, or a checklist only? | OD-014 | OPS-011, PLT-014 |
| The IPMAT Class 12 exam cycle and official dates? | OD-015 | ACD-011, ACD-024 |
| Full mocks: 70 or 50? Sectional counts? | OD-016 | ACD-016, BR-ACD-9 |
| Approve or rebalance the weekend chapter-test map? | OD-017 | ACD-026 |
| Dated holidays and closures for the centre? | OD-018 | ACD-009, ACD-012 |
| CA Foundation start date, session length and subject budgets? | OD-019 | ACD-002, ACD-005, BR-ACD-2 |
| Confirm the Online Class 12 boards + CUET programme parameters? | OD-020 | ACD-005, BR-ACD-3 |
| Which programmes and batches run in 2026–27? | OD-021 | PLT-015, ACD-002 |
| Attendance thresholds, arrival notifications, and manual vs LMS import? | OD-022 | ACD-014 |
| Parent and progress report cadence? | OD-023 | ACD-022, ACD-028 |
| Quant and Higher Maths practice-bank mapping? | OD-024 | ACD-023 |
| CLAT 2027 offer: Final Sprint or skip to CLAT 2028 (needed by about 20 Oct 2026)? | OD-025 | ACD-002, OPS-001 (programme interest), MKT-018 |
| Is staff leave and availability in scope? | OD-026 | ACD-012 |
| Management KPI targets and the review meeting day? | OD-027 | OPS-024 |
| Approve the online coordinator SOP and the marketing SOPs? | OD-028 | OPS-019 |

---

## 7. Requirement counts

| Module | Total | P0 | P1 | P2 | Approved (rule recorded in legacy) |
|---|---:|---:|---:|---:|---:|
| PLT | 19 | 14 | 4 | 1 | 3 |
| MKT | 37 | 11 | 23 | 3 | 3 |
| ACD | 28 | 8 | 16 | 4 | 12 |
| OPS | 29 | 13 | 11 | 5 | 5 |
| **Total** | **113** | **46** | **54** | **13** | **23** |

MKT-024 is counted under P1, its mock phase; its real-adapter phase is P2. "Approved" means the legacy files record the owner's approval or lock of the *rule* the requirement enforces. The software feature itself is still to be built and tested (D-013).
