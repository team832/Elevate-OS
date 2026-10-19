/**
 * OWNER: Academic OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Contracts that Academic OS publishes for other modules: its integration
 * events (add `defineEvent(...)` entries to `academicEvents`; type names start
 * with `academic.`) and shared shapes for its internal APIs.
 *
 * Already defined elsewhere (Foundation-owned, change via Integration):
 * - `academic.enrolment.confirmed` v1 / `academic.enrolment.rejected` v1 — `../events/enrolment.ts`
 * - `AcademicDeliverySummaryV1` — `../summaries.ts`
 *
 * Do not import other modules' files from here.
 */
import { z } from 'zod';
import type { EventDefinition } from '../events/define';
import { defineEvent } from '../events/define';
import { batchIdSchema, isoDateTimeSchema, programmeCodeSchema, userIdSchema } from '../ids';

/** Consumer names Academic OS uses with `processEvents` (stable: renaming re-processes everything). */
export const ACADEMIC_CONSUMERS = {
  /** Consumes `ops.admission.enrolment_requested` v1 and replies confirmed/rejected. */
  enrolmentIntake: 'academic.enrolment-intake',
} as const;

/**
 * `academic.assessment.finalised` v1 — published in the same transaction that
 * writes an immutable result version (first finalisation or a re-score). It
 * carries counts only — never student names or scores — so a future consumer
 * (e.g. parent-report reminders in Ops, ACD-028) can react without reading
 * Academic's tables. No consumer exists yet.
 */
export const assessmentFinalisedV1Payload = z
  .object({
    assessmentId: z.uuid(),
    assessmentCode: z.string().min(1).max(80),
    kind: z.enum(['chapter_test', 'sectional', 'full_mock', 'practice']),
    batchId: batchIdSchema,
    programmeCode: programmeCodeSchema,
    /** 1 for the first finalisation; +1 for each re-score. */
    resultVersion: z.int().min(1),
    studentsScored: z.int().min(0),
    studentsAbsent: z.int().min(0),
    finalisedAt: isoDateTimeSchema,
    finalisedByUserId: userIdSchema,
  })
  .strict();

export const assessmentFinalisedV1 = defineEvent({
  type: 'academic.assessment.finalised',
  version: 1,
  producer: 'academic',
  consumers: [],
  description:
    'Academic OS finalised (or re-scored) the results of an assessment. Counts only; no personal data.',
  payload: assessmentFinalisedV1Payload,
});

export const academicEvents = [
  assessmentFinalisedV1,
] as const satisfies readonly EventDefinition[];
