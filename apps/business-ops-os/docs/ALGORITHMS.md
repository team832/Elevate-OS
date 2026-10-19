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
10. **Limitations.** Acknowledgements and review-due flags are built (A-50, A-51); a review-due reminder job is not; `effective`/`under_revision` from the PRD are folded into `approved` + a draft version.

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

---

## Added on 19 Oct 2026: A-17 … A-56

The five slice notes used their own ids. They are renumbered here to continue the sequence; the old id stays in the table so code comments and tests that quote it can be found.

| Slice note id | Now |
|---|---|
| A-ADM-1 | A-17 |
| A-ADM-2 | A-18 |
| A-ADM-3 | A-19 |
| A-ADM-4 | A-20 |
| A-HR-01 | A-21 |
| A-HR-02 | A-22 |
| A-HR-03 | A-23 |
| A-HR-04 | A-24 |
| A-HR-05 | A-25 |
| A-HR-06 | A-26 |
| A-HR-07 | A-27 |
| A-HR-08 | A-28 |
| HL-A1 | A-29 |
| HL-A2 | A-30 |
| HL-A3 | A-31 |
| HL-A4 | A-32 |
| HL-A5 | A-33 |
| HL-A6 | A-34 |
| HL-A7 | A-35 |
| HL-A8 | A-36 |
| HL-A9 | A-37 |
| HL-A10 | A-38 |
| A-HT-1 | A-39 |
| A-HT-2 | A-40 |
| A-HT-3 | A-41 |
| A-HT-4 | A-42 |
| A-HT-5 | A-43 |
| A-HT-6 | A-44 |
| A-HT-7 | A-45 |
| A-OPS-01 | A-46 |
| A-OPS-02 | A-47 |
| A-OPS-03 | A-48 |
| A-OPS-04 | A-49 |
| A-OPS-05 | A-50 |
| A-OPS-06 | A-51 |
| A-OPS-07 | A-52 |
| A-OPS-08 | A-53 |
| A-OPS-09 | A-54 |
| A-OPS-10 | A-55 |
| A-OPS-11 | A-56 |

Same format and rules as above. Admissions A-17…A-20, HR records A-21…A-28, HR lifecycle A-29…A-38 (note id `HL-A1…10`), HR time A-39…A-45, operations A-46…A-56.

## A-17 Fee record validation and summary — OPS-072
1. **Purpose.** Accept only well-formed manual fee entries and show what they add up to without pretending to be accounting.
2. **Inputs.** New entry `{ kind, direction, amountPaise, paymentDate, dueDate, receiptReference }`, the admission's existing entries, today (IST), setting `fees.recording` (`domain/fees.ts`: `validateFeeRecord`, `summariseFees`, `parseRupeesToPaise`).
3. **Output.** List of `{ path, message }` issues; summary `{ duePaise, creditAdjustmentsPaise, receivedPaise, refundedPaise, netReceivedPaise, verifiedNetReceivedPaise, balancePaise | null, balanceState, counts, disclaimer }`.
4. **Preconditions.** Amount given as integer paise or as rupee text (parsed with a regex into integer paise — no floating point).
5. **Rules.** Amount: safe integer, > 0, ≤ 1,000,000,000 paise (₹1 crore). `direction` iff adjustment. Received/refund need a payment date ≤ today and (setting, default on, proposed) a receipt reference. Due has no payment date. Refund ≤ non-voided received − non-voided refunds. Demo link only on a credit adjustment of a demo of the same admission whose fee is paid/adjusted, ≤ the demo fee, once per demo. Summary ignores voided rows; due = due + debit adjustments; balance = due − credits − (received − refunds), **null when no due entry exists** (missing, not 0); state no_records / no_due_recorded / outstanding / settled / credit_balance.
6. **Steps.** Parse amount → lock admission → load entries → validate → demo checks → next `FEE-` code (advisory lock) → insert → audit `fee_record.created`.
7. **Edge cases.** Rupee text with 3 decimals, negative or letters → 400 on `amountRupees`; both amount fields → 400; voided entries stay visible; verified entries can still be voided (with reason).
8. **Permissions.** `ops:fees:read` (counsellor own via admission counsellor or lead owner; operations manager, director, auditor, finance officer all) · `ops:fees:record` (operations manager, finance officer). Check by a different person only.
9. **Tests.** Unit `admissions-fees.test.ts`; integration `admissions-fees.test.ts`.
10. **Limitations.** Not reconciled with any accounts system; no instalment plans; no fee schedule (setting `fees.schedule` open); the gate's `down_payment_verified` stays a manual check (the fee summary is a hint only).

## A-18 Student directory state and private-field redaction — OPS-073/077
1. **Purpose.** Decide who is a "student" in Ops and what each reader may see.
2. **Inputs.** Admission `status`, `admitted_at`; reader's scope for `ops:student_private:read`; owners (admission counsellor, lead owner).
3. **Output.** `directoryState` ∈ admitted / awaiting_enrolment / enrolled / withdrawn or null; redacted record with `privateFields`.
4. **Preconditions.** None.
5. **Rules.** admitted → admitted; enrolment_requested → awaiting_enrolment; enrolled → enrolled; lost with `admitted_at` → withdrawn; anything else → not a student (404 on the profile). Private fields: studentPhone, studentEmail, guardianName, guardianRelationship, guardianPhone, guardianEmail, city, previousSchool, consent — removed unless the reader holds `ops:student_private:read` with scope all, or own and is an owner. `stripPrivateKeys` removes the same keys deeply from audit payloads in lead history.
6. **Steps.** SQL filter for directory → map rows → redact per record.
7. **Edge cases.** The list never carries private fields, even for privileged readers. Students reached through a merged lead keep their own admission.
8. **Permissions.** `ops:students:read`: counsellor own, operations manager, director, auditor, academic coordinator. `ops:student_private:read`: counsellor own, operations manager only.
9. **Tests.** Unit "student identity and directory"; integration "student directory and profile", "lead contact masking".
10. **Limitations.** Audit rows themselves still contain lead contacts written by the existing lead services (redacted on read in Ops); a platform-level audit viewer would need the same rule.

