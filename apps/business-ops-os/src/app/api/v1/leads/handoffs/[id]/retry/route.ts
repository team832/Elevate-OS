import { defineRoute } from '@elevate/server-kit';
import { retryLeadHandoff } from '../../../../../../../server/lead-intake';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/handoffs/[id]/retry — Reprocess a failed Marketing lead handoff (audited). */
export const POST = defineRoute(
  { permission: 'ops:lead_handoffs:manage', params: idParams },
  async ({ user, db, params, requestId }) => retryLeadHandoff(db, user, params.id, requestId),
);
