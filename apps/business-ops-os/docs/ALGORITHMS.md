# Business Ops OS — algorithms and business rules

Format (BUILD_PLAN): 1 Purpose · 2 Inputs · 3 Output · 4 Preconditions · 5 Rules and constraints · 6 Steps · 7 Errors and edge cases · 8 Permissions · 9 Tests · 10 Known limitations. All dates are Asia/Kolkata calendar days (`YYYY-MM-DD`); instants are UTC. Pure code lives in `src/domain/`; services in `src/server/` only load rows and apply the result inside a transaction.

---

## A-01 Contact normalisation (phones, emails, names) — OPS-003
1. **Purpose.** Store one canonical form per contact so the same number typed differently is recognised.
2. **Inputs.** Raw phone / email / name strings (`normalisePhone`, `normaliseEmail`, `normaliseName`, `nameSimilarity` in `domain/contacts.ts`).
3. **Output.** Phone: `{ ok, e164, kind: india_mobile | india_landline | international }` or `{ ok:false, reason: missing | invalid_characters | invalid_length | invalid_number }`. Email: lower-cased trimmed address or `missing | invalid`. Name: normalised token string and a similarity in [0, 1].
4. **Preconditions.** None (total functions).
5. **Rules.** Separators (space, `-`, `.`, `(`, `)`, `/`) are removed. Only digits and one leading `+` are allowed. `00` → `+`. India is the default country: 10 digits; `0` + 10; `91` + 10; `091` + 10; `+91` + 10; `+91 (0)` + 10 (trunk zero after the country code) all become `+91XXXXXXXXXX`. The national number must not start with 0. First digit 6–9 = mobile, 1–5 = landline (STD code). Other countries need `+`/`00` and 8–15 digits and are kept as given. Emails are trimmed and lower-cased only — **no** Gmail dot/`+tag` rewriting (that would merge different people). Names: accents, punctuation, honorifics (Mr, Ms, Dr, Shri, Smt, Kumari…) and the seed marker "(fictional)" are removed. Name similarity is token-level: each token of the shorter name is paired (greedy, best Jaro-Winkler first) with an unused token of the longer name; score = sum ÷ token count of the longer name. Word order does not matter; a typo scores high; a shared surname alone (siblings) scores low.
6. **Steps.** trim → empty? `missing` → strip separators → character check → `00`→`+` → country branch → length/first-digit checks → E.164.
7. **Edge cases.** `0000000000` is read as an international `00` prefix and rejected; `98765 43210 ext 12` is rejected (letters); idempotent on its own output. The service reports every invalid field at once (400 with `path`).
8. **Permissions.** Pure; used by `ops:leads:write` routes.
9. **Tests.** `tests/unit/contacts.test.ts` → "normalisePhone (A-01)" (13 normal formats, landline, international, missing, invalid characters, boundary lengths 9/11 digits, leading-zero national number, idempotence), "normaliseEmail", "names (weak signal)" (siblings < 0.88). Integration: `tests/integration/leads.test.ts` "400 with field paths".
10. **Limitations.** No libphonenumber (no new dependencies allowed); numbers from other countries are only length-checked. Indian landline numbers are accepted without checking real STD codes.

## A-02 Duplicate-contact detection — OPS-003
1. **Purpose.** Warn when a new lead is probably an existing person; never merge automatically.
2. **Inputs.** Candidate contact record (normalised) and existing non-merged leads that share any phone/email or have a school (`duplicateCandidates` query, ≤ 2000 rows).
3. **Output.** Ordered `DuplicateMatch[]` `{ leadId, code, level: exact | possible, signals[], nameSimilarity }`.
4. **Preconditions.** Contacts normalised with A-01.
5. **Rules** (first match wins), `compareContacts`:
   1. **exact** — a normalised phone/email is shared and at least one side of it is a STUDENT contact (`student_phone`, `student_email`, `student_contact_is_guardian_contact`);
   2. **exact** — only guardian contacts are shared AND names are similar (≥ 0.88);
   3. **possible** — only guardian contacts are shared (sibling or same child under another name);
   4. **possible** — similar name AND same normalised school;
   5. otherwise none. **A similar name alone is never reported** (weak signal only).
   Order: exact first, then more signals, then lead code. *Deviation (proposal):* the PRD treats "exact match on any phone" as existing contact; a shared **parent** number alone is downgraded to "possible" because siblings share parents.
