import { defineRoute } from '@elevate/server-kit';
import { listApprovalInbox } from '../../../../../server/approvals';

export const dynamic = 'force-dynamic';

/**
 * GET /ops/api/v1/operations/approvals — The signed-in user's approvals inbox:
 * per source, the items they may decide (never their own requests).
 */
export const GET = defineRoute({ permission: 'ops:module:access' }, async ({ user, db }) =>
  listApprovalInbox(db, user),
);