## A-19 Handoff view and safe retry — OPS-075, IR-OPS-03
1. **Purpose.** Show the true handoff state and allow a new attempt only when Academic cannot enrol twice.
2. **Inputs.** Admission status, `handoff_status`, attempt, Academic delivery of the current request (`core.event_deliveries`, consumer `academic.enrolment-intake`).
3. **Output.** `deriveHandoffView` → not_requested / awaiting_pickup / academic_retrying / failed_needs_action / awaiting_reply / rejected / enrolled / closed; `retryDecision` → allowed kind or reason.
4. **Preconditions.** Requests are published only through `requestEnrolment` / `retryEnrolmentHandoff` (outbox, same transaction).
5. **Rules.** See `docs/WORKFLOWS.md` (handoff attempts). Every request is keyed `admission:<id>:attempt:<n>`; the admission id is the business identity across attempts. A dead delivery means each try rolled back and `processEvents` never reselects it. Replies apply only when `request_event_id` equals the admission's `last_request_event_id`.
6. **Steps (retry).** Check permission + reason → lock admission → read delivery → decide → build payload (incl. `existingStudentId`) → publish attempt + 1 → conditional update (`status = enrolment_requested AND attempt = n`) → old attempt `superseded` with note → insert attempt row → audit `enrolment.handoff_retried`.
7. **Edge cases.** Double click → second call sees `failed/none` delivery for the new attempt → 409. Someone re-driving the dead event inside Academic would create a second enrolment; Ops flags the late confirmation (notification + note) but cannot prevent it — IR-OPS-ADM-2.
8. **Permissions.** `ops:admissions:write` (own).
9. **Tests.** `admissions-students.test.ts` "handoff retry …"; `apps/platform/tests/integration/enrolment-handoff.test.ts`.
10. **Limitations.** No scheduler (IR-OPS-02); Ops cannot reset another consumer's delivery.

## A-20 Admissions KPIs — OPS-078
1. **Purpose.** Period and point-in-time admissions figures with stated definitions.
2. **Inputs.** Enquiries, leads, admissions + latest fee-arrangement approval, counselling sessions, demos, request events + replies + Academic deliveries, follow-ups, `→ lost` transitions; window (default IST Monday–Sunday week), now; setting `kpi.conversion`.
3. **Output.** Metrics (`ok`/`missing`) and tables (by source, by status, closures by reason).
4. **Preconditions.** Own scope filters every row set to the counsellor's leads (owner) and admissions (counsellor or lead owner); follow-ups by owner.
5. **Rules.** See `docs/KPI_DEFINITIONS.md` (K-ADM-01…11). Rates with denominator 0 → `missing`. Conversion reuses `leadToAdmissionConversion` (`domain/kpis.ts`, unchanged).
6. **Steps.** Load rows in parallel → pure functions in `domain/admissions-kpis.ts`.
7. **Edge cases.** IST boundary (18:30 UTC); merged leads excluded from status counts; uncoded closures reported as `not_coded`.
8. **Permissions.** `ops:admissions:read`.
9. **Tests.** Unit "admissions KPIs"; integration `admissions-report.test.ts`.
10. **Limitations.** Loads all request events (fine at current volume); no targets (OD-027).

## A-21 Field tiers and projection — OPS-037
1. **Purpose.** Return only the employee fields the caller may see.
2. **Inputs.** Row, `{isSelf, canManage, lifecycleCovers, privateCovers}` (`server/hr/access.ts → employeeVisibility`).
3. **Output.** `EmployeeView`: directory fields always; `record` object or null; `legalName` key present only for the private tier (`domain/hr/employees.ts → employeeFieldTiers, projectEmployee`).
4. **Preconditions.** `ops:employees:read` held and HR scope covers the row.
5. **Rules.** record = self ∨ manage-scope covers ∨ lifecycle-read scope covers. private = private-read scope (self only when `own`) covers. Projection builds a new object and never copies a hidden field.
6. **Steps.** hrScope → visibility → per-row tiers → project.
7. **Edge cases.** A separated employee is 404 for directory-tier callers. List filters and sorts on record fields → 403 unless every listable row is record-visible.
8. **Permissions.** As in `docs/PERMISSIONS.md` (tiers).
9. **Tests.** Unit "field tiers and projection"; integration "field-level protection …".
10. **Limitations.** Uses `ops:lifecycle:read` as the signal for "may see employment facts"; a dedicated permission is requested (IR-OPS-11).

## A-22 Employment-status transitions — OPS-033
1. **Purpose.** Keep the employment status meaningful and auditable.
2. **Inputs.** from, to, reason, end date (`checkEmploymentStatusChange`).
3. **Output.** ok, or `NO_CHANGE | ILLEGAL | REASON_REQUIRED | END_DATE_REQUIRED`.
4. **Preconditions.** Employee record row locked.
5. **Rules.** onboarding → active | separated; active → on_notice | separated; on_notice → active | separated; separated is final (a re-hire is a new record). Reason always required; separation needs an end date. Nobody changes their own status.
6. **Steps.** check → update record (end date on separation; cleared when notice is withdrawn) → history row → audit `employee.status_changed` → on separation `runDeactivationHook`.
7. **Edge cases.** ILLEGAL/NO_CHANGE → 409; missing reason or date → 400.
8. **Permissions.** `ops:employees:manage`; the lifecycle slice calls `changeEmploymentStatus` after its own approval.
9. **Tests.** Unit "employment status transitions"; integration "validates employment-status transitions".
10. **Limitations.** Notice period and last-day rules are not modelled (owner policy).

