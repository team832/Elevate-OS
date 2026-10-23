import { created, defineRoute } from '@elevate/server-kit';
import { previewImport } from '../../../../../server/feedback-import';
import { importUploadBody } from '../../../../../server/feedback-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/feedback/imports — Upload a feedback CSV: a preview with row outcomes (nothing imported yet). */
export const POST = defineRoute(
  { permission: 'ops:teacher_feedback:import', body: importUploadBody },
  async ({ user, db, body, requestId }) => created(await previewImport(db, user, body, requestId)),
);
