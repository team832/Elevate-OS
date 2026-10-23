import { defineRoute } from '@elevate/server-kit';
import { remapImport } from '../../../../../../server/feedback-import';
import { importMappingBody } from '../../../../../../server/feedback-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/feedback/imports/:id — Preview again with another column mapping. */
export const PATCH = defineRoute(
  { permission: 'ops:teacher_feedback:import', params: idParams, body: importMappingBody },
  async ({ user, db, params, body, requestId }) =>
    remapImport(db, user, params.id, body.mapping, requestId),
);
