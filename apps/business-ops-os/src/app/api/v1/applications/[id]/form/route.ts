import { defineRoute } from '@elevate/server-kit';
import { generateForm } from '../../../../../../server/applications';
import { pdfResponse } from '../../../../../../server/pdf/document';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/applications/[id]/form — Generate the admission-form PDF of the current version (its SHA-256 is recorded) and download it. */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams },
  async ({ user, db, params, requestId }) => {
    const { bytes, filename } = await generateForm(db, user, params.id, requestId);
    return pdfResponse(bytes, filename);
  },
);
