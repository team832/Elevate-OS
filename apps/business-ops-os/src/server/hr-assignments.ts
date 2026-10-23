/**
 * Teaching assignments for HR (brief 23 Oct 2026 §4, ruling R9), read from Academic OS — the
 * owner of academic.teacher_assignments — through its internal route (caller `ops`). Read only:
 * coordinators change assignments in Academic OS. When Academic cannot be read the screen says
 * "Source unavailable", never an empty list.
 *
 * Contract requested from Academic (ACAD): GET /academic/api/internal/v1/teaching-assignments
 * ?staffId&status&q&page&pageSize → `teachingAssignmentsV1Schema` (q = teacher, subject or batch).
 * The schema is Academic's, in shared-contracts/summaries.ts.
 */
import { z } from 'zod';
import { fetchInternal } from '@elevate/server-kit';
import {
  TEACHING_ASSIGNMENT_STATUSES,
  teachingAssignmentsV1Schema,
} from '@elevate/shared-contracts';
import type { Database } from '@elevate/database';
import { accessScope, type Actor } from './context';
import { academicUrl } from './academic-summary';
import { scopedStaff } from './hr-staff';

export const ASSIGNMENT_STATUSES = TEACHING_ASSIGNMENT_STATUSES;
export const ASSIGNMENTS_PAGE_SIZE = 25;

export type TeachingAssignment = z.output<typeof teachingAssignmentsV1Schema>['items'][number];

export const assignmentsQuery = z.object({
  staffId: z.uuid().optional(),
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** One page of assignments from Academic, or `unavailable` (with the time it was checked). */
export async function listTeachingAssignments(
  db: Database,
  actor: Actor,
  query: z.input<typeof assignmentsQuery> = {},
) {
  await accessScope(db, actor, 'ops:teaching_assignments:read');
  const q = assignmentsQuery.parse(query);
  // A person outside HR's scope is "not found" here too.
  if (q.staffId) await scopedStaff(db, actor, q.staffId);
  const params = new URLSearchParams({
    page: String(q.page),
    pageSize: String(ASSIGNMENTS_PAGE_SIZE),
    ...(q.staffId ? { staffId: q.staffId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { q: q.q } : {}),
  });
  return fetchInternal(
    academicUrl(`/academic/api/internal/v1/teaching-assignments?${params}`),
    teachingAssignmentsV1Schema,
    { caller: 'ops', timeoutMs: 3000 },
  );
}
