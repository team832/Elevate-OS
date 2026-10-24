import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import {
  getOptimisationItem,
  optimisationUpdateBody,
  updateOptimisationItem,
} from '../../../../../server/optimisation';

export const dynamic = 'force-dynamic';
const params = z.object({ id: z.uuid() });

/** GET /marketing/api/v1/optimisation/:id — item, checklist, evidence, review and observations. */
export const GET = defineRoute(
  { permission: 'marketing:optimisation:read', params },
  async ({ db, params }) => getOptimisationItem(db, params.id),
);

/** PATCH /marketing/api/v1/optimisation/:id — edit a draft or an item sent back (own scope). */
export const PATCH = defineRoute(
  { permission: 'marketing:optimisation:write', params, body: optimisationUpdateBody },
  async ({ db, params, body, user, requestId }) =>
    updateOptimisationItem(db, user, params.id, body, requestId),
);