## A-23 Employment history diff — OPS-033
1. **Purpose.** One history row per tracked field that actually changed.
2. **Inputs.** `before` (null for a new employee) and a partial `after` (`historyChanges`).
3. **Output.** `[{field, fromValue, toValue}]` in fixed field order.
4. **Preconditions.** None (pure).
5. **Rules.** Absent keys are unchanged; null counts as a value; on creation only non-null values are written.
6. **Steps.** Compare each tracked key → emit → `writeHistory` inserts with effective date, reason and actor.
7. **Edge cases.** Setting the same value writes nothing.
8. **Permissions.** Called by services that already checked permission.
9. **Tests.** Unit "employment history diff"; integration "writes a history row for every tracked change …".
10. **Limitations.** Department and manager names are resolved at read time (today's names).

## A-24 Department-head succession — OPS-032
1. **Purpose.** One current head per department, with history.
2. **Inputs.** Current tenure, new `{staffId, startsOn}` (`planHeadSuccession`).
3. **Output.** ok + `endCurrentOn` (start − 1 day), or a message.
4. **Preconditions.** Department row locked; the new head is active staff; the department is not archived.
5. **Rules.** The same person → refused. The new start must be after the current head's start.
6. **Steps.** plan → close the current tenure → insert the new one → audit.
7. **Edge cases.** Ending a tenure before its start → 400.
8. **Permissions.** `ops:organisation:manage`.
9. **Tests.** Unit "org tree and head succession"; integration "keeps department-head history".
10. **Limitations.** Acting or co-heads are not modelled.

## A-25 Document status and deletion — OPS-035
1. **Purpose.** Keep document records honest and deletions deliberate.
2. **Inputs.** status, action, actor, requester, reason (`checkDocumentAction`).
3. **Output.** New status, or `ILLEGAL | SELF_DECISION | REASON_REQUIRED`.
4. **Preconditions.** Row locked; manage scope; identity kinds need private manage.
5. **Rules.** hold: active/superseded → retention_hold (reason). release_hold → active. request_deletion: active/superseded → deletion_requested (reason; blocked by a hold). approve: → deleted, by a different user, `confirm:true`, not the subject. reject → active (reason).
6. **Steps.** check → update → audit `employee_document.<action>` → notify the other HR managers on request.
7. **Edge cases.** A deleted record keeps its title and metadata; downloads answer 409.
8. **Permissions.** `ops:employee_documents:manage`.
9. **Tests.** Unit "document actions"; integration "deletion: requested by one person …".
10. **Limitations.** No automatic expiry or retention processing (setting open).

## A-26 Compensation approval and effective dating — OPS-036
1. **Purpose.** Exactly one set of terms in effect on any date, approved by a second person.
2. **Inputs.** Draft, the employee's other records, approver `{userId, staffId}` (`planCompensationApproval`).
3. **Output.** ok + the record to supersede and its end date, or `ILLEGAL | SELF_APPROVAL | CONFLICT`.
4. **Preconditions.** All the employee's records locked `FOR UPDATE`.
5. **Rules.** Only drafts. Approver ≠ drafter and ≠ subject. No approved or superseded record may start on or after the draft's date. The current approved record gets `effective_to = start − 1` and status `superseded`. Unique index: one `approved` per employee.
6. **Steps.** plan → supersede → approve → audit (no amounts) → notify the drafter.
7. **Edge cases.** An earlier-dated correction → cancel and re-draft (the 409 explains). Overlaps are reported, never silently resolved (`effectiveRecordAt.conflict`).
8. **Permissions.** `ops:compensation:manage` to draft; `ops:compensation:approve` to approve.
9. **Tests.** Unit "compensation"; integration "approval by a different person …", "cannot approve their own pay".
10. **Limitations.** No pay-revision workflow beyond draft/approve; no arrears or proration (payroll is out of scope).

## A-27 Compensation validation and export — OPS-036
1. **Purpose.** Record only earnings and allowances, and hand them over exactly.
2. **Inputs.** basis, amount (paise or rupee string), components, effective date.
3. **Output.** Validation issues; CSV rows of the terms in effect on `asOf`.
4. **Preconditions.** Export permission.
5. **Rules.** Integers ≥ 0, ≤ ₹10 crore. Component kinds are earning or allowance only. Labels naming deductions or statutory items (tax, TDS, PF, EPF, ESI, LWF, professional tax, payslip, net pay) are refused. Labels are unique. Listed components must add up to the amount. Rupee strings are converted exactly. CSV cells are quoted and `=`, `+`, `-`, `@` prefixes neutralised.
6. **Steps.** Load approved and superseded records → effective per employee → refuse on overlap → CSV → audit `compensation.exported` (reference, as-of date, row count).
7. **Edge cases.** Employees with no terms on the date are omitted (not zero rows).
8. **Permissions.** `ops:compensation:export` (finance officer).
9. **Tests.** Unit "formats paise exactly and neutralises CSV formulas"; integration "export …".
10. **Limitations.** File download only; no push to a payroll provider.

## A-28 Asset assignment and return — OPS-038
1. **Purpose.** Know who holds each asset.
2. **Inputs.** Asset status, open assignment, employee status, dates (`checkAssignment`, `statusAfterReturn`, `checkAssetStatusChange`).
3. **Output.** ok or message; status after return.
4. **Preconditions.** Asset row locked.
5. **Rules.** Assign only `available` assets with no open assignment, to employees with a record who are not separated or inactive; due date not before the hand-over. Return: good/worn → available, damaged → in_repair, lost → lost. Manual changes: available ↔ in_repair, → retired, → lost, lost → available (found). An assigned asset changes only by return.
6. **Steps.** check → insert assignment → set status → audit → notify the holder. Return: close the assignment → set status → audit.
7. **Edge cases.** The unique index refuses a second open assignment under a race.
8. **Permissions.** `ops:assets:manage` (all). Read: `ops:assets:read` with HR scope (employees see their own assets, department managers their chain).
9. **Tests.** Unit "assets"; integration "assets".
10. **Limitations.** No depreciation, purchase or warranty data.

## A-29 Transition edge tables (requisition, application, offer) — OPS-040, 042, 044
1. **Purpose.** Make every status change an explicit legal edge that names the authority it needs.
2. **Inputs.** from, to, `{canDecide, reason, viaConversion, actorIsRequester, actorIsPreparer}` (`checkEdge`, `domain/hr/recruitment.ts`).
3. **Output.** ok + the edge, or a code: `NO_CHANGE` / `ILLEGAL` (409), `REASON_REQUIRED` (400), `NOT_AUTHORISED` / `SELF_APPROVAL` (403).
4. **Preconditions.** Row locked. For `manage` edges the service has already checked that the caller's scope covers the record.
5. **Rules.** One generic table serves the three entities; each edge needs `manage`, `decide` or `conversion` (only the conversion service). Edges are drawn in `docs/WORKFLOWS.md`. An application becomes `hired` only through conversion. The requester cannot open a requisition and the preparer cannot approve an offer.
6. **Steps.** Same state → table lookup → authority → reason → self-approval check.
7. **Edge cases.** Selection (`interview → offer`) is a `decide` edge; an offer cannot be approved by its preparer.
8. **Permissions.** `ops:recruitment:manage` or `ops:recruitment:decide` per edge.
9. **Tests.** Unit `hr-lifecycle-domain.test.ts` ("requisition …", "application …", "offer …"); integration `hr-lifecycle-recruitment.test.ts` ("allows the table and refuses everything else", "opening needs a decider who is not the requester", "an offer is never approved by the person who prepared it").
10. **Limitations.** The tables are our proposal; who selects and who approves offers is owner decision OD-041.

## A-30 Candidate to employee conversion — OPS-045
1. **Purpose.** Turn an accepted offer into an employee and an onboarding case exactly once.
2. **Inputs.** Application id; optional manager, work email, work location.
3. **Output.** `{created, staffId, employeeCode, onboardingCaseId}`; 201 the first time, 200 `{created: false}` afterwards.
4. **Preconditions.** Application in stage `offer`, an `accepted` offer, an `active` candidate.
5. **Rules.** One transaction: lock the application `FOR UPDATE`; if it already has an employee, return it; `insertEmployee` (status onboarding, start = proposed start date, title = offered designation, department and type from the requisition, manager = input or hiring manager); stage → `hired` with the employee link; open the onboarding case; requisition → `filled` when hires reach openings.
6. **Steps.** As in rule 5; audit `candidate.converted`.
7. **Edge cases.** Work-email clash → 409. Two simultaneous calls → one employee (row lock plus unique `employee_staff_id`).
8. **Permissions.** `ops:recruitment:decide`.
9. **Tests.** `hr-lifecycle-recruitment.test.ts` "conversion is idempotent: two calls → one employee, one onboarding case"; journey test.
10. **Limitations.** Offers carry no salary; compensation is a separate approved record (HR records, A-26).

## A-31 Interview feedback rule — OPS-043
1. **Purpose.** Only the people who interview give feedback, and notes stay with those who need them.
2. **Inputs.** Interview, panel, caller, application status (`domain/hr/recruitment.ts`).
3. **Output.** Allowed or refused; visibility of notes.
4. **Preconditions.** The caller is a panelist of the interview.
5. **Rules.** Only an assigned panelist may submit (scope is irrelevant); interview `scheduled` or `completed`; application open. Notes are visible to recruitment managers who cover the application and to the author; recommendations to every reader of the application. Interviewers see only the applications they sit on.
6. **Steps.** Check panel membership → check states → store recommendation and notes with `submitted_by/at`.
7. **Edge cases.** Auditor and director see recommendations, not notes. A department manager cannot interview until granted `own(ops:recruitment:read)`.
8. **Permissions.** `ops:recruitment:read` plus panel membership.
9. **Tests.** Unit "interview feedback rule"; integration "interviewers see only what they interview for…", "feedback notes are masked for auditor and director…".
10. **Limitations.** One recommendation per panelist; feedback is not hidden until all have submitted (OD-041).

## A-32 Unsuccessful-candidate anonymisation — OPS-049
1. **Purpose.** Remove personal data of candidates who did not join, without losing the process record.
2. **Inputs.** Candidate, applications, offers, setting `hr.candidate_retention`.
3. **Output.** The candidate row anonymised in place, or a refusal; a "retention due" flag.
4. **Preconditions.** At least one application, all rejected or withdrawn, no live offer, not hired.
5. **Rules.** Removes name (becomes "Anonymised candidate (CAND-x)"), email, phone, source detail, consent note, interview notes and offer notes/reference. Keeps stage history and recommendations. The `due` flag appears only when the open setting `hr.candidate_retention` gets a value; nothing is removed automatically.
6. **Steps.** Check eligibility → require `{confirm: true}` → blank the fields in one transaction → audit.
7. **Edge cases.** A candidate with a live application is refused (409).
8. **Permissions.** `ops:recruitment:decide`.
9. **Tests.** `hr-lifecycle-recruitment.test.ts` "unsuccessful-candidate anonymisation".
10. **Limitations.** Retention period is open (OD-036); no automatic run.

## A-33 Onboarding checklist generation — OPS-046
1. **Purpose.** Give every new employee the same checklist, dated from their start.
2. **Inputs.** Setting `hr.onboarding_template`, employee start date, case date, opener, manager.
3. **Output.** Items with assignee, due date and required flag.
4. **Preconditions.** An onboarding case is opened (by conversion or by HR).
5. **Rules.** Due = base + offset, where base is the employment start date, else the case date. The assignee is HR (the case opener), the manager or the employee. The template is `proposed` (6 items).
6. **Steps.** Read the setting → compute dates → insert items keyed `template:<k>`.
7. **Edge cases.** Items are unique per case by item key, so a refresh never duplicates.
8. **Permissions.** `ops:lifecycle:manage`.
9. **Tests.** `hr-lifecycle-cases.test.ts` "gates completion on required items…".
10. **Limitations.** Template approval is owner decision OD-045.

## A-34 Offboarding checklist generation — OPS-047
1. **Purpose.** Make sure nothing is left with a person who is leaving.
2. **Inputs.** Employee, open asset assignments, owned tasks, leads with an open admission, open admissions, active responsibilities, setting `hr.offboarding_checklist`, last working day (LWD).
3. **Output.** Items by kind: asset return, ownership transfer, access revocation, final settlement, exit interview.
4. **Preconditions.** An offboarding case with a last working day not before the employment start date.
5. **Rules.** One asset return per open assignment (due LWD, completed from the asset register); one hand-over per owned record (due LWD minus N days, setting); access revocation (due LWD + 1, system); final settlement (required per setting); exit interview (optional). `refresh` adds new items idempotently by item key.
6. **Steps.** Collect records → build items → insert the missing ones.
7. **Edge cases.** An LWD before the start date → 400.
8. **Permissions.** `ops:lifecycle:manage`.
9. **Tests.** `hr-lifecycle-cases.test.ts` "generates asset returns and ownership transfers…", "refuses a last working day before the employment start date".
10. **Limitations.** Notice period is not modelled (OD-045).

## A-35 Checklist item rules — OPS-046, 047
1. **Purpose.** Stop items being ticked without the thing having happened.
2. **Inputs.** Item kind, requested status, note, evidence.
3. **Output.** Allowed or refused (400/409).
4. **Preconditions.** Case live.
5. **Rules.** `asset_return` and `access_revocation` are never marked done by hand; `ownership_transfer` is done only through the transfer action (which reassigns the record); `not_applicable` and `blocked` need a note; final settlement needs evidence.
6. **Steps.** Check kind → check status → store with `completed_by/at`.
7. **Edge cases.** A returned asset completes its item from the asset register.
8. **Permissions.** `ops:lifecycle:manage` (all scope).
9. **Tests.** `hr-lifecycle-cases.test.ts` (item cases).
10. **Limitations.** Evidence is a text reference, not a file.

## A-36 Completion gating and separation — OPS-046, 048
1. **Purpose.** Approve only when required work is done, and apply a separation exactly once on the right day.
2. **Inputs.** Case, items, approver, IST today, last working day.
3. **Output.** Approval; employment `separated`; staff `inactive`; one `ops.employee.separated` v1 event; case `completed`.
4. **Preconditions.** Approver is not the employee; `{confirm: true}`.
5. **Rules.** Gaps = required items still unresolved (offboarding excludes access revocation). Onboarding approval → employee `active` with an employment-history row. Offboarding approval → employee `on_notice`. A separation is due when IST today is after the last working day; `runSeparations` then applies it. Retraction before that returns the employee to `active`.
6. **Steps.** `applySeparation`: employment status → separated, staff → inactive, `publishSeparation` in the same transaction, case completed. With no login the access item is done at once.
7. **Edge cases.** Running the job twice publishes once. Self-approval → 403.
8. **Permissions.** `ops:lifecycle:approve`; retraction also needs it.
9. **Tests.** `hr-lifecycle-cases.test.ts` ("approval puts the employee on notice; separation publishes one event and history survives", "an employee without a login…", "an approved separation can be retracted…"); `hr-lifecycle-employee-journey.test.ts`.
10. **Limitations.** No scheduler; jobs run from the screens or the jobs route.

## A-37 Access revocation sync — OPS-048
1. **Purpose.** Show the true state of the login shutdown on the offboarding case.
2. **Inputs.** Delivery of the separation event for consumer `platform.access-revocation`; platform audit `user.access_revoked`.
3. **Output.** Access item `done` with evidence, or `blocked` with the error.
4. **Preconditions.** Separation event published.
5. **Rules.** A processed delivery plus the audit row (`metadata.eventId`, `sessionsDeleted`) completes the item; a dead delivery blocks it. The platform consumer disables the login and deletes sessions once per event.
6. **Steps.** `processAccessRevocations` reads delivery and audit → updates the item.
7. **Edge cases.** A rerun changes nothing.
8. **Permissions.** Runs with the lifecycle jobs (`ops:lifecycle:approve`).
9. **Tests.** Platform `access-revocation.test.ts` (3 cases); `hr-lifecycle-cases.test.ts`.
10. **Limitations.** No platform job route calls `processAccessRevocations` yet.

## A-38 Lifecycle reminders — OPS-046
1. **Purpose.** Remind assignees once per day about overdue checklist items.
2. **Inputs.** Items, IST today, case status.
3. **Output.** Notifications and a stamp on the item.
4. **Preconditions.** Item unresolved, due date before today, case live.
5. **Rules.** One notification per item per IST day to the assignee, or to the HR managers when the item has none; `last_reminded_on` is stamped with today.
6. **Steps.** Select → notify → stamp, in one transaction.
7. **Edge cases.** A second run on the same day sends nothing.
8. **Permissions.** `ops:lifecycle:approve` (job).
9. **Tests.** `hr-lifecycle-cases.test.ts` "overdue items get one reminder per IST day".
10. **Limitations.** No scheduler.

## A-39 Attendance calculations
1. **Purpose.** Hours worked and the work date of a session. 2. **Inputs.** clock-in/out instants (UTC), break minutes, employee timezone. 3. **Output.** `workedMinutes` (null while open), `workDate`. 4. **Preconditions.** clock-out > clock-in. 5. **Rules.** worked = elapsed − unpaid break, never < 0; work date = calendar day of clock-in in the employee's IANA zone (an overnight session belongs to the day it started); max session length (`attendance.rules.maxSessionHours`, proposed 16) and break < session for manual/CSV/correction input. Timezone conversion uses `Intl` with two offset refinements (`domain/hr/calendar.ts`). 6. **Steps.** convert local inputs → instants → validate → store. 7. **Edge cases.** open session = null (not 0); DST gaps resolve to the earlier offset; break records are summed on clock-out. 8. **Permissions.** record (self), manage (manual). 9. **Tests.** unit "attendance hour calculations", "calendar and timezones". 10. **Limitations.** No sub-minute precision; zones with DST are handled but only IST is in use.

## A-40 Late / early flags and missing clock-out
1. **Purpose.** Flag deviations from the assigned shift. 2. **Inputs.** session, shift window (template + work date + tz), grace minutes. 3. **Output.** `lateMinutes`, `earlyDepartureMinutes` (0 within grace, the full difference beyond it, null = not measured); missing clock-out flag. 4. **Preconditions.** a shift applies on the work date (assignment active, working weekday, not a holiday). 5. **Rules.** late if clock-in − shift start > `lateGraceMinutes`; early if shift end − clock-out > `earlyDepartureGraceMinutes`; missing clock-out when still open after shift end + `missingClockOutGraceMinutes`, or after clock-in + max session length when no shift applies or the clock-in was after the shift ended. 6. **Steps.** late at clock-in; early at clock-out; job `runMissingClockOutCheck(db, now)` claims each session atomically (`missing_clock_out_flagged_at IS NULL`), audits and notifies once. 7. **Edge cases.** no shift → "not measured", never "on time"; flags cleared on clock-out. 8. **Permissions.** job: `ops:jobs:run`. 9. **Tests.** unit "late / early flags with grace", "missing clock-out"; integration "missing clock-out job". 10. **Limitations.** No scheduler (manual button / jobs route).

## A-41 Overlap detection (sessions, assignments, leave)
1. **Purpose.** Refuse double records. 2. **Inputs.** candidate vs existing rows of the same employee. 3. **Output.** conflicts. 4. **Preconditions.** per-employee advisory lock. 5. **Rules.** sessions overlap when intervals intersect (open = until now); one session per work date unless allowed. Assignments overlap on inclusive date ranges; with split shifts allowed they conflict only if the shifts overlap in local time on a shared weekday (week-minute model incl. overnight spill). Leave overlaps per half day with the employee's own pending/approved requests. 6. **Steps.** lock → load → compare → 409 with details. 7. **Edge cases.** cancelled/rejected/withdrawn rows ignored; superseded sessions ignored. 8. **Permissions.** as the write. 9. **Tests.** unit "overlap detection…", "assignment conflicts…", "overnight shift overlaps…", "detects overlap with own pending/approved leave"; integration conflicts. 10. **Limitations.** Leave does not check other people's leave (team availability shows it instead).

## A-42 Working-day counting (leave)
1. **Purpose.** Days a leave request costs. 2. **Inputs.** span with parts, employee assignments, `leave.rules`, holidays for the employee's location. 3. **Output.** days (0.5 steps) + per-date breakdown with exclusions. 4. **Preconditions.** valid parts. 5. **Rules.** a date counts when it is a working weekday of the covering shift (or of the proposed default week Mon–Sat when no shift covers it) and not a holiday (approved, plus proposed if `countProposedHolidays`); start/end parts count 0.5. 6. **Steps.** iterate dates → classify → sum; a total of 0 is refused. 7. **Edge cases.** Sunday-only request → 400; location-specific holidays apply only to matching employees. 8. **Permissions.** request. 9. **Tests.** unit "counts working days…"; integration "counts working days (Sunday and the Sikar holiday excluded, half days)". 10. **Limitations.** Count fixed at request time; later holiday changes do not recount.

## A-43 Balance ledger
1. **Purpose.** Balances without inventing entitlements. 2. **Inputs.** ledger rows per employee + type. 3. **Output.** `not_configured` or `{allocated, adjusted, used, reversed, balance}`. 4. **Preconditions.** none. 5. **Rules.** no allocation row → not configured (never 0); balance = allocation + adjustment − usage + reversal; usage written on approval, reversal on cancellation of approved leave (unique per request → idempotent); allocations/adjustments only by `ops:leave:manage`, never for oneself; accrual/carry-forward/encashment are `open` settings and nothing runs them. 6–7. Requests are not blocked by balance (entitlements open). 8. **Permissions.** read/manage. 9. **Tests.** unit "balance ledger…"; integration balance + cancellation cases. 10. **Limitations.** No leave year boundaries (period label is free text).

## A-44 CSV import
1. **Purpose.** Bulk staff attendance from a file. 2. **Inputs.** CSV text, actor scope, existing sessions, rules. 3. **Output.** per-row results; on commit a batch. 4. **Preconditions.** `ops:attendance:manage`. 5. **Rules.** RFC 4180 parser; columns `employee_code, date, clock_in, clock_out` + optional `break_minutes, timezone, note`; `clock_out` `HH:MM` or `YYYY-MM-DD HH:MM`; ≤ 5000 rows, ≤ 2 MB; every row validated independently; file sha256 unique. 6. **Steps.** hash → already imported? return batch → parse → validate → preview, or (commit) lock → re-check hash → re-validate inside the transaction → insert batch + valid sessions → audit. 7. **Edge cases.** BOM, CRLF, lone CR, blank lines, quoted commas/newlines, malformed quotes (file error with line). 8. **Permissions.** manage + HR scope per row. 9. **Tests.** unit CSV suites; integration "CSV import". 10. **Limitations.** Changing one byte makes a new file (duplicate rows are then row errors).

## A-45 Timesheet summary — OPS-059
1. **Purpose.** Show scheduled against worked time per employee or department without judging anyone.
2. **Inputs.** Shift assignments, holidays, sessions, corrections and approved leave for the period (at most 62 days).
3. **Output.** Per day: scheduled minutes (or "not scheduled" with the reason), worked minutes of closed non-superseded sessions, flags, leave, pending corrections. Per period: totals as measured values.
4. **Preconditions.** The caller holds `ops:hr_reports:read` covering the staff.
5. **Rules.** Scheduled is missing when no day in the period has an assignment; worked is missing when no closed session exists; the "unapproved difference" is shown only when both are known (overtime records are not built).
6. **Steps.** Load rows → classify each day → sum.
7. **Edge cases.** No shift: "not measured", never "on time".
8. **Permissions.** `ops:hr_reports:read`; the CSV needs `ops:hr_reports:export` and is audited as `timesheet.exported`.
9. **Tests.** Unit "timesheet summary"; integration "timesheets, export and metrics" (3 cases).
10. **Limitations.** Computed on read; range at most 62 days.

## A-46 Comment hiding — OPS-060
1. Keep comments append-only while allowing mistakes to be withdrawn. 2. actor, author, manager flag, hidden flag, reason (`checkCommentHide`). 3. ok or `ALREADY_HIDDEN | NOT_ALLOWED | REASON_REQUIRED`. 4. Comment row locked. 5. Only author or all-scope task writer; reason required; once. 6. check → set hidden fields → audit `task.comment_hidden`. 7. Hidden body is withheld from own-scope readers; all-scope readers (manager, director, auditor) still see it. 8. tasks:write. 9. unit "comment hiding"; integration "only the author or a manager hides…". 10. No moderation workflow; text is never deleted.

## A-47 Supervisor review — OPS-062
1. Second pair of eyes on selected completed tasks. 2. Review status, decision, note, decider, submitter, owner/reviewer/accountable logins, manager flag (`checkTaskReviewDecision`). 3. ok or `NOT_PENDING | SELF_REVIEW | OWNER_REVIEW | NOT_REVIEWER | NOTE_REQUIRED`. 4. Task and pending review locked. 5. Decider ≠ submitter; ≠ owner; = named reviewer, else accountable owner, or a manager; return needs a note. 6. completion with a requirement inserts cycle n+1 and notifies the reviewer(s); decision updates the review, a return reopens the task; both audited and the owner notified. 7. Owner cannot reopen while pending; requirement cannot be removed while pending. 8. Requirement: all-scope tasks:write; decision: tasks:write + rule. 9. unit table; integration 2 tests; inbox test. 10. One reviewer per cycle; no multi-step review.

## A-48 Reminders and overdue handling — OPS-063
1. Tell owners before work falls due and when it is late. 2. Task status, due date, now, setting `tasks.reminders {leadDays: 1, notifyBackupWhenOverdue: true}` (proposed, OD-011), reminders already sent (`taskRemindersDue`). 3. `due_soon` / `overdue` kinds to send. 4. Open tasks with a due date. 5. due_soon when 0 ≤ days until due ≤ leadDays (IST); overdue when the due date has passed; each once per task + due date. 6. Job inserts a `task_reminders` row (unique) then notifies owner → else accountable → else operations managers, plus backup for overdue; audits `task.reminder_sent`. 7. Late UTC evening counts as the next IST day (tested); a changed due date is reminded again; tasks without due date are never reminded (they are flagged `missing_due`). 8. Route jobs:run; scheduler calls the function. 9. unit table (10 cases); integration "reminder job…". 10. No scheduler yet; escalations (A-09) remain the follow-up for long overdue work.

## A-49 Activity history — OPS-060
1. One readable history per task. 2. Audit events `entityType = task` (`describeTaskActivity`). 3. `{kind, summary}` per event, newest first. 4. Every task change is audited in its transaction. 5. Reassignment = owner/accountable/backup change; other changed fields listed by label; unknown actions shown verbatim. 6. Load ≤ 300 events + staff names → map. 7. System jobs show "System job". 8. tasks:read with participant scope. 9. unit table; integration "activity history". 10. Comment text is not repeated in the activity line (it is in the comments panel).

## A-50 SOP publication and review due — OPS-064
1. Say truthfully whether an SOP is in force. 2. status, approved version, schedule, archive flag, IST today; review window (`sopPublicationState`, `reviewDueFlag`, `sopScheduleProblems`). 3. publication state; review flag not_set/overdue/due_soon/ok. 4. —. 5. the mapping in `docs/WORKFLOWS.md`; dates only on the approved version in force of a live SOP; review ≥ effective; window = setting `registers.review_due.dueSoonDays` (30, proposed). 6. PUT schedule upserts and audits `sop.schedule_set`. 7. No effective date = "approved — not published"; a new draft keeps the approved version and its dates in force. 8. sops:write to set; sops:read to see. 9. unit tables; integration "SOP effective date…", coordinator test. 10. The register's legacy `next_review_date` is shown when no version date is set.

## A-51 Required acknowledgements — OPS-065
1. Know who has read the procedure in force. 2. Requirements (department / role), audience members, acknowledgements (`inAckAudience`, `acknowledgementStatus`, `acknowledgeProblems`). 3. acknowledged / outstanding / no-login lists; may-acknowledge. 4. Approved version in force. 5. Department audience = active staff of the department; role audience = active users holding the role; a person counts once per version; staff without a login are reported separately, never counted as acknowledged; read-only (auditor-only) principals cannot acknowledge; once per version. 6. Requirement insert notifies the audience; acknowledgement insert audited `sop.acknowledged`. 7. A newly approved version needs new requirements and acknowledgements (version-specific). 8. sops:write to require/withdraw; `ops:sops:acknowledge` + membership to acknowledge; names only for sops:write or dashboard:read. 9. unit tables; integration 2 tests. 10. Acknowledging needs `ops:sops:acknowledge` plus audience membership.

## A-52 Approvals inbox — OPS-068
1. One place for every decision waiting for me. 2. Actor, `APPROVAL_SOURCES` (each `{key, label, permission, list(db, actor)}`). 3. Per source: status ok/unavailable, count (null when unavailable), items with link, readiness and blockers; total (null when every source failed). 4. Session. 5. Sources the actor lacks permission for are omitted; each source applies its record rules (SOP: not requester, not SOP owner; reviews: assigned reviewer; fee arrangements: not requester; task reviews: A-47; policies: not proposer); the inbox drops any item requested by the actor as a second guard; the inbox decides nothing — links go to the record. 6. Run sources in order, catch failures. 7. An SOP waiting for its reviewer is shown "Not yet" with the reason (the approver may still reject). 8. module:access + per-source permission. 9. `operations-approvals.test.ts`. 10. HR sources not registered yet (registration point in `server/approvals.ts`).

## A-53 Incident resolution targets — OPS-068
1. Flag incidents left open too long. 2. Status, severity, occurred/resolved instants, setting `incidents.resolution_sla {low 14, medium 7, high 2}` days (proposed, OD-011) (`incidentSla`). 3. state within/due_today/breached/resolved_within/resolved_late/unrated, target date, days open. 4. —. 5. Target = occurred date (IST) + N; compared on IST dates. 6. Computed on read. 7. Unknown severity → unrated. 8. incidents:read. 9. unit table; integration "incident resolution target flags". 10. Calendar days, not working hours (service hours are OD-011).

## A-54 Blocked projects — OPS-067
1. Surface projects that cannot move. 2. Project status, milestones with dependencies, counts of blocked linked tasks and open linked issues/blockers (`projectBlockReasons`). 3. Reasons (empty = not blocked). 4. Live projects only (planned/active/on_hold). 5. on_hold; missed milestone; planned milestone depending on a missed or overdue planned milestone; blocked tasks; open blockers. 6. Load and evaluate. 7. Completed/cancelled projects are never listed. 8. risks:read. 9. unit table; integration "blocked projects". 10. —

## A-55 Policies & compliance register — OPS-066
1. Let Elevate record its own policies and obligations with provenance and approval. 2. Entry, versions, settings catalogue (`nextPolicyStatus`, `policyProposalProblems`, `policyApprovalProblems`, `isSettingKey`). 3. New status / problems. 4. Entry row locked. 5. Text lives in versions; a draft is edited in place, anything else starts a new version; proposing needs requirement text and an accountable person; linked keys must be existing `SETTING_DEFINITIONS` keys; review ≥ effective; approval through core approvals policy `ops.policy.approve` (no self-approval) supersedes the previous approved version; retired entries are read-only. 6. As for SOPs (same pattern: request/decide/withdraw approval, audit each step). 7. Editing a proposed version → 409 (withdraw first). 8. settings:read / settings:manage (approval: `ops:settings:manage` or `ops:policies:approve`, never the proposer). 9. integration 3 tests; unit tables. 10. **Seeded with nothing**; Elevate OS never supplies or checks policy text; nothing is legal advice.

## A-56 Operations KPIs — OPS-069
1. **Purpose.** Point-in-time figures for the operations dashboard.
2. **Inputs.** Tasks, reviews, SOP and acknowledgement rows, incidents, projects, the approvals inbox, event deliveries; IST today.
3. **Output.** Metrics (`ok`, or `missing` with a reason) and tables by department and owner (`server/reports/operations.ts`).
4. **Preconditions.** The caller holds `ops:dashboard:read`.
5. **Rules.** Definitions are in `docs/KPI_DEFINITIONS.md` (K-OPS-01…14). Counts are real zeros; rates with a zero denominator are `missing`; capacity tables are sorted by name, never ranked; no targets (OD-027).
6. **Steps.** Load in parallel → pure functions in `domain/kpis.ts`.
7. **Edge cases.** A failed approval source marks the inbox total partial; if every source fails the total is `missing`.
8. **Permissions.** `ops:dashboard:read`.
9. **Tests.** Unit "operations KPIs: missing is not zero"; integration "operations report".
10. **Limitations.** Unresolved integration errors read `core.event_deliveries` only.
