import { defineRoute } from '@elevate/server-kit';
import { getLead, updateLead } from '../../../../../server/leads';
import { idParams, updateLeadBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/leads/[id] — Lead detail: enquiries, activity, admissions, follow-ups, duplicates, history. */
export const GET = defineRoute(
  { permission: 'ops:leads:read', params: idParams },
  async ({ user, db, params }) => getLead(db, user, params.id),
);

/** PATCH /ops/api/v1/leads/[id] — Edit lead details (contacts re-normalised; new duplicate flags raised, never merged). */
export const PATCH = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: updateLeadBody },
  async ({ user, db, params, body, requestId }) => updateLead(db, user, params.id, body, requestId),
);
