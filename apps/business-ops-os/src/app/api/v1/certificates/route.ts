import { created, csvResponse, defineRoute } from '@elevate/server-kit';
import {
  certificateListQuery,
  certificatesCsv,
  issueCertificate,
  issueCertificateBody,
} from '../../../../server/certificates';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/certificates?type=&status= — the certificate register as a spreadsheet (CSV), your scope. Audited. */
export const GET = defineRoute(
  { permission: 'ops:students:read', query: certificateListQuery },
  async ({ user, db, query }) =>
    csvResponse(await certificatesCsv(db, user, query), 'certificate-register.csv'),
);

/** POST { admissionId, type } — issue a certificate on a student's case (wording approved in Settings). */
export const POST = defineRoute(
  {
    permission: 'ops:certificates:issue',
    body: issueCertificateBody,
    idempotency: 'optional',
  },
  async ({ user, db, body, requestId }) =>
    created(await issueCertificate(db, user, body, requestId)),
);