6. **Steps.** Create: load candidates in the transaction → classify → if any `exact` and the request has no `acknowledgeDuplicates.reason` → 409 `CONFLICT` with `details.duplicates` (nothing written) → else insert the lead and one `ops.duplicate_flags` row per match (exact rows store the acknowledgement). Edit: new matches are flagged, never blocking. Merge (`mergeLeads`) is a separate explicit action by `ops:leads:merge`: enquiries (keep their source, marked `merged_from_lead_id`), contact activity and lead-level follow-ups move to the target; only empty target contact fields are filled; the source's open admissions become `lost` ("Merged duplicate into …"); flags become `merged`; both leads are audited. Refused when the source has an admitted/enrolment case.
7. **Edge cases.** Merged leads are excluded from matching. A record never matches itself. Counsellors (own scope) see matched codes but not names/contacts of leads they cannot open. Dismissing a flag needs a note.
8. **Permissions.** Detection runs for `ops:leads:write`; queue/merge/dismiss need `ops:leads:merge` (operations manager).
9. **Tests.** Unit `contacts.test.ts` "duplicate detection (A-02)" (exact, student↔guardian, possible sibling, guardian+similar name, name+school, name alone ignored, missing data, deterministic order). Integration `leads.test.ts` "exact duplicate … → 409 … acknowledged → 201", "shared guardian phone … POSSIBLE", "preview hides names", "merge review".
10. **Limitations.** Candidate pre-filter loads every lead with a school when the candidate has one (fine for thousands, not millions). Threshold 0.88 is a proposal.

## A-03 Admission pipeline state machine — OPS-005, BR-OPS-1
1. **Purpose.** Enforce the documented student flow lead → counselling → demo → admission → enrolment.
2. **Inputs.** `from`, `to`, context `{ actor, reason, hasSuccessfulContact, demoSkipAllowed, readinessMissing, heldFromStatus, viaEnrolmentHandoff, viaEnrolmentReply }` (`checkTransition` in `domain/pipeline.ts`).
3. **Output.** `{ ok:true, rule }` or `{ ok:false, code: ILLEGAL | REASON_REQUIRED | GUARD_FAILED | WRONG_ACTOR | NO_CHANGE, message, missing? }`.
4. **Preconditions.** Service holds the admission row lock (`SELECT … FOR UPDATE`).
5. **Legal-transition table** (anything else is illegal):

| From | To | Actor | Reason | Guard / meaning |
|---|---|---|---|---|
| new | contacted | user | — | a successful two-way contact is logged (BR-OPS-4) |
| contacted | counselling_scheduled | user | — | appointment booked |
| contacted | counselled | user | required | counselled on the spot (walk-in) |
| counselling_scheduled | counselled | user | — | counselling completed |
| counselling_scheduled | contacted | user | required | appointment cancelled / missed |
| counselled | demo_scheduled | user | — | demo booked (separate demo classes) |
| counselled | admission_pending | user | required | **demo skipped — PROPOSAL**: sources describe the demo step but never say it is mandatory or optional; allowed while setting `pipeline.demo_skip.allowed` (decision state `proposed`); sets `demo_skipped` |
| demo_scheduled | demo_attended | user | — | demo attended |
| demo_scheduled | counselled | user | required | demo cancelled / missed |
| demo_attended | admission_pending | user | — | paperwork starts |
| admission_pending | admitted | user | — | confirmation gate A-04 must be empty |
| admitted | enrolment_requested | user | — | only via the handoff service (A-15), which publishes the event |
| enrolment_requested | enrolled | **system** | — | Academic `confirmed` reply |
| enrolment_requested | admitted | **system** | required | Academic `rejected` reply; re-request = attempt + 1 |
| any of new … admitted | lost | user | required | lost / not interested |
| any of new … admitted | on_hold | user | required | paused; `held_from_status` remembered |
| on_hold | the held status | user | required | resume (only to the remembered status) |
| on_hold | lost | user | required | |
| lost | new | user | required | reopen |

   `enrolled` is terminal; `enrolment_requested` cannot be lost or held (the request is in flight).
