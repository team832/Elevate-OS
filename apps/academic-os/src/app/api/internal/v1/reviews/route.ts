import { defineInternalRoute } from '@elevate/server-kit';
import { buildStudentReviewsV1 } from '../../../../../server/services/reviews';
import { internalReviewsQuery } from '../../../../../server/schemas-teaching';

export const dynamic = 'force-dynamic';

/**
 * GET /academic/api/internal/v1/reviews?coreStudentId=|authorStaffId=&from&to — AcademicStudentReviewsV1
 * for Business Ops only (bearer INTERNAL_SERVICE_TOKEN + X-Elevate-Caller: ops; R4). Submitted
 * versions and withdrawn markers (no withdrawn content), never drafts. Ops checks its own user
 * permission (ops:feedback:read) before calling and filters audiences by `visibility`.
 */
export const GET = defineInternalRoute({ callers: ['ops'], query: internalReviewsQuery }, async ({ db, query }) => buildStudentReviewsV1(db, query));
