# Business Ops OS — algorithms and business rules

Format (BUILD_PLAN): 1 Purpose · 2 Inputs · 3 Output · 4 Preconditions · 5 Rules and constraints · 6 Steps · 7 Errors and edge cases · 8 Permissions · 9 Tests · 10 Known limitations. All dates are Asia/Kolkata calendar days (`YYYY-MM-DD`); instants are UTC. Pure code lives in `src/domain/`; services in `src/server/` only load rows and apply the result inside a transaction.

---

## A-01 Contact normalisation (phones, emails, names) — OPS-003
1. **Purpose.** Store one canonical form per contact so the same number typed differently is recognised.
2. **Inputs.** Raw phone / email / name strings (`normalisePhone`, `normaliseEmail`, `normaliseName`, `nameSimilarity` in `domain/contacts.ts`).
3. **Output.** Phone: `{ ok, e164, kind: india_mobile | india_landline | international }` or `{ ok:false, reason: missing | invalid_characters | invalid_length | invalid_number }`. Email: lower-cased trimmed address or `missing | invalid`. Name: normalised token string and a similarity in [0, 1].
4. **Preconditions.** None (total functions).
5. **Rules.** Separators (space, `-`, `.`, `(`, `)`, `/`) are removed. Only digits and one leading `+` are allowed. `00` → `+`. India is the default country: 10 digits; `0` + 10; `91` + 10; `091` + 10; `+91` + 10; `+91 (0)` + 10 (trunk zero after the country code) all become `+91XXXXXXXXXX`. The national number must not start with 0. First digit 6–9 = mobile, 1–5 = landline (STD code). Other countries need `+`/`00` and 8–15 digits and are kept as given. Emails are trimmed and lower-cased only — **no** Gmail dot/`+tag` rewriting (that would merge different people). Names: accents, punctuation and honorifics (Mr, Ms, Dr, Shri, Smt, Kumari…) are removed. Name similarity is token-level: each token of the shorter name is paired (greedy, best Jaro-Winkler first) with an unused token of the longer name; score = sum ÷ token count of the longer name. Word order does not matter; a typo scores high; a shared surname alone (siblings) scores low.
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
**Changed 21 Oct 2026:** see "A-04 (changed 21 Oct 2026)" below; admission now happens only through A-APP-4.
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

## A-07 Reporting-line walk — OPS-014
1. **Purpose.** Loop-safe walk up a parent chain, used for staff reporting lines (A-10).
2. **Inputs.** A start id and a `parentOf(id)` lookup.
3. **Output.** `ancestorChain` → `{ chain, loop }`.
4. **Preconditions.** —
5. **Rules.** Stops at a missing parent or the first repeated id (reported as `loop`).
6. **Steps.** Walk parents until none or a repeat.
7. **Edge cases.** A pre-existing loop is reported, never followed forever.
8. **Permissions.** Internal.
9. **Tests.** `staff-settings.test.ts` "staff rules (A-10)".
10. **Limitations.** The task and milestone dependency checks that used this file were removed with Operations (owner, 2026-10-20, D-032; git 63da4e4). The unused graph helpers (`findPath`, `findCycle`, `wouldCreateCycle`) were deleted too.

## A-08 Task status and completion rules — OPS-016, BR-OPS-10/11
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-09 Assignment and escalation — OPS-017, BR-OPS-10
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-10 Reporting lines — OPS-014
1. **Purpose.** Keep the reporting graph a tree.
2. **Inputs.** Staff id, proposed manager, current manager map.
3. **Output.** `checkReportingLine` → ok or `{ message, path }`.
4. **Preconditions.** —
5. **Rules.** A person cannot manage themselves; a new manager whose chain contains the person is a loop (409); the manager must be active.
6. **Steps.** The service loads the manager map in the transaction and checks before updating `core.staff_members`.
7. **Edge cases.** A manager whose own chain already loops is rejected with "fix it first".
8. **Permissions.** Read `ops:organisation:read`; write `ops:organisation:manage`.
9. **Tests.** `staff-settings.test.ts` "staff rules (A-10)"; integration `organisation.test.ts` "rejects reporting-line loops".
10. **Limitations.** Responsibilities and their gap report (OPS-015) were removed with Operations (owner, 2026-10-20, D-032). No HR data.

## A-11 SOP lifecycle and approval requirements — OPS-019, PLT-004, PLT-006
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-12 KPI aggregation — OPS-024
See `docs/KPI_DEFINITIONS.md` for every definition (numerator, denominator, window, source, owner, missing-data behaviour).
1. **Purpose.** Compute the management KPIs without ever showing missing data as 0.
2. **Inputs.** Plain rows (leads with first-admitted time, follow-ups, staff, open admissions), window (IST Mon–Sun week by default), `asOf`, conversion window days.
3. **Output.** `Metric` objects (`ok | missing`) from `@elevate/shared-contracts`.
4. **Preconditions.** Rows loaded by `loadKpiRows`.
5. **Rules.** A rate with denominator 0 → `missing` with a reason (**never 0 %**). Cohort conversion is `missing` until `cohort end + N days ≤ as-of`; the dashboard picks the latest fully elapsed Mon–Sun cohort (`latestElapsedCohortWeek`). Counts from Ops' own complete tables are `ok` (a real zero is 0). Percentages are rounded to one decimal.
6. **Steps.** Pure functions in `domain/kpis.ts`, combined by `buildDashboard`. Overdue work (K-10) = open follow-ups whose due date is before today (IST); the task completion rate and unresolved-blocker KPIs were removed with Operations (D-032).
7. **Edge cases.** Merged leads excluded; cancelled follow-ups excluded; items due today are not judged for compliance until the day ends.
8. **Permissions.** `ops:dashboard:read`.
9. **Tests.** `tests/unit/kpis.test.ts` (normal, IST boundary, **denominator zero → missing**, window not elapsed, boundary N days); integration `dashboard.test.ts`.
10. **Limitations.** K-02/K-03 (SLA, time to first contact), K-07 and K-11–K-19 from the PRD are not built (Proposed). Targets await OD-027.

## A-13 Legacy import — PLT-011, OPS-019, OPS-021
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-14 Workload per staff member — OPS-024
1. **Purpose.** Show assigned open items per person as a capacity view.
2. **Inputs.** Active staff; owners of open follow-ups; counsellors of open admissions.
3. **Output.** Rows `{ fullName, openFollowUps, openAdmissions, totalOpenItems }` + an unassigned count.
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
2. **Inputs.** Kind (`LEAD` 6 digits, `ADM` 6, `FEE` 6).
3. **Output.** The next code.
4. **Preconditions.** Inside the creating transaction.
5. **Rules.** `pg_advisory_xact_lock(hashtext('ops.code.<kind>'))`, then `max(code)` over well-formed codes (zero-padded, so lexicographic = numeric) + 1; the unique index is the final guard; legacy codes do not match the pattern.
6. **Steps.** Lock → max → format.
7. **Edge cases.** Concurrent creators serialise on the lock.
8. **Permissions.** Internal.
9. **Tests.** `staff-settings.test.ts` "business codes"; integration tests assert code formats.
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

Same format and rules as above. Admissions A-17…A-20 and the approvals inbox A-52 remain; HR records A-21…A-28, HR lifecycle A-29…A-38, HR time A-39…A-45 and operations A-46…A-51, A-53…A-56 were removed by the owner on 2026-10-20 (D-032; recoverable from git 63da4e4).

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
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-22 Employment-status transitions — OPS-033
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-23 Employment history diff — OPS-033
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-24 Department-head succession — OPS-032
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-25 Document status and deletion — OPS-035
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-26 Compensation approval and effective dating — OPS-036
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-27 Compensation validation and export — OPS-036
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-28 Asset assignment and return — OPS-038
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-29 Transition edge tables (requisition, application, offer) — OPS-040, 042, 044
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-30 Candidate to employee conversion — OPS-045
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-31 Interview feedback rule — OPS-043
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-32 Unsuccessful-candidate anonymisation — OPS-049
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-33 Onboarding checklist generation — OPS-046
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-34 Offboarding checklist generation — OPS-047
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-35 Checklist item rules — OPS-046, 047
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-36 Completion gating and separation — OPS-046, 048
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-37 Access revocation sync — OPS-048
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-38 Lifecycle reminders — OPS-046
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-39 Attendance calculations
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-40 Late / early flags and missing clock-out
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-41 Overlap detection (sessions, assignments, leave)
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-42 Working-day counting (leave)
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-43 Balance ledger
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-44 CSV import
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-45 Timesheet summary — OPS-059
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-46 Comment hiding — OPS-060
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-47 Supervisor review — OPS-062
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-48 Reminders and overdue handling — OPS-063
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-49 Activity history — OPS-060
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-50 SOP publication and review due — OPS-064
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-51 Required acknowledgements — OPS-065
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-52 Approvals inbox — OPS-068
1. One place for every decision waiting for me. 2. Actor, `APPROVAL_SOURCES` (each `{key, label, permission, list(db, actor)}`); today one source, fee arrangements. 3. Per source: status ok/unavailable, count (null when unavailable), items with link; total (null when every source failed). 4. Session. 5. Sources the actor lacks permission for are omitted; fee arrangements: not the requester; the inbox drops any item requested by the actor as a second guard and decides nothing — links go to the admission. 6. Run sources in order, catch failures. 7. A failed source is "unavailable", never 0. 8. module:access + `ops:admissions:approve`. 9. Platform `overview.test.ts` (inbox count and "Admission decisions"). 10. The SOP, SOP-review, task-review, policy and HR sources were removed with HR and Operations (owner, 2026-10-20, D-032; git 63da4e4).

