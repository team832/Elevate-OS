/**
 * OWNER: Business Ops OS team — HR lifecycle slice (OPS-048, D-028).
 *
 * HR integration events Business Ops OS publishes.
 *
 *   Business Ops OS                         Platform
 *   ───────────────                         ────────
 *   separation applied ──(outbox)──▶ ops.employee.separated v1
 *                                       │ consumer `platform.access-revocation`:
 *                                       │ core.users.status = 'disabled',
 *                                       │ every session of the user deleted,
 *                                       │ audit `user.access_revoked` (module platform)
 *
 * Rules
 * - Ops publishes in the same transaction that marks the employee separated.
 *   idempotencyKey = `separation:<caseId>` (one separation per offboarding case),
 *   or `separation:staff:<staffId>:<lastWorkingDay>` without a case.
 * - The payload carries ids and dates only: no separation type or reason,
 *   no personal contact details.
 * - The platform processes it once per event (core.event_deliveries); a rerun
 *   is a no-op. Ops reads the delivery status and the platform audit row to
 *   complete the offboarding "access revocation" checklist item.
 *
 * Do not import other modules' files from here.
 */
import { z } from 'zod';
import { defineEvent, type EventDefinition } from '../events/define';
import { isoDateSchema, isoDateTimeSchema, staffMemberIdSchema, userIdSchema } from '../ids';

/** Consumer name the platform uses for separations (access revocation). */
export const PLATFORM_ACCESS_REVOCATION_CONSUMER = 'platform.access-revocation' as const;

/** Idempotency keys for HR lifecycle events. */
export const hrLifecycleKeys = {
  /** One separation per offboarding case. */
  separation: (caseId: string) => `separation:${caseId}`,
  /** A separation recorded without a case (direct staff deactivation): one per staff and end date. */
  separationWithoutCase: (staffId: string, lastWorkingDay: string) =>
    `separation:staff:${staffId}:${lastWorkingDay}`,
};

export const employeeSeparatedV1Payload = z.object({
  /** core.staff_members.id of the separated employee. */
  staffId: staffMemberIdSchema,
  /** EMP-#### code (for audit readability). */
  employeeCode: z.string().regex(/^EMP-[0-9]{4}$/),
  /** Linked login, if any. Absent = the employee had no login; nothing to revoke. */
  userId: userIdSchema.optional(),
  /** Offboarding case (ops.lifecycle_cases.id); absent when HR set the staff record inactive directly. */
  caseId: z.uuid().optional(),
  /** Last working day (Asia/Kolkata calendar date). */
  lastWorkingDay: isoDateSchema,
  /** UTC instant the separation was applied. */
  separatedAt: isoDateTimeSchema,
});
export type EmployeeSeparatedV1 = z.output<typeof employeeSeparatedV1Payload>;

export const opsHrEvents = [
  defineEvent({
    type: 'ops.employee.separated',
    version: 1,
    producer: 'ops',
    consumers: ['platform'],
    description:
      'An employee was separated (offboarding approved and the last working day passed). The platform disables the linked login and deletes its sessions exactly once.',
    payload: employeeSeparatedV1Payload,
  }),
] as const satisfies readonly EventDefinition[];