6. **Steps.** `applyTransition`: check → conditional `UPDATE … WHERE status = from` → insert `ops.admission_transitions` (actor, reason, event id) → `recordAudit` (metadata `leadId`) → side effects: **lost** cancels the case's open follow-ups and marks a verified demo fee `retained_non_refundable` (demo terms: non-refundable); **admitted** marks a verified demo fee `adjusted_against_fees`. First `admitted` time is stored once.
7. **Edge cases.** Missing reason → 400; illegal/guard → 409 `INVALID_STATE_TRANSITION` with `details.code`/`missing`; concurrent change → 409 "reload".
8. **Permissions.** `ops:admissions:write` (own scope: counsellor or lead owner). Booking counselling/demos (`ops:leads:write`) drives the same transitions.
9. **Tests.** `tests/unit/pipeline.test.ts` (happy path, table integrity, terminal states, guards, demo skip on/off, actor rules, hold/resume, cannot lose in flight). Integration `admissions.test.ts` "enrolled cannot be set by a person; illegal jumps are 409".
10. **Limitations.** Stage SLAs/timers per stage are not modelled (OD-011). `lost` vs `not_interested` (PRD) are one status with a reason.

## A-04 Admission confirmation gate — OPS-010, BR-OPS-6/7
1. **Purpose.** "Admitted" only when the confirmed-admission definition holds; a demo fee alone never counts.
2. **Inputs.** Checklist rows (`item_key`, `status`, `recorded_by`), latest fee-arrangement approval status, programme chosen, setting `admission.confirmation`.
3. **Output.** Ordered list of gaps (`evaluateAdmissionReadiness`).
4. **Preconditions.** Called inside the transition transaction.
5. **Rules.** Always (BR-OPS-7, approved): `fee_verification_1` and `fee_verification_2` done **by two different users**; core approval `ops.admission.fee_arrangement` = approved (decider holds `ops:admissions:approve`, not the requester). Configurable (BR-OPS-6, proposed, default on): `documents_verified`, `down_payment_verified`. Also `admission_form` and a programme. Fee verifications cannot be "not applicable". Verifier separation is also checked when recording (409). Onboarding items (kit, groups, timetable, school/hostel) never block.
6. **Steps.** Load checks + approval → compute gaps → empty ⇒ transition allowed.
7. **Edge cases.** Pending/rejected/withdrawn approval = not approved. Approval request needs both verifications first.
8. **Permissions.** Record checks: `ops:admissions:write`; decide: `ops:admissions:approve` (director, operations manager).
9. **Tests.** `tests/unit/admission-followups.test.ts` "admission readiness (A-04)"; integration `admissions.test.ts` "confirmation gate", "fee approval … self-approve".
10. **Limitations.** Stores status and references only (OD-013, OD-014). An approval is not voided if a verification is re-recorded afterwards.

## A-05 Follow-up due rules — OPS-007, BR-OPS-9
1. **Purpose.** Every open case has a next action with an owner and a due date.
2. **Inputs.** Trigger (`lead_received`, `counselling_completed`, `demo_attended`), event instant, setting `followups.due_rules` (`firstContactDays` 0, `afterCounsellingDays` 1, `afterDemoDays` 1, `closedWeekdays` [Sunday]) — **proposed**, from legacy OP-007 "next-day feedback, calls within 1–2 days".
3. **Output.** `{ kind, dueDate, title }`.
4. **Preconditions.** Case has an owner (counsellor/lead owner); otherwise no follow-up is created and the lead is flagged `missing next action` / `unassigned`.
5. **Rules.** Base date = Asia/Kolkata date of the event; + offset; a closed weekday moves forward to the next open day (`nextServiceDay`, no loop if all days are closed).
6. **Steps.** Pipeline services call `createRuleFollowUp` in the same transaction.
7. **Edge cases.** An enquiry at 00:10 IST Sunday (Saturday 18:40 UTC) is due Monday.
8. **Permissions.** Runs inside `ops:leads:write` actions.
9. **Tests.** `admission-followups.test.ts` "follow-up due rules (A-05)", "IST calendar helpers"; integration `leads.test.ts` "first-contact follow-up".
10. **Limitations.** Calendar days, not service hours (OD-011); no holiday calendar (OD-018).

