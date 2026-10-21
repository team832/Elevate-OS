import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { LEAD_HANDOFF_STATUSES, listLeadHandoffs } from '../../../../../server/lead-intake';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/leads/handoffs?status= — Marketing lead handoff receipts (no contacts; attribution only with ops:lead_attribution:read). */
export const GET = defineRoute(
  {
    permission: 'ops:leads:read',
    query: z.object({ status: z.enum(LEAD_HANDOFF_STATUSES).optional() }),
  },
  async ({ user, db, query }) => listLeadHandoffs(db, user, query),
);
