import { defineInternalRoute } from '@elevate/server-kit';
import { updateAssessmentInternalBody } from '@elevate/shared-contracts';
import { updateAssessmentInternal } from '../../../../../../server/services/assessment-ops';
import { getAssessmentDetail } from '../../../../../../server/services/assessment-views';
import { idParams, opsWrite } from '../_write';

export const dynamic = 'force-dynamic';

/** GET /academic/api/internal/v1/assessments/{id} — academic.assessment v1 (caller ops). */
export const GET = defineInternalRoute(
  { callers: ['ops'], params: idParams },
  async ({ db, params }) => getAssessmentDetail(db, params.id),
);

/** PATCH — change fields, schedule, or cancel with a reason. */
export const PATCH = opsWrite({ body: updateAssessmentInternalBody }, (db, actor, p, body) =>
  updateAssessmentInternal(db, actor, p.id, body),
);