## A-06 Overdue computation and reminders — OPS-007, PLT-010
1. **Purpose.** Flag overdue follow-ups correctly in IST and remind owners once a day.
2. **Inputs.** Follow-up `{ status, dueDate, lastReminderOn, ownerUserId }`, `now`.
3. **Output.** `followUpDueState` → `overdue | due_today | upcoming | later | closed` + `daysOverdue`; `selectReminders` → reminder decisions.
4. **Preconditions.** —
5. **Rules.** `today = IST date(now)`. Overdue iff open and `dueDate < today` — i.e. from **00:00 IST on the next day (18:30 UTC on the due date)**, never by UTC midnight. Reminders: open and due today or overdue, and `lastReminderOn ≠ today`; owners without a login are reported as unreachable.
6. **Steps.** Job `follow-up-reminders`: load open follow-ups due ≤ today → select → for each, claim with `UPDATE … SET last_reminder_on = today WHERE last_reminder_on IS DISTINCT FROM today` (atomic) → `notify()` the owner → audit the run.
7. **Edge cases.** Re-running the job the same day sends nothing; done/cancelled are never overdue.
8. **Permissions.** Job: `ops:jobs:run` (operations manager).
9. **Tests.** `admission-followups.test.ts` "overdue computation (A-06)" (**timezone boundary** 18:29:59Z vs 18:30:00Z; UTC-midnight trap), "reminder selection"; integration `dashboard.test.ts` "reminder job … once per day".
10. **Limitations.** No scheduler yet (wave 3); in-app notifications only (email adapter is a mock).

## A-07 Dependency validation (graphs) — OPS-016, OPS-025
1. **Purpose.** Reject dependency cycles for tasks and milestones; reuse for reporting lines.
2. **Inputs.** Edge list `{ from, to }` ("from depends on to"), proposed edge.
3. **Output.** `wouldCreateCycle` → `{ cycle:false }` or `{ cycle:true, path }`; `findCycle`; `findPath` (BFS, shortest, deterministic); `ancestorChain` (loop-safe parent walk).
4. **Preconditions.** Task edges are added under an advisory lock (`pg_advisory_xact_lock`) so two concurrent inserts cannot form a cycle together.
5. **Rules.** Adding `A → B` creates a cycle iff `B` already reaches `A` (or `A = B`). Neighbours are visited in sorted order so the reported path is stable.
6. **Steps.** Load all edges → check → insert or 409 with the path in task codes (`TSK-00003 → TSK-00001 → TSK-00002 → TSK-00003`).
7. **Edge cases.** Self-edges are 400 (and blocked by a CHECK); duplicate edges are ignored.
8. **Permissions.** `ops:tasks:write` (own: owner of the dependent task); milestones `ops:risks:write`.
9. **Tests.** `tests/unit/tasks-escalation.test.ts` "dependency graph (A-07)" (**3-node cycle**, self, 2-node, DAG, shortest path, loop-safe chain); integration `tasks.test.ts` "rejects a dependency cycle", `organisation-planning.test.ts` "milestone dependencies".
10. **Limitations.** Loads the whole edge table per check (fine for thousands of edges).

## A-08 Task status and completion rules — OPS-016, BR-OPS-10/11
1. **Purpose.** Status standard Not started / In progress / Waiting / At risk / Blocked / Completed / Cancelled with evidence-based completion.
2. **Inputs.** `from`, `to`, reason, completion note, evidence link, has owner, open blocker codes, override reason.
3. **Output.** `{ ok, overrideUsed }` or an error code.
4. **Preconditions.** Row lock; blockers loaded from `ops.task_dependencies`.
5. **Rules.** Open ↔ open freely, except **Blocked** and **Cancelled** need a reason. **Completed** needs an owner and a completion note or evidence link, and no open blocker unless an override reason is given (recorded on the task and audited as `task.completed_with_override`). Closed tasks only reopen to In progress with a reason. Closing a task resolves its open escalations. `blocked_since` is set when entering Blocked. Flags: `missing_owner`, `missing_due`, `overdue`, `due_today` (IST).
6. **Steps.** check → update → (close escalations) → audit.
7. **Edge cases.** A DB CHECK also requires `completed_at` and note/evidence for completed rows.
8. **Permissions.** `ops:tasks:write`; own scope = task owner only.
9. **Tests.** `tasks-escalation.test.ts` "task status rules (A-08)"; integration `tasks.test.ts` "cannot complete while a blocker is open…".
10. **Limitations.** No routine templates (OPS-018, Proposed).

