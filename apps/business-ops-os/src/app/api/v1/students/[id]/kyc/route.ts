import { created, defineRoute } from '@elevate/server-kit';
import { getStudentKyc, recordKycDocument } from '../../../../../../server/kyc';
import { kycDocumentBody } from '../../../../../../server/profile-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/students/[id]/kyc — Identity documents (masked), siblings and KYC history; needs ops:student_private:read. */
export const GET = defineRoute(
  { permission: 'ops:student_private:read', params: idParams },
  async ({ user, db, params }) => getStudentKyc(db, user, params.id),
);

/** POST /ops/api/v1/students/[id]/kyc — Record an identity document (masked reference only; starts unverified). */
export const POST = defineRoute(
  { permission: 'ops:guardians:write', params: idParams, body: kycDocumentBody },
  async ({ user, db, params, body, requestId }) =>
    created(await recordKycDocument(db, user, params.id, body, requestId)),
);
