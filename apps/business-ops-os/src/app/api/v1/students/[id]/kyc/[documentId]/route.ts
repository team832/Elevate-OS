import { defineRoute } from '@elevate/server-kit';
import { verifyKycDocument } from '../../../../../../../server/kyc';
import { kycDocumentParams, kycVerifyBody } from '../../../../../../../server/profile-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/students/[id]/kyc/[documentId] — Verify or reject the current identity document (ops:kyc:verify). */
export const POST = defineRoute(
  { permission: 'ops:kyc:verify', params: kycDocumentParams, body: kycVerifyBody },
  async ({ user, db, params, body, requestId }) =>
    verifyKycDocument(db, user, params.id, params.documentId, body, requestId),
);