## A-53 Incident resolution targets — OPS-068
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-54 Blocked projects — OPS-067
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-55 Policies & compliance register — OPS-066
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.

## A-56 Operations KPIs — OPS-069
**Removed (owner, 2026-10-20, D-032)** — recoverable from git commit 63da4e4.


---

## Added on 20 Oct 2026: A-57 … A-84 (admissions workspace)

Rules from the owner's admissions brief of 20 Oct 2026. The slice notes (once in `docs/parts/`, now deleted and merged here) used their own ids; code comments and test names still quote them, so the table maps old to new. Requirements: OPS-080 … OPS-121 (`requirements/REQUIREMENTS.md`). Status per D-013; nothing is Deployed.

| Slice id | Now | Rule | Slice id | Now | Rule |
|---|---|---|---|---|---|
| D-1 | A-57 | Demo progress | A-MTG-1 | A-73 | Appointment overlap |
| D-2 | A-58 | Demo view (Current / Upcoming / Previous) | A-MTG-2 | A-74 | Appointment status transitions |
| D-3 | A-59 | Next class | A-MTG-3 | A-75 | Feedback rules (both directions) |
| D-4 | A-60 | Attendance changes | A-FEE-1 | A-76 | Fee plan totals |
| D-5 | A-61 | Reschedule and cancel | A-FEE-2 | A-77 | Instalment allocation |
| D-6 | A-62 | Demo outcome | A-FEE-3 | A-78 | Instalment status |
| D-7 | A-63 | Demo checklist | A-FEE-4 | A-79 | Reconciliation gate |
| D-8 | A-64 | Follow-up urgency, setup gaps, KPI tiles | A-FEE-5 | A-80 | List fee status |
| A-STU-1 | A-65 | Admission number | A-INT-1 | A-81 | Lead handoff intake |
| A-STU-6 | A-66 | Student identity decision | A-REP-1 | A-82 | Admissions funnel |
| (ADM-STU-01) | A-67 | Conversion transaction | A-REP-2 | A-83 | Demo conversion |
| A-STU-2 | A-68 | Student populations | A-REP-3 | A-84 | Student summary |
| (lifecycle edges) | A-69 | Student lifecycle transitions | | | |
| A-STU-3 | A-70 | Results and attendance (comparable averages) | | | |
| A-STU-4 | A-71 | Contact masking and contact search | | | |
| A-STU-5 | A-72 | Student report fields | | | |

The "D-n" ids in the demo slice are not decision-log entries; they were renamed to avoid the clash with `docs/DECISIONS.md`.

## A-57 Demo progress — OPS-081 (changed 21 Oct 2026, D-038)
1. **Purpose.** Show "2 of 3 days attended".
2. **Inputs.** The demo's sessions (`day_number`, attendance, start) and `planned_day_count` copied at booking (`domain/demos.ts` `dayState`, `demoDays`, `demoProgress`).
3. **Output.** `{ attended, planned, daysScheduled, sessionsAttended, liveSessions, label, sessionsLabel }`.
4. **Preconditions.** None.
5. **Rules.** A demo is 3 demo days (`admissions.demo.day_count`, approved); a day holds one or more classes. A day counts as attended when at least one of its classes was `present` or `late`. Day summary, first rule that applies: attended · scheduled (a class still to come or to record) · absent · excused · not recorded · cancelled · no class. Classes attended are shown separately and are never days. A day beyond the plan only through `admissions.demo.extension` (proposed, off). A substitute teacher is flagged.
6. **Steps.** Group classes by day → day state → count attended days.
7. **Edge cases.** Cancelled classes are ignored; a day whose classes were all cancelled is not attended. Existing classes from before `0007`: day N = class N.
8. **Permissions.** Read with `ops:leads:read` (counsellor own).
9. **Tests.** Unit `demos.test.ts` (D-1 day progress); integration `demos.test.ts`.
10. **Limitations.** A missed day redone on a later date stays the same day number (no hidden 4th day).

## A-58 Demo view (Current / Upcoming / Previous) — OPS-083
1. **Purpose.** Put each demo in exactly one tab.
2. **Inputs.** Outcome, sessions, now.
3. **Output.** `current | upcoming | previous`.
4. **Preconditions.** None.
5. **Rules.** Outcome other than `open` → Previous. Otherwise Current from 00:00 IST on the calendar day of the earliest session that is not cancelled; before that day, or with no live session, Upcoming.
6. **Steps.** Compare `istToday(first start)` with `istToday(now)`.
7. **Edge cases.** 23:59:59 IST the day before → Upcoming; 00:00:00 IST → Current (tested at 18:29:59Z and 18:30:00Z). A cancelled first session is ignored. Converted demos stay in Previous with the admission number.
8. **Permissions.** `ops:leads:read` (own scope = demo counsellor, case counsellor or lead owner).
9. **Tests.** Unit "D-2 view at IST calendar boundaries"; integration "list views (GET /demos)".
10. **Limitations.** Classification runs in the service after one SQL query; fine for hundreds of demos, move into SQL if volumes grow.

## A-59 Next class — OPS-083
1. **Purpose.** The "Next class" column and the "attendance to record" hint.
2. **Inputs.** Sessions, now.
3. **Output.** `{ next, awaitingRecord }`.
4. **Preconditions.** None.
5. **Rules.** Next = earliest `scheduled`/`rescheduled` session starting at or after now. Awaiting record = `scheduled`/`rescheduled` sessions that have already started.
6. **Steps.** One pass over the sessions sorted by start.
7. **Edge cases.** No pending session → no next class; the cell says so.
8. **Permissions.** Read.
9. **Tests.** Unit "D-3 next class".
10. **Limitations.** None known.

## A-60 Attendance changes — OPS-081, OPS-082
1. **Purpose.** Legal attendance updates with a history.
2. **Inputs.** Session (attendance, start), new value (`present | absent | not_recorded | scheduled`), reason, now.
3. **Output.** OK with a `correction` flag, or a message (400/409).
4. **Preconditions.** `ops:leads:write`, own scope.
5. **Rules.** Same value refused. A cancelled session must be rescheduled first. `present`, `absent`, `not_recorded` only once the session has started. Changing a recorded value is a correction and needs a reason. Back to `scheduled` only as a correction. `present`/`absent` need `recorded_at` and `recorded_by` (DB CHECK).
6. **Steps.** Lock demo and case → validate → update → one `demo_session_changes` row per changed field (first recording too) → recompute the legacy summary columns → audit `demo_session.attendance`. When an open demo has no pending session and at least one `present`, the case moves `demo_scheduled → demo_attended` and the demo follow-up is created (A-05).
7. **Edge cases.** Corrections stay allowed after the demo is closed; reschedule, cancel and assign do not.
8. **Permissions.** `ops:leads:write` (counsellor own).
9. **Tests.** Unit "D-4 attendance changes"; integration "records, refuses before start, corrections need a reason and keep history".
10. **Limitations.** Teachers cannot record attendance themselves (they hold no demo permission).

## A-61 Reschedule and cancel — OPS-084
1. **Purpose.** Move or cancel one demo class without losing what happened.
2. **Inputs.** Session, new start (and optional end) or cancel, reason.
3. **Output.** Updated session; change rows.
4. **Preconditions.** Demo outcome `open`; `ops:leads:write`.
5. **Rules.** Reason always required. Reschedule sets attendance `rescheduled` and keeps the class length unless an end is given. Cancel sets `cancelled`. An attended session cannot be rescheduled; only `scheduled`/`rescheduled` sessions can be cancelled; a cancelled or absent session can be rescheduled (make-up class). The reason goes to `exception_reason` and the change table.
6. **Steps.** Lock → validate → update → change rows (`schedule`, `attendance`) → audit.
7. **Edge cases.** Closed demo → 409.
8. **Permissions.** `ops:leads:write` (own).
9. **Tests.** Unit "D-5/D-6 session changes and outcome"; integration "reschedule needs a reason and marks the session rescheduled".
10. **Limitations.** The teacher is notified only through the appointment flow, not on a demo-class reschedule.

## A-62 Demo outcome — OPS-086
1. **Purpose.** Close a demo without converting it.
2. **Inputs.** Outcome (`declined | withdrawn | not_converted | cancelled`), reason.
3. **Output.** Closed demo.
4. **Preconditions.** Outcome `open`.
5. **Rules.** Reason required (also DB CHECK `demos_outcome_reason`). `converted` is never accepted here (only A-67 sets it, together with `converted_admission_id`, DB CHECK `demos_converted_link`).
6. **Steps.** Future pending sessions → `cancelled`, past unrecorded ones → `not_recorded` (with change rows) → set outcome, reason, time, actor → if the case is still `demo_scheduled` and the outcome is `cancelled` or `not_converted`, the case returns to `counselled` so a new demo can be booked; declined and withdrawn leave the pipeline to staff (closing a case as lost needs its closure code, A-03) → audit `demo.outcome_set`.
7. **Edge cases.** Second close → 409. One open demo per case (unique partial index).
8. **Permissions.** `ops:leads:write` (own).
9. **Tests.** Integration "outcome needs a reason, cannot be converted by hand, closes pending sessions".
10. **Limitations.** No reopen.