## A-09 Assignment and escalation — OPS-017, BR-OPS-10
1. **Purpose.** Overdue or long-blocked tasks reach the right manager automatically, with an audit trail; the owner keeps the task.
2. **Inputs.** Open tasks (`status`, `dueDate`, `blockedSince`, `ownerStaffId`, levels already raised), `now`, setting `tasks.escalation` (**proposed**: L2 at 2, L3 at 5, L4 at 10 days overdue; blocked ≥ 3 days → L2; respond within 1 day), staff reporting lines (`core.staff_members.manager_id`).
3. **Output.** Escalation proposals `{ level, trigger, daysOverdue, thresholdDays, reason, respondBy }` and a recipient resolution.
4. **Preconditions.** Job runs in one transaction; `ops.escalations` is unique per (task, level).
5. **Rules.** `daysOverdue = IST today − due date`. Each level whose threshold is reached and that was not raised before is raised **once**, in order (a task first evaluated 12 days late gets L2, L3 and L4 records). Recipient for level *L* = the (L−1)th manager up the owner's reporting line; if the line is shorter, the top of the chain above the owner; no manager → `no_manager_on_record`; a looping line → `reporting_loop` (never followed); no owner → `no_owner`. Without a recipient the escalation is routed to every `operations_manager` user. The task's `escalation_level` rises; ownership never changes.
6. **Steps.** Load open tasks, staff, existing escalations → `evaluateEscalation` → `resolveEscalationRecipient` → insert (`ON CONFLICT DO NOTHING`) → audit `task.escalated` → notify recipient(s) and owner. Recipients acknowledge, then resolve with a note.
7. **Edge cases.** Boundary: overdue by exactly the threshold escalates; one day less does not. Closed tasks and tasks without due dates never escalate on "overdue".
8. **Permissions.** Job: `ops:jobs:run`. Acknowledge/resolve: the recipient (any `ops:tasks:write`) or an all-scope `ops:tasks:write` holder.
9. **Tests.** `tasks-escalation.test.ts` "escalation rules (A-09)"; integration `tasks.test.ts` "overdue tasks escalate … idempotent … acknowledges", "no owner … routed".
10. **Limitations.** Calendar days, not working days; a level is raised once per task even if the due date later moves and the task becomes overdue again; thresholds await OD-011/OD-027.

## A-10 Reporting lines and responsibility gaps — OPS-014, OPS-015
1. **Purpose.** Keep the reporting graph a tree and show uncovered responsibilities.
2. **Inputs.** Staff id, proposed manager, current manager map; responsibilities with holder/backup/critical/status; staff active map.
3. **Output.** `checkReportingLine` → ok or `{ message, path }`; `responsibilityGaps` → `[{ code, title, critical, gaps[] }]`.
4. **Preconditions.** —
5. **Rules.** A person cannot manage themselves; a new manager whose chain contains the person is a loop (409). Gaps: `no_holder`, `no_backup`, `holder_is_backup`, `holder_inactive`, `backup_inactive`; retired items ignored; critical first, then code. Holder = backup is also rejected on save (400).
6. **Steps.** The service loads the manager map in the transaction and checks before updating `core.staff_members`.
7. **Edge cases.** The legacy role list imports 12 responsibilities with **no** holders (names are blank in the source, OD-009) — they all appear as gaps.
8. **Permissions.** Read `ops:organisation:read`; write `ops:organisation:manage`.
9. **Tests.** `sops-staff-policies.test.ts` "staff rules (A-10)"; integration `organisation-planning.test.ts` "rejects reporting-line loops", "gap report".
10. **Limitations.** No HR data at all (D-015/OD-026): no leave, availability or payroll.

