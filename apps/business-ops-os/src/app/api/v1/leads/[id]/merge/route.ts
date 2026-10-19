import { defineRoute } from '@elevate/server-kit';
import { mergeLeads } from '../../../../../../server/leads';
import { idParams, mergeBody } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/[id]/merge — Merge this lead INTO targetLeadId (explicit, audited). */
export const POST = defineRoute(
  { permission: 'ops:leads:merge', params: idParams, body: mergeBody },
  async ({ user, db, params, body, requestId }) =>
    mergeLeads(db, user, params.id, body.targetLeadId, body.note, requestId),
);
