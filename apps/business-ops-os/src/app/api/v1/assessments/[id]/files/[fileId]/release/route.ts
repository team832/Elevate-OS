import { defineRoute } from '@elevate/server-kit';
import { releaseTestFile } from '../../../../../../../../server/assessments-files';
import { releaseBody, testFileParams } from '../../../../../../../../server/assessments-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/assessments/:id/files/:fileId/release: open a paper or key to readers (audited). */
export const POST = defineRoute(
  { permission: 'ops:assessments:manage', params: testFileParams, body: releaseBody },
  async ({ db, user, params, body, requestId }) =>
    releaseTestFile(db, user, params.id, params.fileId, body, requestId),
);
