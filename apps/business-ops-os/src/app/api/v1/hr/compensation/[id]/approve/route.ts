import { defineRoute } from '@elevate/server-kit';
import { approveCompensation } from '../../../../../../../server/hr/compensation';
import { approveCompensationBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/compensation/[id]/approve — Approve a draft (a different person; `confirm: true`). */
export const POST = defineRoute(
  { permission: 'ops:compensation:manage', params: staffIdParams, body: approveCompensationBody },
  async ({ user, db, params, requestId }) => approveCompensation(db, user, params.id, requestId),
);
