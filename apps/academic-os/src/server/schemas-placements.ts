/** Request schemas for batch placements and teaching-assignment changes (ACD-019, owner brief §6 and §8; brief 23 Oct 2026 §4). */
import { z } from 'zod';
import { TEACHING_ASSIGNMENT_STATUSES } from '@elevate/shared-contracts';
import { academicYearSchema, isoDateSchema } from './schemas';

const reason = z.string().trim().min(1).max(1000);

export const PLACEMENT_VIEWS = ['awaiting', 'placed', 'transfers', 'ended'] as const;
export const placementsQuery = z.object({ view: z.enum(PLACEMENT_VIEWS).default('awaiting') });

export const allocateBody = z
  .object({ enrolmentId: z.uuid(), batchId: z.uuid(), startDate: isoDateSchema.optional(), reason: reason.optional() })
  .strict();

export const transferBody = z
  .object({ enrolmentId: z.uuid(), toBatchId: z.uuid(), effectiveDate: isoDateSchema, reason })
  .strict();

export const endEnrolmentBody = z
  .object({
    enrolmentId: z.uuid(),
    outcome: z.enum(['completed', 'withdrawn']),
    endDate: isoDateSchema,
    reason,
    confirm: z.literal(true, { error: 'Tick the box to confirm this enrolment ends.' }),
  })
  .strict();

export const endAssignmentBody = z.object({ endDate: isoDateSchema }).strict();

/** Edit an assignment; `batchId` only on a pending one, which activates it (R9). */
export const updateAssignmentBody = z
  .object({
    batchId: z.uuid().optional(),
    role: z.enum(['primary', 'co_teacher', 'substitute']).optional(),
    employmentType: z.enum(['full_time', 'part_time']).optional(),
    startDate: isoDateSchema.optional(),
    /** null clears it. */
    academicYear: academicYearSchema.nullable().optional(),
    branchId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { error: 'Change at least one field.' });

/** `GET /api/internal/v1/teaching-assignments` (caller ops): HR's paginated list; `q` = teacher, subject or batch. */
export const teachingAssignmentsQuery = z.object({
  staffId: z.uuid().optional(),
  status: z.enum(TEACHING_ASSIGNMENT_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