## A-11 SOP lifecycle and approval requirements — OPS-019, PLT-004, PLT-006
1. **Purpose.** Make proposed vs approved SOPs explicit and approve a specific version under separation of duties.
2. **Inputs.** SOP status, current version (status, content, hash at submission, review), owner/reviewer (staff → user), decider.
3. **Output.** `nextSopStatus`, `sopSubmissionProblems`, `sopApprovalProblems`, `sopDecisionState`.
4. **Preconditions.** Row lock on the SOP.
5. **Rules.** Statuses `not_drafted → draft → in_review → approved → retired` (UI label "Proposed — not policy" for everything not approved). Submission needs an owner, a reviewer who is **not** the owner, and content; it stores `sha256(content)` and opens a core approval whose subject is the **version** (policy `ops.sop.approve`, no self-approval). Approval needs: the version in review and unchanged since submission; the **assigned reviewer** recorded "recommend approval"; the approver holds `ops:sops:approve`, is **not the SOP owner** (403) and not the requester (core rule). Reject needs a reason. Changes requested → the requester withdraws → edits → resubmits. Editing an approved SOP creates a new version while the approved one stays in force; approving it supersedes the old one. Versions are never deleted.
6. **Steps.** `sopWorkflow(submit | review | withdraw | approve | reject | retire)`.
7. **Edge cases.** Retired SOPs cannot be edited; an SOP cannot be retired while a version is in review.
8. **Permissions.** Write/submit/withdraw/retire `ops:sops:write` (operations manager); review = the assigned reviewer; approve/reject `ops:sops:approve` (director, operations manager).
9. **Tests.** `sops-staff-policies.test.ts` "SOP approval requirement rules (A-11)"; integration `sops.test.ts` lifecycle, new-draft-keeps-approved, withdraw.
10. **Limitations.** Training acknowledgements (OPS-020) and review-due reminders are Proposed; `effective`/`under_revision` from the PRD are folded into `approved` + a draft version.

## A-12 KPI aggregation — OPS-024
See `docs/KPI_DEFINITIONS.md` for every definition (numerator, denominator, window, source, owner, missing-data behaviour).
1. **Purpose.** Compute the management KPIs without ever showing missing data as 0.
2. **Inputs.** Plain rows (leads with first-admitted time, follow-ups, tasks, risks, staff, open admissions), window (IST Mon–Sun week by default), `asOf`, conversion window days.
3. **Output.** `Metric` objects (`ok | missing`) from `@elevate/shared-contracts`.
4. **Preconditions.** Rows loaded by `loadKpiRows`.
5. **Rules.** A rate with denominator 0 → `missing` with a reason (**never 0 %**). Cohort conversion is `missing` until `cohort end + N days ≤ as-of`; the dashboard picks the latest fully elapsed Mon–Sun cohort (`latestElapsedCohortWeek`). Counts from Ops' own complete tables are `ok` (a real zero is 0). Percentages are rounded to one decimal.
6. **Steps.** Pure functions in `domain/kpis.ts`, combined by `buildDashboard`.
7. **Edge cases.** Merged leads excluded; cancelled tasks/follow-ups excluded; items due today are not judged for compliance until the day ends.
8. **Permissions.** `ops:dashboard:read`.
9. **Tests.** `tests/unit/kpis.test.ts` (normal, IST boundary, **denominator zero → missing**, window not elapsed, boundary N days); integration `dashboard.test.ts`.
10. **Limitations.** K-02/K-03 (SLA, time to first contact), K-07 and K-11–K-19 from the PRD are not built (Proposed). Targets await OD-027.

## A-13 Legacy import — PLT-011, OPS-019, OPS-021
1. **Purpose.** Bring the legacy decision log, work inventory, SOP registers, the online coordinator SOP and the role list into Ops without inventing approvals or names.
2. **Inputs.** `data/legacy/ops/operations-workbook.json`, `sops.json`, `roles.json` (validated with zod — a malformed extract fails loudly).
3. **Output.** Records with namespaced codes and the verbatim legacy status.
4. **Preconditions.** Core departments seeded.
5. **Rules.** Codes `LEGACY-OPSWB-…` (Elevate-Operations.xlsx), `LEGACY-ONLINE-…`, `LEGACY-MKTEASY-…` can never collide with `DEC-0001`, `SOP-0001` or requirement IDs `OPS-001` (DI-21). Decisions keep `Confirmed/Open/Provisional` → `confirmed/open/provisional`; an unknown word throws. Work-inventory status uses the extract's normalised word. SOP registers: operations (25) and online (16) rows → `not_drafted`; marketing summaries MKT-01…09 (v1.0, "Approved by" blank) and the online coordinator SOP (dated 2026-09-18, unsigned) → **`draft`** (OD-028) with version 0.1; blank form lines ("Assigned staff: ____") are not steps and no names are filled. Legacy "Function" words map to provisional department codes (a proposal). Re-import is idempotent and never downgrades work done in Elevate OS.
6. **Steps.** `seed/legacy.ts` → domain mappers → upsert on code.
7. **Edge cases.** `SOP-001` means different things in two registers — both are kept under different namespaces.
8. **Permissions.** Seeds (development only).
9. **Tests.** `tests/unit/legacy.test.ts`; integration `sops.test.ts` "legacy import", `organisation-planning.test.ts` "imports 24 legacy decisions", `seeds.test.ts`.
10. **Limitations.** Online Actions ON-001…010 (tasks) and the online Rules (as policies) are not imported yet.

