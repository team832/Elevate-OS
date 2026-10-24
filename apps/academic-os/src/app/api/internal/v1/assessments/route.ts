import { defineInternalRoute, defineInternalWriteRoute } from '@elevate/server-kit';
import { assessmentListQuerySchema, createAssessmentInternalBody } from '@elevate/shared-contracts';
import {
  createAssessmentInternal,
  internalActor,
} from '../../../../../server/services/assessment-ops';
import {
  getAssessmentDetail,
  listAssessmentsInternal,
} from '../../../../../server/services/assessment-views';

export const dynamic = 'force-dynamic';

/** GET /academic/api/internal/v1/assessments?view&courseId&batchId&teacherStaffId&from&to&page&pageSize — academic.assessments v1 (caller ops). */
export const GET = defineInternalRoute(
  { callers: ['ops'], query: assessmentListQuerySchema },
  async ({ db, query }) => listAssessmentsInternal(db, query),
);

/** POST — create (draft, or scheduled with a date) with eligible batches; answers academic.assessment v1. */
export const POST = defineInternalWriteRoute(
  { callers: ['ops'], body: createAssessmentInternalBody },
  async ({ db, body, actingUserId, requestId }) =>
    getAssessmentDetail(
      db,
      await createAssessmentInternal(db, await internalActor(db, actingUserId, requestId), body),
    ),
);