## A-63 Demo checklist — OPS-085
1. **Purpose.** The fee and admission checklist of brief §6.
2. **Inputs.** Append-only `ops.checklist_entries` for the demo; sessions.
3. **Output.** 11 items with status and latest entry; `done of total`.
4. **Preconditions.** None to read; `ops:leads:write` to add an entry.
5. **Rules.** Latest entry per item wins (tie: later row). No entry = pending. `waived` needs a reason (DB CHECK). Three items are derived from sessions and read-only: `sessions_recorded` (every session recorded), `mock_prepared` (furthest mock stage past pending; not applicable when no mock is planned), `mock_result_linked` (a session holds a result reference). Done = anything but pending. A fee discussion is never evidence of payment.
6. **Steps.** Group entries by item → pick latest → merge derived items → count.
7. **Edge cases.** Writing a derived item → 400.
8. **Permissions.** Write `ops:leads:write` (own).
9. **Tests.** Unit "D-7 checklist"; integration "checklist: waiver needs a reason, derived items are read-only, latest entry wins".
10. **Limitations.** Enforcement before conversion is setting `admissions.demo.checklist_required` (`proposed`, off); when on, A-67 refuses conversion with 400.

## A-64 Follow-up urgency, setup gaps and KPI tiles — OPS-083, OPS-087
1. **Purpose.** The Follow-up column, the "Follow-ups due" tile and Upcoming's "Still to arrange".
2. **Inputs.** The case's open follow-ups, sessions, counsellor, the filtered demo rows.
3. **Output.** Urgency per row; list of gaps; five tile counts.
4. **Preconditions.** None.
5. **Rules.** Urgency = the case's earliest open follow-up with the A-06 due state (overdue from 00:00 IST the next day). Gaps: sessions not scheduled vs planned, sessions without a teacher, no counsellor. Tiles use the same filtered rows as the list, ignoring the view and follow-up filters: current, upcoming, follow-ups due (today or overdue), conversions this IST calendar month, admissions pending decision (demo students whose case is `admission_pending`).
6. **Steps.** Computed with the list query.
7. **Edge cases.** No follow-up → "none set".
8. **Permissions.** Read.
9. **Tests.** Unit "summaries" (mock stage, setup gaps, follow-up urgency).
10. **Limitations.** Follow-ups belong to the admission case; there are no demo-level follow-ups.

