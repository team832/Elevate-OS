import { defineRoute } from '@elevate/server-kit';
import { updateAssessmentInternalBody } from '@elevate/shared-contracts';
import { requireTest, updateTest } from '../../../../../server/assessments';
import { testFiles } from '../../../../../server/assessments-files';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/assessments/:id: the Academic record and the papers and keys the caller may open. */
export const GET = defineRoute(
  { permission: 'ops:assessments:read', params: idParams },
  async ({ db, user, params }) => ({
    test: await requireTest(user, params.id),
    files: await testFiles(db, user, params.id),
  }),
);

/** PATCH /ops/api/v1/assessments/:id: change, schedule or cancel (cancelling needs a reason) in Academic. */
export const PATCH = defineRoute(
  { permission: 'ops:assessments:manage', params: idParams, body: updateAssessmentInternalBody },
  async ({ user, params, body }) => updateTest(user, params.id, body),
);
