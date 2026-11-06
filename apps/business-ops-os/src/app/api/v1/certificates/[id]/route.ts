import { defineRoute } from '@elevate/server-kit';
import {
  certificatePdfFor,
  revokeCertificate,
  revokeCertificateBody,
} from '../../../../../server/certificates';
import { pdfResponse } from '../../../../../server/pdf/document';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/certificates/[id] — the certificate PDF (readers of the student; the second print says "Duplicate"). */
export const GET = defineRoute(
  { permission: 'ops:students:read', params: idParams },
  async ({ user, db, params }) => {
    const { bytes, filename } = await certificatePdfFor(db, user, params.id);
    return pdfResponse(bytes, filename);
  },
);

/** POST { reason } — revoke the certificate (kept in the register with who, when and why). */
export const POST = defineRoute(
  { permission: 'ops:certificates:issue', params: idParams, body: revokeCertificateBody },
  async ({ user, db, params, body, requestId }) =>
    revokeCertificate(db, user, params.id, body, requestId),
);