## A-65 Admission number — OPS-090, OPS-091
**Changed 21 Oct 2026 (D-037, D-040):** numbers are 001, 002 … and are given only in the final confirmation (A-APP-4); a number is never changed; a manual number only for a legacy case without one.
1. **Purpose.** A unique, gap-tolerant admission number per conversion.
2. **Inputs.** Setting `admissions.number.format` (`proposed`; default `{prefix:'', separator:'-', includeYear:false, width:5}`), IST year; for manual numbers the value and a reason (`domain/admission-numbers.ts`).
3. **Output.** A number such as `00001` (or `[prefix][sep][year][sep]seq` once the owner approves a format); a change row.
4. **Preconditions.** Inside the conversion transaction (A-67) or the correction route.
5. **Rules.** Counter row per scope key (`all` or `Y2026`) locked `SELECT … FOR UPDATE`; values already used by a manual number are skipped; then `next+1` is written. Manual: `ops:admission_number:override`, pattern `^[A-Za-z0-9][A-Za-z0-9/-]{0,39}$`, reason of at least 10 characters (DB CHECK on manual change rows). Every number given or changed writes `ops.admission_number_changes` (previous, new, kind, reason, actor, time).
6. **Steps.** Upsert counter → lock → skip used → format → write admission number (unique index) → change row.
7. **Edge cases.** Unique violation → `ConflictError` 409; the whole transaction rolls back, nothing partial is written. Extra programme cases of the same conversion carry no number (the student's number is on the primary case).
8. **Permissions.** `ops:admissions:convert` for automatic numbers; `ops:admission_number:override` (operations manager only) for manual ones.
9. **Tests.** Unit `admission-numbers.test.ts`; integration `conversion.test.ts` → "10 parallel conversions get 10 unique, consecutive numbers", "manual number: permission + reason ≥ 10 + change row; a taken number is 409 with nothing written".
10. **Limitations.** Format not approved by the owner. Gaps appear after a rolled-back conversion only if a manual number filled the slot; the counter itself rolls back with the transaction.

## A-66 Student identity decision — OPS-092, D-033
1. **Purpose.** One `core.students` row per person; never a silent merge.
2. **Inputs.** Identity already linked to the same (or merged) lead; contact candidates (lead student/guardian phones and emails, `ops.guardians`); the person's choice (`existingStudentIdentityId` or `createNewStudent`).
3. **Output.** `link | create | review (candidates) | invalid`.
4. **Preconditions.** Contacts normalised (A-01).
5. **Rules.** Same lead identity → link. Otherwise any contact match → review unless the person picked a candidate or confirmed a new student. No match → create. A case admitted without a conversion gets the lead's identity or a new one (`applyTransition` side effect).
6. **Steps.** Look up same-lead identity → contact candidates → decide.
7. **Edge cases.** A chosen id that is not a candidate → 400. Review → 409 `IDENTITY_REVIEW` with candidate names; nothing written.
8. **Permissions.** Part of `ops:admissions:convert`.
9. **Tests.** Unit `student-lifecycle.test.ts` → "identity decision (never auto-merge)"; integration "a shared contact means review (409 with candidates)…".
10. **Limitations.** The match rule itself is owner decision OD-044 (open); no contact data in core, so matching runs on Ops tables only.

## A-67 Conversion transaction — OPS-089, OPS-093
**Changed 21 Oct 2026:** conversion now creates the APPLICATION (A-APP-1) and reuses the identity made at demo booking; it gives no admission number (D-040), requests no enrolment and creates no fee agreement (`admissionNumber` / `requestEnrolment` in the body → 400). Steps 5 and 10 below describe the 20 Oct version.
1. **Purpose.** Turn a demo into an admission once, keeping the demo history.
2. **Inputs.** Demo, its case, the wizard body (identity verified, guardian confirmation, programme codes, batch or "to be assigned", delivery mode, effective date, fee plan reference, discount request, identity choice, manual number + reason, request enrolment); `Idempotency-Key` header.
3. **Output.** 201 with the admission(s), student identity, number; a replay returns the stored response.
4. **Preconditions.** Demo outcome `open`; case in a convertible status; programme codes form an allowed combination (`isAllowedCombination`, D-034); checklist resolved when `admissions.demo.checklist_required` is on.
5. **Rules.** One transaction: lock demo and case → identity (A-66) → programmes (the second programme of a combination opens its own case for the same student) → advance the case to `admission_pending`, and on to `admitted` if the gate A-04 passes → number (A-65) → demo `converted` with `outcome_at/by` and `converted_admission_id` → optional fee-arrangement approval request (core approvals, no self-approval) → optional enrolment request (A-15, outbox in the same transaction) → audit.
6. **Steps.** As in 5; any failure rolls everything back.
7. **Edge cases.** Already converted → 409 naming the admission; closed demo → 409; identity review → 409; number taken → 409; checklist required and open → 400.
8. **Permissions.** `ops:admissions:convert` (operations manager; counsellor own). GET preview writes nothing.
9. **Tests.** `conversion.test.ts` → "401 signed out, 403 auditor and out-of-scope counsellor, 400 invalid body or combination", "converts once in one transaction…; a retry replays", "a cohort + entrance combination opens a second case for the same student".
10. **Limitations.** One admission number per conversion and each programme case passes the gate itself; whether a combination should share one number and one checklist is an owner question.

## A-68 Student populations — OPS-095
1. **Purpose.** Decide which list a student appears in.
2. **Inputs.** Admission status, `held_from_status`, `admitted_at`.
3. **Output.** `active | on_hold | former | in_admission`.
4. **Preconditions.** Admission has a student identity.
5. **Rules.** Active = `enrolled` (Academic confirmed). On hold = `on_hold` held from `enrolled`. Former = an exit status or `lost` after admission. Anything else is still in admission. Past demos (never converted) are demo records, listed in their own tab, never as former students.
6. **Steps.** SQL filter per view; counts from the same query.
7. **Edge cases.** A student with several cases appears once per view (A-84 for the summary order).
8. **Permissions.** `ops:students:read` (counsellor own).
9. **Tests.** Unit "populations"; integration "active lists enrolled only…".
10. **Limitations.** Active stays empty until Academic confirms enrolments.

## A-69 Student lifecycle transitions — OPS-094
1. **Purpose.** Hold, resume, exit and reactivate with reasons and history.
2. **Inputs.** Action (`hold` with review date, `resume`, `exit` with status, date, feedback, fee reference, `reactivationAllowed`, `reactivate`), reason (3+ characters), actor.
3. **Output.** Updated admission; transition row; exit record when exiting.
4. **Preconditions.** Edges live in `domain/pipeline.ts`, guarded so only the lifecycle service applies them.
5. **Rules.** `enrolled → on_hold`; `on_hold → enrolled` (resume to held status); `enrolled`/`on_hold(enrolled)` → `withdrawn | completed | transferred | other_inactive` (`other_inactive` proposed); `admitted`/`on_hold(admitted)` → `cancelled_before_enrolment`; every exit status → `admitted` (reactivation; enrolment must be requested again). Every move needs a reason and is audited. Reactivation needs `ops:students:reactivate`, an exit record with `reactivation_allowed`, and an approver other than the person who recorded the exit; the record gets `reactivated_by/at` once.
6. **Steps.** Lock → check edge → write status + `hold_review_date` → transition row → exit record → audit.
7. **Edge cases.** Illegal edge → 409; missing reason → 400; reactivation by the recorder → 403. Nothing is ever deleted.
8. **Permissions.** `ops:students:lifecycle` (operations manager; counsellor own); `ops:students:reactivate` (operations manager).
9. **Tests.** Unit "student lifecycle transitions"; integration "hold (reason + review date)…", "exit writes an exit record…; reactivation needs permission, an allowing record and another approver".
10. **Limitations.** Academic is not told about an exit (no event yet); the enrolment in Academic stays as it is.

## A-70 Results and attendance (comparable averages) — OPS-097, OPS-121
1. **Purpose.** Show Academic results without inventing numbers.
2. **Inputs.** Per-student summary from Academic (`academicStudentSummarySchema` in `src/server/students.ts`, contract IR-OPS-STU-1).
3. **Output.** Groups by exam type and maximum with average, coverage ("2 of 3 scored"); attendance present ÷ recorded with as-of time; or a state.
4. **Preconditions.** Contract reachable.
5. **Rules.** Average only within the same exam type and maximum. Unscored rows count in the shown denominator, never as 0. No data → "No results recorded". Academic unreachable → "Source unavailable (checked …)".
6. **Steps.** `fetchInternal` → group → average.
7. **Edge cases.** No scores → null average, not 0.
8. **Permissions.** `ops:students:read`.
9. **Tests.** Unit "comparable averages (missing is never zero)".
10. **Limitations.** Academic does not serve the contract yet, so every profile shows "Source unavailable".

## A-71 Contact masking and contact search — OPS-096, OPS-098
1. **Purpose.** Protect minors' contacts while letting authorised staff find a student by phone.
2. **Inputs.** Search term, reader's permissions.
3. **Output.** Matching students; masked numbers.
4. **Preconditions.** Contacts normalised (A-01).
5. **Rules.** Phones shown masked (`+91 •••• ••12 34`) and only in a contact search. Contact search needs `ops:student_private:read`, matches partial numbers of 4+ digits, and writes an audit row `student.contact_search` with a masked value. Guardian contacts never enter audit rows.
6. **Steps.** Permission check → normalise → match student and guardian contacts → audit.
7. **Edge cases.** Without the permission the `contact` parameter is refused (403).
8. **Permissions.** `ops:student_private:read` (operations manager; counsellor own).
9. **Tests.** Unit "privacy helpers"; integration "search by name and admission number; contact search only with private access, masked and audited", "guardians (restricted)".
10. **Limitations.** Older lead audit rows still hold contacts (redacted on read, A-18).

## A-72 Student report fields — OPS-099
1. **Purpose.** A student report that only contains what the reader may see, with a trail.
2. **Inputs.** Student, period `from ≤ to`, reader's permissions.
3. **Output.** Report and an `SR-XXXXXXXXXX` reference.
4. **Preconditions.** `ops:student_reports:generate`.
5. **Rules.** Groups `overview, programmes, results, attendance, feedback` always; `fees` only with `ops:fees:read`; `guardians` only with private access. Each generation writes `ops.report_exports` (who, when, period, groups) and an audit row. Reopening a reference shows the intersection with the reader's current permissions. The page prints from the browser; nothing is emailed and the page never claims it was.
6. **Steps.** Decide groups → load persisted rows → insert export → audit.
7. **Edge cases.** Missing sections say "unavailable", never zero.
8. **Permissions.** `ops:student_reports:generate` (operations manager; counsellor own).
9. **Tests.** Integration "generation writes an export row + audit with the permitted field groups; reference reopens it".
10. **Limitations.** No PDF library; browser print only.

## A-73 Appointment overlap — OPS-102
1. **Purpose.** No double booking of a teacher or counsellor.
2. **Inputs.** Candidate slot, the staff member's nearby appointments and scheduled demo classes, buffer minutes (setting `appointments.scheduling`, `proposed`) (`domain/appointments.ts` `slotsOverlap`, `findClash`).
3. **Output.** The first clash or none.
4. **Preconditions.** End after start.
5. **Rules.** Half-open intervals `[start, end)`; clash when `a.start < b.end + buffer` and `b.start − buffer < a.end`. Only `proposed | scheduled | confirmed | rescheduled` block. A reschedule ignores itself. A demo session without an end uses the default length.
6. **Steps.** Inside the transaction take a per-staff `pg_advisory_xact_lock`, lock nearby rows `FOR UPDATE`, check, insert.
7. **Edge cases.** Touching edges allowed; a cancelled slot is free again; 409 names the clash with `details[0].path = ['startsAt']`.
8. **Permissions.** `ops:appointments:manage`.
9. **Tests.** Unit "A-MTG-1 appointment overlap"; integration "409 on overlap naming the clash…", "concurrent overlapping bookings: exactly one succeeds".
10. **Limitations.** The demo-class clash path has no automated test.

## A-74 Appointment status transitions — OPS-101
1. **Purpose.** Legal appointment moves with history.
2. **Inputs.** Current status, action (`confirm | reschedule | cancel | complete`), reason, now.
3. **Output.** New status and change rows.
4. **Preconditions.** `ops:appointments:manage` (own scope).
5. **Rules.** proposed → scheduled / confirmed / rescheduled / cancelled; scheduled → confirmed / rescheduled / completed / cancelled; confirmed → rescheduled / completed / cancelled; rescheduled → confirmed / rescheduled / completed / cancelled; completed and cancelled are final. Reschedule and cancel need a reason (cancel also a DB CHECK); an outcome only after the start time. Every change writes `appointment_changes` rows (status, starts_at, ends_at, outcome) with actor and reason. Counselling linked to an admission moves the case (contacted → counselling_scheduled → counselled; last cancelled → contacted).
6. **Steps.** Lock → check → overlap (A-73) on reschedule → update → change rows → notify the teacher in-app → audit.
7. **Edge cases.** Illegal move → 409.
8. **Permissions.** As 4.
9. **Tests.** Unit "A-MTG-2 appointment status transitions"; integration "reschedule keeps history with reason and re-checks overlaps; cancel needs a reason".
10. **Limitations.** No reminder job; email/SMS are simulated.

## A-75 Feedback rules (both directions) — OPS-106, OPS-107
1. **Purpose.** Keep teacher→student and student/guardian→teacher feedback apart.
2. **Inputs.** Author, target, body; moderation action.
3. **Output.** Feedback rows; rating summary.
4. **Preconditions.** The two directions use two tables.
5. **Rules.** Teacher → student: author or `ops:feedback:manage`; a teacher writes only as self and only about students met in an appointment or demo class; a draft is edited in place; editing a final row inserts version n+1 with `supersedes_id` (unique, so no forks); superseded versions are read-only (409). Student/guardian → teacher: recorded by staff (`ops:feedback:record`), no edit path at all; moderation pending → approved | rejected | hidden, approved ↔ hidden, rejected final; the teacher it is about can never moderate it (403), even with the permission. The rating summary averages approved rated rows only and shows the denominator.
6. **Steps.** Check author/scope → insert or version → audit.
7. **Edge cases.** Rating outside 1–5 → 400 (also DB CHECK).
8. **Permissions.** `ops:feedback:read`, `:write` (teacher own), `:manage`, `:record`, `:moderate`.
9. **Tests.** Unit "A-MTG-3 feedback rules"; integration `feedback.test.ts` (all cases).
10. **Limitations.** Since 21 Oct 2026 (D-058) teachers write reviews in Academic OS: the Ops write routes for teacher → student reviews are deleted, `ops:feedback:write` / `:manage` are held by no role, and the old rows are read-only history (final versions, plus drafts only for their author). Ops reads submitted versions from Academic and may acknowledge them (`ops:feedback:acknowledge`). Rating scale 1–5 is a proposal.

## A-76 Fee plan totals — OPS-109, OPS-110
Superseded on 21 Oct 2026 by **A-FEE-1** (annual fee agreements, D-039) in "Added on 21 Oct 2026" below.

## A-77 Instalment allocation (proposed) — OPS-111
Superseded on 21 Oct 2026 by **A-FEE-2** (annual fee agreements, D-039) in "Added on 21 Oct 2026" below.

## A-78 Instalment status — OPS-111
Superseded on 21 Oct 2026 by **A-FEE-3** (annual fee agreements, D-039) in "Added on 21 Oct 2026" below.

## A-79 Reconciliation gate — OPS-112
Superseded on 21 Oct 2026 by **A-FEE-4** (annual fee agreements, D-039) in "Added on 21 Oct 2026" below.

## A-80 List fee status — OPS-113
1. **Purpose.** One fee word per student in lists.
2. **Inputs.** Students' active plans and instalment statuses (`feeStatusForStudents(db, studentIds, now?)`).
3. **Output.** `paid | due | overdue | not_configured`.
4. **Preconditions.** Caller shows it only to holders of `ops:fees:read` (no check inside).
5. **Rules.** No active plan → not configured (a draft is not configured). Any overdue instalment → overdue. All paid → paid. Else due.
6. **Steps.** One query per list.
7. **Edge cases.** Missing plan never shows as paid.
8. **Permissions.** See 4.
9. **Tests.** Unit "student fee status for lists"; integration "feeStatusForStudents: missing plan is not_configured…".
10. **Limitations.** None known.

## A-81 Lead handoff intake — OPS-115
1. **Purpose.** One Ops lead per Marketing lead, attribution kept.
2. **Inputs.** `marketing.lead.handed_off` v1 events (outbox, consumer `ops.lead-intake`).
3. **Output.** Receipt status `received | duplicate_review | accepted | failed`; lead.
4. **Preconditions.** Source code exists in `ops.lead_sources`.
5. **Rules.** Upsert the receipt by `marketing_lead_id` (unique). A later event for a receipt that is not failed only increments `duplicate_deliveries` (audited `lead_handoff.duplicate_ignored`). Otherwise process in a savepoint: map course interest to a programme code (code or name, case-insensitive; else keep the text in the lead notes), `createLead` (normalised contacts, first enquiry with source, channel and campaign ref, admission case, follow-up, audit, duplicate flags), record consent in `ops.contact_preferences`. Any duplicate match → `duplicate_review` (existing queue, never merged), else `accepted`.
6. **Steps.** Per event as in 5; an error rolls back the savepoint only and marks the receipt `failed` with the message and attempt count. Retry by job (fewer than 5 attempts) or by the manager route.
7. **Edge cases.** Unknown source → failed until the source exists; refused consent stores no channels.
8. **Permissions.** `ops:jobs:run` + `ops:lead_handoffs:manage`; list with `ops:leads:read` (attribution only with `ops:lead_attribution:read`).
9. **Tests.** `lead-intake.test.ts` (5 cases).
10. **Limitations.** Marketing does not publish the event yet (mock events only); rows are attributed to the user who ran the job (no system actor, IR-OPS-PLT-1); no scheduler (IR-OPS-PLT-2).

## A-82 Admissions funnel — OPS-118
1. **Purpose.** Lead → demo → enrolment counts with honest denominators.
2. **Inputs.** Leads first received in the period (IST), demos, sessions, admissions.
3. **Output.** Stages with count, denominator and rate.
4. **Preconditions.** Merged leads excluded; own scope for counsellors.
5. **Rules.** Stages, each counted only if its denominator stage was reached: leads → demo booked → attended at least one class → attended every planned class → converted → enrolled (converted admission has `enrolled_at`). Rate = count ÷ denominator, one decimal; denominator 0 → "Not enough data". Admissions without a demo are outside this funnel.
6. **Steps.** Load rows → pure function in `domain/admissions-funnel.ts`.
7. **Edge cases.** A later flag without its earlier stage does not count.
8. **Permissions.** `ops:admissions:read`.
9. **Tests.** Unit "A-REP-1 funnel is nested"; integration `admissions-report-funnel.test.ts`.
10. **Limitations.** No targets (OD-027).

## A-83 Demo conversion — OPS-118
1. **Purpose.** Conversion rate by programme, counsellor and source.
2. **Inputs.** Demos with a class in the period (same rule as the demo list's date filter, so links match).
3. **Output.** Total and groups with rate.
4. **Preconditions.** As A-82.
5. **Rules.** Groups: programme (demo programme, else lead interest), counsellor, first source + campaign (only with `ops:lead_attribution:read`). Rate = converted ÷ demos with an outcome (open demos excluded); 0 decided → "Not enough data". Converted counts link to `/ops/admissions?view=previous&outcome=converted&…`.
6. **Steps.** As A-82.
7. **Edge cases.** No decided demos → no rate.
8. **Permissions.** `ops:admissions:read`; source groups need attribution permission.
9. **Tests.** Unit "A-REP-2 conversion rate = converted ÷ decided"; integration "counts persisted rows with their denominators; source/campaign only with attribution".
10. **Limitations.** None known.

## A-84 Student summary — OPS-118
1. **Purpose.** Active, on hold and former counts.
2. **Inputs.** Admissions with a student identity; A-68 populations.
3. **Output.** `{ active, on_hold, former }`.
4. **Preconditions.** None.
5. **Rules.** Each student once, in the order active > on hold > former; in-admission ignored. Links go to `/ops/students?view=…`.
6. **Steps.** Group by student.
7. **Edge cases.** Students with several cases counted once.
8. **Permissions.** `ops:admissions:read`.
9. **Tests.** Unit "A-REP-3 student summary".
10. **Limitations.** Active is 0 until Academic confirms enrolments.

---

## Added on 21 Oct 2026: applications, annual fees, reports, onboarding, events, exits, tasks, search

Rules from the owner's brief of 21 Oct 2026 (admissions lifecycle) and the owner decisions D-038 … D-049. Code comments quote these ids. Status: Implemented, Tested (tests named per rule); nothing is Deployed. Where a 20 Oct rule above changed, the old entry points here.

## A-04 (changed 21 Oct 2026) Readiness ends with final confirmation
`evaluateAdmissionReadiness` (`domain/admission-readiness.ts`) always ends with the gap `final_confirmation`, so `POST /admissions/{id}/transitions to: admitted` is 409: only A-APP-4 admits. `admission_form` and `down_payment_verified` no longer gate; `admission.confirmation` is now `{ requireDocuments }`. The fee gap `fee_arrangement_approval` ("No active fee agreement approved by an authorised approver") closes only when the admission, or a case of its application, has an ACTIVE agreement activated by its own plan-bound approval (A-FEE-8). Tests: unit `admission-followups.test.ts` (readiness ends with `final_confirmation`); integration `applications.test.ts`.

## A-APP-1 Application status machine — OPS-APP-1, OPS-APP-3
1. **Purpose.** One application per primary admission case; never admits anyone by itself.
2. **Inputs.** Application row, action, version sent by the client (`domain/applications.ts` `applicationActionBlocked`, `statusAfter`).
3. **Output.** Next status or the reason it is blocked.
4. **Preconditions.** Case in `admission_pending` (direct) or created by conversion / readmission.
5. **Rules.** draft → ready_for_review → form_generated → signatures_confirmed → admission_confirmed; withdrawn from any status before confirmation. Any material save makes version N+1, sets status draft and invalidates the live signature confirmation. The reference `APP-nnnnnn` mirrors the case code `ADM-nnnnnn` (no new counter). Every case of an application carries `admissions.application_id` (the primary too).
6. **Steps.** Lock the application → compare `version` → apply → audit.
7. **Edge cases.** A stale version → 409 `STALE_VERSION`; a signature confirmation for a form of another version → 409.
8. **Permissions.** `ops:admissions:write` (own scope); the form also needs `ops:student_private:read`.
9. **Tests.** Unit `applications.test.ts` (status machine); integration `applications.test.ts`.
10. **Limitations.** None known.

## A-APP-2 Application content and hash — OPS-APP-2
1. **Purpose.** Know exactly what was printed, signed and confirmed.
2. **Inputs.** Student KYC (on the lead), guardians (or the lead's guardian), bundle programmes, batch / mode / start, academic year, the ACTIVE fee agreement and its instalments, `fees.registration`, `admissions.declarations`, the paper-form answers.
3. **Output.** Snapshot + SHA-256 of its canonical JSON (keys sorted, `canonicalJson`).
4. **Preconditions.** None.
5. **Rules.** Material content = the snapshot; when the live content differs from the current version the screen says "Details changed since version N" (`changedParts`). The form PDF records version, template and SHA-256, prints "Application — admission pending" and a reference, never a number.
6. **Steps.** Build snapshot → hash → compare.
7. **Edge cases.** Declarations not configured → the block says so and confirmation is blocked.
8. **Permissions.** As A-APP-1; KYC and form answers read only with `ops:student_private:read`.
9. **Tests.** Unit `applications.test.ts` (canonical JSON), `admission-form.test.ts`, `admission-documents.test.ts` (3 A4 pages with long names, ₹, missing values).
10. **Limitations.** Devanagari prints as "?" with a footer note (no complex-script shaping in pdf-lib).

## A-APP-3 Information and confirmation gaps — OPS-APP-4, BR-OPS-6/7
1. **Purpose.** List what still stops "ready" and the final confirmation.
2. **Inputs.** Snapshot, settings (`admissions.kyc.required_fields`, `admissions.kyc.id_document_types`, `admissions.signatures.required_signers`, `admissions.declarations`, `admission.payment_gate`), verified identity documents, the live signature confirmation, ledger.
3. **Output.** `informationGaps` (for ready) and `confirmationGaps` (adds the rest).
4. **Preconditions.** None.
5. **Rules.** Information: required KYC fields (a child's phone/email is satisfied by a guardian's); a guardian when the signer rule needs one or guardian fields are set; a programme; an approved fee agreement (= active plan); a counsellor. Confirmation adds: declarations approved (a proposed or missing text blocks — no self-approval of wording); mandatory ID document types verified; a live signature confirmation of the current version and a form of the same version; required signers by age ON THE SIGNING DAY (no date of birth ⇒ guardian); payment gate `none | registration_fee | first_instalment` over non-voided received minus refunds (`paymentGap`).
6. **Steps.** Pure functions in `domain/applications.ts`.
7. **Edge cases.** 18th birthday on the signing day = adult; a bundle case that is lost or held is never skipped silently (reported).
8. **Permissions.** Read with the application.
9. **Tests.** Unit `applications.test.ts` (gap tables, signers at the 18 boundary, payment gate table).
10. **Limitations.** Approver role holders are Proposed (D-041).

## A-APP-4 Final confirmation transaction — OPS-APP-4, D-040, D-041
1. **Purpose.** The only way a case becomes `admitted`; gives the admission number.
2. **Inputs.** `{ password, applicationVersion }`, the signed-in user (from the session, never the client).
3. **Output.** 201 confirmation (number, approval row, enrolment request) or 200 `replayed: true`.
4. **Preconditions.** Status `signatures_confirmed`, no gaps (A-APP-3).
5. **Rules.** Lock the application row FOR UPDATE → lock the case (scope) → an existing approval for the same version replays it, for another version 409 → status, version and case checks → gaps → `verifyCurrentUserPassword` (always spends scrypt time; a Google-only account gets `no_password`; 5 failures in 15 min lock for 15 min). A failure writes audit `admission.confirm_failed` with the reason only, committed, then 403 / 429. Success: number from the counter FOR UPDATE written to the admission first → `admission_approvals` row (accepted snapshot: application, version, hash, signature, payment gate, paid; method and time of the re-check, never the password) → each bundle case `admitted` + `publishEnrolmentRequest` → application `admission_confirmed` → audit `admission.confirmed`.
6. **Steps.** One transaction.
7. **Edge cases.** Two clicks or a retry → one approval, one number (unique row + replay). The route does NOT use `defineRoute` idempotency: its stored hash would be an unsalted SHA-256 of a body holding the password, and it would roll back the failed-attempt audit.
8. **Permissions.** `ops:admissions:confirm` (director, operations manager: Proposed).
9. **Tests.** Integration `applications.test.ts` (acceptance 6–11, 18, 20, 21: wrong password, lock, replay, concurrent `Promise.all`, gaps); `packages/authentication/tests/reauth.test.ts` (8).
10. **Limitations.** Google-only accounts (all real staff today) cannot confirm until the owner decides on Google re-authentication (D-041). The throttle is per process memory. Legacy admissions (before `0007`) show "Legacy — verification required" and are reconciled with `POST /admissions/{id}/legacy-verification` (note ≥ 10, audited); no approval is invented for them.

## A-FEE-1 … A-FEE-7 Annual fee agreements (replace A-76 … A-79) — D-039
`domain/fee-plans.ts`, ledger helpers in `domain/fees.ts`. Permissions: read `ops:fees:read` (own scope); record `ops:fees:record`. Tests: unit `fee-plans.test.ts`, `fee-agreements.test.ts` (seeded property tests), `admissions-fees.test.ts`; integration `fee-plans.test.ts`, `admissions-fees.test.ts`. Money is integer paise; nothing here is a verified payment.
- **A-FEE-1 `planTotals`.** Totals from effective ledger rows; `outstandingPaise = max(0, balance)`, `creditPaise = max(0, −balance)` (a credit is shown, never absorbed).
- **A-FEE-2 `allocateInstalments(instalments, ledger, today)`.** Payments first, then reductions (discount + waiver + credit − debit). Each fills the instalments its rows name (`instalment_id`) first, then the others oldest due date first (no due date last). Links only set priority; the applied total = min(max(0, net + reductions), scheduled), never more than an instalment's amount.
- **A-FEE-3 `instalmentStatus`.** `paid` | `waived_adjusted` (covered with any reduction) | `overdue` (a real due date before today, money left) | `part_paid` | `unpaid`. No "due soon" state (`fees.allocation.dueWindowDays` unused).
- **A-FEE-4 `reconcilePlan`.** Issues: schedule ≠ tuition, refunds > payments, debits > reductions, foreign kinds or instalments. A credit is not an issue.
- **A-FEE-5 `splitTuition(totalPaise, sharesPercent)`.** 50 / 25 / 25 (`fees.tuition_split`, approved): floor each share, remainder to the LAST. Registration and demo charges are outside the split (`charge_category`).
- **A-FEE-6 `checkFeeStructureChange`.** Only an owner-approved figure can be approved; promoting needs `ops:admissions:approve` and a reason ≥ 10.
- **A-FEE-7 `agreementStatus`, `nextDue`.** Overall state; overdue wins; a debit above the instalments stays owed.
- **Ledger.** `effectiveRecords`: voided rows, reversal rows and the rows they reverse never count. A reversal is a linked row of the same kind, direction and amount with a reason; a refund is a `refund` linked to a `received` row, ≤ that payment less its earlier refunds. A payment with live refunds cannot be reversed or voided. `chargeSummary(records, category)` keeps tuition, registration and demo apart. Registration is charged once per student across admissions (₹5,000, D-044; per-year re-registration is an open owner question). Tuition rows without an agreement are refused while the student has an open one. Tuition is capped at ₹1,00,00,000.
- **Versions.** One agreement per student and academic year (the bundle is charged once; the student row is locked FOR UPDATE). Adjust = close vN ("Replaced by version N+1: reason") + insert vN+1 (`supersedes_plan_id`, `adjustment_reason`); the ledger of a version is the rows of its whole chain; an old instalment link maps to the same instalment number. A new agreement after a closed one continues the chain. Closing or adjusting an ACTIVE agreement needs `ops:admissions:approve`.
- **Demo credit.** `fees.demo_credit` is on, but nothing is credited automatically at confirmation: a credit is a manual `adjustment` credit with `demoId`, at most the demo fee paid (net), once.

## A-FEE-8 Approval bound to one agreement version — BR-OPS-7
1. **Purpose.** An approval can activate only the exact terms it approved.
2. **Inputs.** The draft `fee_plans` row, core approvals with policy `ops.fee_agreement.version` (`server/approval-policies.ts`; subject type `fee_plan`, subject id = `fee_plans.id`).
3. **Output.** `canActivate` per agreement; activation or 409.
4. **Preconditions.** Both fee verifications recorded by two different people before the request (`POST /fee-plans/{id}/approval-request`).
5. **Rules.** One pending request per version; the requester and the version's maker can never decide it (`POST /fee-plans/{id}/decision` approves or rejects only). Finance (`ops:fees:record`) then activates with the version's OWN latest approval, approved by someone other than the maker. Admission-level `ops.admission.fee_arrangement` approvals stay readable and activate nothing (the earlier fallback was removed). The Approvals inbox lists these requests (source `ops.fee_agreements`) with "Tuition ₹before → ₹after (change)" only for `ops:fees:read` holders.
6. **Steps.** Request → decide → activate, each its own audited transaction.
7. **Edge cases.** A sibling admission's or another year's approval, an approval requested before the version existed, a rejected or re-created draft: all refused (it.each of 10 reuse paths).
8. **Permissions.** Request `ops:admissions:write`; decide `ops:admissions:approve`; activate `ops:fees:record`.
9. **Tests.** Integration `fee-plans.test.ts` "an approval binds one exact agreement version"; `approvals-inbox.test.ts`.
10. **Limitations.** Rule O2 (**Proposed**, owner to confirm): a discount, waiver or credit (not a demo credit) on an active agreement needs `ops:admissions:approve`, a reason, and a poster who is not the agreement's maker; today one such approver may post it alone (only the operations manager holds both permissions).

## A-RPT-1 … A-RPT-5 Student progress reports — A-STU-5, IR-OPS-STU-1
`domain/student-report.ts`, `server/student-report.ts`; PDF `progress-report/1`. Tests: unit `academic-evidence.test.ts`, `progress-report-pdf.test.ts`; integration `academic-reports.test.ts`.
- **A-RPT-1 Sections by audience (`reportSections`).** Staff audiences: overview, programmes, results, attendance, feedback (`ops:feedback:read`), fees (`ops:fees:read`), guardians (private data). Guardian / student: overview, programmes, results, attendance, summary, plus fees totals only when an `ops:fees:read` holder asks for them. Readers see `readableSections` (today's permissions). Audiences come from `reports.audiences` (proposed; 400 when not enabled).
- **A-RPT-2 Workflow (`reportTransition`).** draft → reviewed needs the review permission and a reviewer other than the creator; reviewed → final needs the review permission; draft → final only when `reviewBeforeFinal` is off; final never moves. The snapshot is built at draft creation and never refreshed, so the reviewer approves exactly what becomes final.
- **A-RPT-3 Evidence.** Attended = present + late + partial; rate = attended ÷ (recorded − excused), null when 0. A comparison only within the result's own assessment and cohort, "Insufficient data" when fewer than 2 scored; trend per exam type over scored results (first → last %, |Δ| < 1 = level; fewer than 2 = insufficient); different maximum scores are labelled "formats differ … compared as percentages".
- **A-RPT-4 Constructive summary.** Evidence lines from measured facts; strengths, areas and next steps only from SUBMITTED and SHAREABLE teacher reviews read from Academic (D-058; never the internal text); empty → "No strengths recorded for this period."; next steps are titled "Proposed next step — not yet agreed with the teacher". **D-067 (R16):** when a source review is later withdrawn, a non-final report is blocked ("generate the report again"; also blocked while Academic cannot be asked) and a final report stays frozen with the notice "A source review was withdrawn after this report was finalised."
- **A-RPT-5 Period.** "In period" = the IST calendar day of the instant (`inIstPeriod`).
- **Source.** Attendance and results come from Academic `GET /academic/api/internal/v1/students/{academicStudentId}/summary` (`academic.student_summary` v1, rule A-ACD-STU-SUMMARY in `apps/academic-os/docs`); enrolment reviews by own-scope teachers fail closed when Academic is unreachable.

## A-MTG-4 Demo review grid — A-MTG-3, D-058, D-060
Per demo day and teacher, from the classes actually taught: submitted (an Academic demo review of that class, or an older Ops row) > pending (taught a present/late class, no review) > not due. Academic reviews match an Ops demo class by the `opsDemoSessionId` they carry, or (older reviews) by IST day and author (`matchDemoReviews`). For a class linked to an Academic class, the actual teachers and the attendance mark come from Academic (D-060, D-066). When Academic's reviews cannot be read, "pending" becomes "Source unavailable"; when its marks cannot be read, so does "not due". Tests: unit `demo-review-match.test.ts`, `academic-evidence.test.ts`; integration `academic-reviews.test.ts`, `academic-reports.test.ts`.

## A-MTG-5 Linked demo class attendance — D-060, D-066 (amended R15)
A demo class that Academic returns a mark for is linked: Ops stores `academic_session_ref` when it first sees the mark, and Academic's mark is the attendance fact. The counsellor's mark on a linked class is refused (409, "its teacher records attendance there"). While Academic cannot be reached, only classes Ops already knows are linked wait (409 "Waiting for Academic OS"), and so does the demo's move to `demo_attended`; classes with no ref stay counsellor-marked. Ops asks Academic only about classes that have started and fall in the list's date window, 200 ids per call, never inside a database transaction; the job `demo-academic-marks` (`POST /ops/api/v1/jobs/demo-academic-marks`, `ops:jobs:run` + all-scope `ops:leads:write`, no scheduler) re-reads open demos so a teacher's mark moves the case on without an Ops edit. Gaps: a class linked in Academic that Ops has not read yet can be counsellor-marked until the next successful read; a teacher can start a demo review only once the student is on an Academic class roster. Code: `server/academic-summary.ts` (`academicDemoMarks`, `assertCounsellorMayMark`), `server/demos.ts` (`syncDemo`). Tests: integration `academic-reviews.test.ts` "linked demo classes".

## A-ONB-1 Onboarding checklist — owner brief §8
1. **Purpose.** What a newly confirmed student still needs (KYC check, batch, registration payment, counselling, biometric, books, ID card).
2. **Inputs.** Versioned templates (`ops.onboarding_templates`), the student's running cases, item status events, material moves (`domain/onboarding.ts`).
3. **Output.** Items with status; counts; overdue.
4. **Preconditions.** An admission.
5. **Rules.** Copy from the latest ACTIVE version of each template whose programme codes overlap the student's cases and whose class category matches (null = any); several programmes = union by item key. A later version never rewrites items; "Add new template items" adds missing keys only; items can be added by hand or set Not applicable (kept in history). Status events are append-only, latest wins; blocked needs a note. Material items carry `programmeCode` and `requiredQuantity` (default 1): held ≥ required → Completed, 0 < held < required → In progress; manual "completed" refused until fully issued; return/replacement ≤ copies held. Biometric "completed" needs an evidence reference. Overdue = due date before IST today and not completed / not applicable (`isOnboardingOverdue`).
6. **Steps.** Generate → record status / materials, each audited (`onboarding.*`).
7. **Edge cases.** No matching template → message, nothing created.
8. **Permissions.** Read `ops:students:read`; write `ops:admissions:write` (own scope); templates `ops:settings:read` / `ops:settings:manage`.
9. **Tests.** Unit `onboarding.test.ts`; integration `student-kyc-onboarding.test.ts`.
10. **Limitations.** The `proposed_standard` v1 template is a proposal (owner to confirm items, due days, owners); `catalogueCode` is a free code.

## A-KYC-1 Identity documents, guardians, siblings — D-043
Masked reference only (`checkMaskedReference` over the shared `isMaskedReference`: at most 4 digits and a mask character). A new document is unverified and supersedes the previous one of the same type and person (kept, linked). Verify / reject once (409 after), with `ops:kyc:verify` + private read; rejection needs a note. Exactly one live primary guardian (the first is primary automatically; the primary cannot be unset or archived while other live guardians exist; an archived guardian is never primary; promotion audit carries `demotedGuardianIds`). Sibling links never merge or change either record and need write + private access to BOTH students (refusal and unknown id are both 404). KYC history = audit rows with masked contacts and no address text. Tests: integration `student-kyc-onboarding.test.ts`. Limitations: no unlink of a wrong sibling link; no four-eyes on verification (owner question).

## A-EVT-1 … A-EVT-3 Events and webinars — owner brief §12
- **A-EVT-1 Audience (`server/events.ts`).** Canonical students whose SAME case matches every filter (populations, programmes, class/category, batches); empty populations use `events.eligibility` (proposed: demo and active; guardians invited). Resolved once into participant rows with a name snapshot; later additions and removals are explicit rows; editing the filter never rewrites them. Cases without a student identity are counted, not added. Capacity counts registered participants only. Own-scope staff reach only students whose case they counsel or lead they own; guardian names need all-scope `ops:student_private:read`; a removed student's guardians are removed too.
- **A-EVT-2 Reach (`reachable`).** A known contact, consent `given` with the channel allowed on EVERY case of the student, and the guardian's own consent `given`. Anything unrecorded means "do not send".
- **A-EVT-3 Send (`messageStatus`).** Only a provider reference proves a send; otherwise `simulated`. Scheduling sends nothing; a send needs `ops:event_messages:send`.
Tests: unit `events.test.ts`; integration `events.test.ts`.

## A-STU-7 Exit and readmission — owner brief §11
1. **Purpose.** A returning student is readmitted without erasing history.
2. **Inputs.** The exited case, `{ reason, programmeCode?, academicYear? }`.
3. **Output.** A NEW case on the SAME lead and identity at `admission_pending`, with a new application (origin `readmission`, `previous_admission_id`).
4. **Preconditions.** The case has an exit status; no open readmission; no live case of the same programme for the student.
5. **Rules.** The closed case, its number and its exit record are untouched; the new case gets its own number only at final confirmation (D-040). Reactivating the exited case itself stays possible (`ops:students:reactivate`, never by whoever recorded the exit, only when the exit record allows it, refused while a readmission is open). Exit records add reason code (`admissions.closure_reasons`), prior batch, balance in paise (shown only with `ops:fees:read`; "Not recorded" when null), material status and closing notes.
6. **Steps.** Lock every case of the student in id order (no deadlock between concurrent readmit / reactivate) → checks → create case + application → audit `student.readmission_started`.
7. **Edge cases.** A second readmit → 409 naming the open one.
8. **Permissions.** `ops:students:lifecycle` + `ops:admissions:write`.
9. **Tests.** Integration `student-exit-readmission.test.ts`.
10. **Limitations.** Academic does not yet stop attendance on exit (IR-OPS-EXIT-1 `ops.enrolment.closed`) and completion candidates need batch end dates (IR-OPS-EXIT-2).

## A-TSK-1 … A-TSK-4 Daily tasks — owner decision 21 Oct 2026
`domain/staff-tasks.ts` (pure), `server/staff-tasks.ts`. Tests: unit `staff-tasks.test.ts`; integration `staff-tasks.test.ts`. Permissions: `ops:tasks:read`, `ops:tasks:write` (own scope: see A-TSK-5 §8).
- **A-TSK-1 `resolveTaskState`.** Statuses (R1, D-052 vocabulary plus two): Not started (`pending`), In progress, In review, Done, Blocked, On hold, Cancelled. Acknowledgement is separate (columns + event), never a status; "Assigned, not acknowledged" is derived. Done ⇒ 100 % and `completed_at`. Blocked, on hold and cancelled always need a reason (400 on `reason`; cancelled reuses the `reason` column).
- **A-TSK-2 `isOverdue`.** Open (not done or cancelled) and past its due time, or past its due day when no time is set (IST).
- **A-TSK-3 `nextOccurrence`.** Daily +1 day, weekly +7, monthly keeps the series' day of the month clamped to month end (31 Jan → 28 Feb → 31 Mar). Completing a recurring task creates exactly one next occurrence; it keeps the parent's source and creator (R18) and starts unacknowledged.
- **A-TSK-4 `buildEodSnapshot` ("My day" only).** Done = completed on the day; open = due that day and not done; carried = due earlier and not done; high priority first. Since 21 Oct 2026 (brief 2) this is only the day view; the submitted end-of-day report is built by A-TSK-8 from dated events.

## A-TSK-5 Task actions and authority — owner brief 2 §5–6, rulings R1, R3, R18 (D-069)
1. **Purpose.** Move a task through its lifecycle with a dated event for every step, and only by the people allowed to.
2. **Inputs.** Task (status, `reviewRequired`, acknowledged, self-logged), the caller's roles on it, setting `tasks.completion_without_reviewer` (proposed, default `owner`), reason (`decide` in `domain/task-lifecycle.ts`).
3. **Output.** `{ ok, to, event }` or a refusal `forbidden` (403) / `state` (409) / `reason` (400).
4. **Preconditions.** The caller can see the task (A-TSK-5 §8); `expectedVersion` equals the stored version (else 409).
5. **Rules.** Roles: **owner** (the accountable staff member), **manager** (anyone up the owner's `manager_id` chain), **admin** (all-scope `ops:tasks:write`), **reviewer** (the named reviewer), **creator** (the user who logged it).
   | Action | From | To | Who | Reason |
   |---|---|---|---|---|
   | acknowledge | any open | (no change) | owner | — |
   | request clarification | any open | (no change) | owner | yes |
   | start | not started | in progress | owner, manager, admin | — |
   | block | not started, in progress, on hold | blocked | owner, manager, admin | yes |
   | hold | not started, in progress, blocked | on hold | owner, manager, admin | yes |
   | resume | blocked, on hold | in progress | owner, manager, admin | — |
   | submit for review | in progress (review required only) | in review | owner, manager, admin | — |
   | approve | in review | done | reviewer, admin | — |
   | request changes | in review | in progress | reviewer, admin | yes |
   | complete | not started, in progress, blocked, on hold (no review step only) | done | owner, manager, admin; only manager, admin when the setting says `manager` | — |
   | cancel | any open | cancelled | creator, admin; also the owner when the task is self-logged | yes |
   | reopen | done, cancelled | in progress | owner, manager, admin | yes |
   **R18 (D-069).** "Self-logged" is fixed when the task is created: source `self` and created by the owner's own login, or imported while the owner is still the staff member the import batch was mapped to; recurring copies inherit it (they copy source, creator, review flag and reviewer). The creator regains authority if the work returns to them. Only the creator or all scope may change `reviewRequired` / `reviewerStaffId` (PATCH) or cancel assigned work. Reassigning (shared predicate `mayReassign`, `server/task-store.ts`) is open to the creator, a manager of the owner and all scope, and to the owner only for self-logged work; handing a task to its reviewer is refused; the owner of assigned work is told "Ask whoever gave you this to hand it over." `assignedByStaffId` is set by the server (display only; all scope may name someone). A generic status PATCH is mapped to the action above (`actionForStatus`); `in_review` and `cancelled` are refused there.
6. **Steps.** One transaction: lock the task → check version → decide → write the task (version + 1) → append the event (`status_changed` with from/to status, or the action's own kind) → audit `staff_task.*`. Open dependencies come back as `warnings`.
7. **Edge cases.** Acknowledging twice → 409. Submit on a task without review → 409 "mark it done instead"; complete on a task with review → 409. A task cannot go back to Not started.
8. **Permissions.** `ops:tasks:write` to act, `ops:tasks:read` to see. One visibility rule (`canSee`) for list, detail, report and writes: all scope, or the owner is you or one of your direct/indirect reports, or you are the reviewer, backup or assigner. A requester alone sees nothing. Outside it → 404.
9. **Tests.** Unit `task-lifecycle.test.ts` ("A-TSK-5 task lifecycle", "R18 self-logged is fixed at creation"); integration `task-lifecycle.test.ts` (tests 1–3 of brief 2, "fix round 1", "R18: gate and cancel authority come from who logged the task").
10. **Limitations.** No bulk changes. A manager who did not create a task cannot drop its review step (the operations manager can). Default reviewer when none is named, and who may cancel assigned work, are owner questions (HANDOFF).

## A-TSK-6 Dependencies — owner brief 2 §6
1. **Purpose.** Record that one task waits on another without closing loops. 2. **Inputs.** Existing `[task, dependsOn]` edges, the new pair (`createsCycle`). 3. **Output.** Accept or refuse. 4. **Preconditions.** The caller can see both tasks. 5. **Rules.** No self link; no pair twice (unique); a link that would reach the task again through existing edges is refused. Waiting is a warning: finishing B never completes A. 6. **Steps.** Transaction-scoped advisory lock (`lockDependencies`) → depth-first search from `dependsOn` → insert → `dependency_added` event. 7. **Edge cases.** Two concurrent requests that would each close half a loop are serialised by the lock. Titles of tasks outside the reader's scope are not shown. 8. **Permissions.** `ops:tasks:write`. 9. **Tests.** Unit "A-TSK-6 dependencies"; integration `task-lifecycle.test.ts` "test 3". 10. **Limitations.** No removal route for a link.

## A-TSK-7 Work updates and time — owner brief 2 §6, §12
1. **Purpose.** Keep a dated log of work that is separate from status, and report time honestly. 2. **Inputs.** Work entries (`ops.task_updates`), status events (`currentEntries`, `minutesOf`, `overlapWarnings`, `taskTimeSummary`). 3. **Output.** Entries that still count, warnings, elapsed / waiting / recorded minutes. 4. **Preconditions.** The author is the owner, the backup or the owner's manager (or all scope). 5. **Rules.** Each entry has an IST work date (`occurred_on`) and a recorded time (`recorded_at`); a late entry keeps its work date. Time is either minutes (1–1440) or a start and stop, never both; the stop cannot be in the future; the work date is the start's IST day. Entries are append-only: a correction is a new row with a reason that replaces the old one, once per entry, and only for your own entries. Overlaps with your other entries that day and midnight crossings are flagged, never corrected. Elapsed time (received → closed or now) and waiting time (blocked, on hold, in review) are not effort; recorded time is the sum of current entries, null when none. 6. **Steps.** Validate → insert → audit `staff_task.update_added` / `update_corrected` (the task version is not bumped). 7. **Edge cases.** No time on any entry → "not recorded", never 0. 8. **Permissions.** `ops:tasks:write`. 9. **Tests.** Unit "A-TSK-7 work entries and time"; integration `task-lifecycle.test.ts` "concurrency and work updates". 10. **Limitations.** Evidence is text or a link; there is no protected file storage.

## A-TSK-8 End-of-day facts — owner brief 2 §9–12, ruling R2 (`buildEodFacts`)
1. **Purpose.** Build one staff member's end-of-day report only from what was recorded inside that IST day, so a later change never rewrites an earlier report.
2. **Inputs.** The staff member's tasks and their events up to now, their work updates around the day, Academic teacher activity for the day (`server/eod-facts.ts` → `domain/eod.ts`).
3. **Output.** Snapshot format `eod-facts/1`: received, acknowledged, worked (with late entries marked), completed, blocked, help asked for (clarification requests only; sending a task for review is not a request for help), backlog and overdue at the cut-off, duration, Academic facts, `hr: unavailable`, counts, `noActivity`.
4. **Preconditions.** Report day is today or earlier.
5. **Rules.** Window = [00:00, 24:00) IST; cut-off = end of day, or the generation time while the day is running. Events after now and updates recorded after now are left out. Ownership comes from replaying each task's events (`taskStateAt`), so a reassigned task counts for whoever owned it then. Each section lists a task once. A task finished the next day is not completed on this day; a five-day task counts once per day it was worked. Start/stop work across midnight is split at the IST day boundary. Backlog and overdue are replayed as of the cut-off, including due dates from `due_changed` events, never from the current status. Duration = minutes on the day's updates; shift hours and Academic class time are never added; a task linked to an Academic record (`linkedRef` starting "academic") is flagged as the same activity. Academic metrics missing in the contract stay null ("not recorded"); a failed call says "Academic OS unavailable". HR attendance is always "HR attendance unavailable" (no HR module). Tasks with no events (before migration 0009) fall back to `completed_at`, then current status.
6. **Steps.** Save draft (facts rebuilt, narrative kept) → submit: rebuild, refuse while an open task due by the report day has no reason, freeze version n+1 in `ops.eod_report_versions` addressed to the resolved recipient → in-app notice. A revision request reopens the draft; resubmitting makes n+1 linked to n. `factsHash` (ignores times, overdue flags and the cut-off time on "blocked now" rows; keys sorted, because a snapshot read back from jsonb has its own key order) shows "Source changed since submission".
7. **Edge cases.** Submitting an already submitted report returns its current version (double click, retry); two submits at once make one version; a stale editor version → 409. No active manager with a login → submission waits until the employee chooses an `ops:eod:review` holder; the reporting line is not changed. Imported tracker reports are "Imported — not sent", not parsed as facts, not reviewable.
8. **Permissions.** Draft and submit: `ops:tasks:write` (own report). Read: owner, all scope, whoever a version was sent to; the current manager chain only when `eod.manager_history` = `current_team_all` (proposed default `submitted_to_manager`, R3). Non-owners see only the latest submitted version. Review: `ops:eod:review` or the recipient, never your own.
9. **Tests.** Unit `eod.test.ts` (tests 4–7 of brief 2); integration `eod-reports.test.ts` (tests 5–12, 17), `task-reports.test.ts` (period report).
10. **Limitations.** No submission deadline (`eod.submission_deadline` open). No external delivery (`eod.external_delivery` proposed, not editable): "Copy summary", PDF and CSV only. Whether imported reports count in EOD coverage and whether a reason is needed for every open task are owner questions.

**Period report (`server/task-period-report.ts`).** From / to up to 92 days; counts replayed from dated events (assigned and completed in the period, open and overdue at the cut-off); EOD coverage per person and calendar day up to today (no working-days policy exists; a missing report is not absence); blocker age; definitions printed with the report. Same scope as A-TSK-5 §8; PDF and CSV audited. CSV everywhere uses the shared `toCsv` (`packages/server-kit/src/csv.ts`, D-071).

## A-SRCH-1 Search — owner brief §4
`parseSearch` (`server/search.ts`): trimmed (≤ 100 characters); "contact-shaped" when it is an email (a@b.c) or phone-like with at least 4 digits. Under 2 characters → nothing. Groups leads / demos / applications / students, 10 hits each (+ "more"), each with its own read permission and own scope. Contact matching only with `ops:student_private:read`, audited `student.contact_search` with a masked value; phones returned masked to those holders only. The student list box (`app/students/_components/student-list.tsx`) treats 10+ digits or an email as a contact search; admission numbers are 3 digits, so they are never mistaken for a phone. Tests: unit `search.test.ts`, `student-contact-search.test.ts`; integration `search.test.ts`. Limitation: `GET /ops/search?q=` keeps the query in the URL, so host logs must drop query strings.
