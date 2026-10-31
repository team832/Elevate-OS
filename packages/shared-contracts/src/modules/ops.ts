/**
 * OWNER: Business Ops OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Contracts that Business Ops OS publishes for other modules.
 *
 * Events: Business Ops PRODUCES `ops.admission.enrolment_requested` v1, `ops.enrolment.closed` v1
 * and `ops.student.renamed` v1, all Foundation-owned in `../events/enrolment.ts` (keys
 * `enrolmentKeys.request(admissionId, attempt)`, `.closed(exitRecordId)`, `.renamed(id, at)`), and CONSUMES
 * `academic.enrolment.confirmed` / `academic.enrolment.rejected` v1 with the
 * consumer name below. No other Ops events exist yet; `ops.lead.*` events for
 * Marketing attribution and the `/ops/api/internal/v1/summary` contract are
 * Proposed (apps/business-ops-os/requirements/REQUIREMENTS.md).
 *
 * Do not import other modules' files from here.
 */
import type { EventDefinition } from '../events/define';

/** Consumer name Ops uses with processEvents for Academic's enrolment replies. */
export const OPS_ENROLMENT_REPLIES_CONSUMER = 'ops.enrolment-replies' as const;

export const opsEvents = [] as const satisfies readonly EventDefinition[];

/** What a login with no staff record is told on every screen: the remedy that works and who can do it (ops:organisation:manage). */
export const LINK_LOGIN_HELP = 'Ask an operations manager to link your login to your staff record.';

/** For lists no screen can add to: they come with the reference data loaded at install. */
export const REFERENCE_DATA_HELP =
  'No screen adds these: they come with the reference data. Ask a platform administrator to load it.';

/**
 * Masked identity-document reference (D-043): 2–40 characters, at most 4 digits in total and at
 * least one mask character (X, x, *, •). Same rule as the DB CHECK `kyc_documents_masked_check`.
 */
export const isMaskedReference = (value: string) =>
  value.length >= 2 &&
  value.length <= 40 &&
  value.replace(/[^0-9]/g, '').length <= 4 &&
  /[Xx*•]/.test(value);
