import { defineInternalRoute } from '@elevate/server-kit';
import { teachingAssignmentsQuery } from '../../../../../server/schemas-placements';
import { teachingAssignmentsPage } from '../../../../../server';

export const dynamic = 'force-dynamic';

/**
 * GET /academic/api/internal/v1/teaching-assignments?staffId&status&q&page&pageSize — one page of
 * `academic.teaching_assignments` v1 for HR in Business Ops (bearer INTERNAL_SERVICE_TOKEN +
 * X-Elevate-Caller: ops). Pending rows (no batch yet) included. Page size at most 100.
 */
export const GET = defineInternalRoute({ callers: ['ops'], query: teachingAssignmentsQuery }, async ({ db, query }) => teachingAssignmentsPage(db, query));