## A-14 Workload per staff member — OPS-024
1. **Purpose.** Show assigned open items per person as a capacity view.
2. **Inputs.** Active staff; owners of open tasks and open follow-ups; counsellors of open admissions.
3. **Output.** Rows `{ fullName, openTasks, openFollowUps, openAdmissions, totalOpenItems }` + an unassigned count.
4. **Preconditions.** —
5. **Rules.** **Not a quality or performance score; never ranked** — rows are sorted by name (PRD 4.3 excludes rankings and scorecards). Inactive staff omitted; unassigned items counted separately.
6. **Steps.** Count by owner id.
7. **Edge cases.** A person with no items shows zeros (true zeros: complete internal data).
8. **Permissions.** `ops:dashboard:read`.
9. **Tests.** `kpis.test.ts` "workload per staff (not a score)"; `dashboard.test.ts` "workload is alphabetical, not ranked".
10. **Limitations.** Counts are not weighted by effort.

## A-15 Enrolment handoff (outbox producer + reply consumer) — OPS-012, D-011
1. **Purpose.** Exactly-once request to Academic OS and exactly-once application of its reply.
2. **Inputs.** Admitted admission + lead; Academic reply events.
3. **Output.** `ops.admission.enrolment_requested` v1 event; admission `enrolled`, or back to `admitted` with the rejection.
4. **Preconditions.** Admission `admitted`, programme chosen, a counsellor, at least one contact (payload validated with the contract's zod schema before publishing).
5. **Rules.** Producer (`requestEnrolment`), in ONE transaction: lock row → `attempt = enrolment_attempt + 1` → `publishEvent(key = enrolmentKeys.request(admissionId, attempt))` → transition to `enrolment_requested` with `last_request_event_id`, `handoff_status = pending`. A second submit finds the status changed → 409; with an `Idempotency-Key` the stored response is replayed; a failing payload rolls back the status (no event). Consumer `ops.enrolment-replies` (`processEvents`): delivery is unique per (event, consumer), so a reply is processed once; the handler also ignores (and audits) replies whose `requestEventId` is not the admission's latest request, or whose admission is no longer `enrolment_requested`; an unknown admission throws (retried, then `dead` for a human). Confirmed → `enrolled` (+ `enrolment_id`, `student_id`); rejected → `admitted`, `handoff_status = rejected`, reason stored; a re-request uses attempt + 1 (new key). The counsellor is notified. Until a reply arrives the UI says "awaiting Academic OS", never "enrolled".
6. **Steps.** `src/server/enrolment.ts`.
7. **Edge cases.** A stale confirmation for attempt 1 arriving after a re-request is ignored.
8. **Permissions.** Request: `ops:admissions:write`; manual consumer run: `ops:jobs:run`.
9. **Tests.** Integration `admissions.test.ts` "double submit gives one event", "Idempotency-Key retry", "failing payload rolls back", "**processed twice → one transition**", "rejected … attempt 2 … stale replies ignored".
10. **Limitations.** No scheduler: replies are applied when the job runs (wave 3). Fees and payments are not in the contract.

## A-16 Business codes — D-009
1. **Purpose.** Human codes that are never reused.
2. **Inputs.** Kind (`LEAD` 6 digits, `ADM` 6, `TSK` 5, `SOP` 4, `DEC` 4, `RSK` 4, `PRJ` 4, `INC` 5, `RESP` 4).
3. **Output.** The next code.
4. **Preconditions.** Inside the creating transaction.
5. **Rules.** `pg_advisory_xact_lock(hashtext('ops.code.<kind>'))`, then `max(code)` over well-formed codes (zero-padded, so lexicographic = numeric) + 1; the unique index is the final guard; legacy codes do not match the pattern.
6. **Steps.** Lock → max → format.
7. **Edge cases.** Concurrent creators serialise on the lock.
8. **Permissions.** Internal.
9. **Tests.** `sops-staff-policies.test.ts` "registers"; integration tests assert code formats.
10. **Limitations.** Gaps after rolled-back transactions are possible and harmless.
