# Business Ops OS — integration requests

Requests to other owners (BUILD_PLAN rule 1). Business Ops did not edit any of these files.

| ID | To | Request | Why | Status |
|---|---|---|---|---|
| IR-OPS-01 | Foundation/Integration (`packages/authorization/tests/authorization.test.ts`) | Grant `ops:module:access` to `teacher` (in `permissions/ops.ts`, Ops-owned) **and** update the test that pins `modulesFor(teacher)` to `['platform', 'academic']`. | Teachers hold `ops:tasks:read/write` with scope `own` and can open `/ops/tasks` directly, but the module switcher does not show Ops for them because granting module access would break a Foundation-owned test. | Open |
| IR-OPS-02 | Integration (wave 3) | Run the Ops jobs on a schedule: `runFollowUpReminders`, `runTaskEscalations`, `processEnrolmentReplies` (exported from `@elevate/business-ops-os/server`; all idempotent). Suggested: replies every minute, reminders 09:00 IST daily, escalations hourly. | No scheduler exists; today an operations manager runs them from `/ops/tasks` or `POST /ops/api/v1/jobs/{job}`. | Open |
| IR-OPS-03 | Integration (wave 3) | End-to-end test: Ops `requestEnrolment` → Academic consumer `academic.enrolment-intake` → reply → Ops `processEnrolmentReplies`. | Each side is tested against the contract with hand-published events only. | Open |
| IR-OPS-04 | Integration | Regenerate the permission matrix (`npm run docs:permissions`) in `docs/SECURITY_AND_PERMISSIONS.md`. | `permissions/ops.ts` changed: counsellor scopes are now `own`; new `ops:leads:assign`, `ops:leads:merge`, `ops:admissions:approve`, `ops:incidents:*`, `ops:settings:*`, `ops:jobs:run`; teacher task grants. `npm run docs:permissions -- --check` will report drift until regenerated. | Open |
| IR-OPS-05 | Foundation (`packages/shared-types/src/ids.ts`) | Optional: add shared branded ids for Ops entities other modules may reference later (e.g. `SopId`, `DecisionId`). | Ops brands them locally in `packages/database/src/schema/ops.ts` for now. | Open (low priority) |
| IR-OPS-06 | Academic OS | Serve `GET /academic/api/internal/v1/summary` with `callers` including `ops`, returning `AcademicDeliverySummaryV1`. | The Ops dashboard already calls it and shows "source unavailable" until it exists. | Open |
| IR-OPS-07 | Marketing OS | Serve `GET /marketing/api/internal/v1/summary` with `callers` including `ops` (`MarketingSummaryV1`). Later: `marketing.enquiry.captured.v1` for MKT-036 → OPS-001. | Same as IR-OPS-06; enquiry intake from Marketing is Proposed on the Ops side. | Open |
| IR-OPS-08 | Foundation (`packages/shared-ui`) | Optional: a `title` tooltip on `StatTile` (PRD: definition visible on hover). | Ops prints the definition under each tile instead. | Open (low priority) |
| IR-OPS-09 | Integration (`core.ts` owner) | If the owner wants an Ops-specific staff role list or employment type in core, move `ops.staff_profiles` fields into `core.staff_members`. | Ops did not change `core.ts` (steward rule); profiles live in `ops.staff_profiles`. | Proposal |

No npm dependencies were added (phone normalisation and similarity are implemented in `src/domain/contacts.ts` instead of using libphonenumber).
