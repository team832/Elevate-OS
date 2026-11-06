import { created, defineRoute } from '@elevate/server-kit';
import { assetIssueBody, issueAsset } from '../../../../../server/hr-staff-records';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/assets — issue an asset to a staff member; a tag out with someone is 409 (F4-09). */
export const POST = defineRoute(
  { permission: 'ops:staff:manage', body: assetIssueBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await issueAsset(db, user, body, requestId)),
);
