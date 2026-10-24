import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import {
  deleteTarget,
  targetDrilldown,
  targetUpdateBody,
  updateTarget,
} from '../../../../../server/targets';

export const dynamic = 'force-dynamic';
const params = z.object({ id: z.uuid() });

/** GET /marketing/api/v1/targets/:id — the records behind the actual and the remaining target. */
export const GET = defineRoute(
  { permission: 'marketing:targets:read', params },
  async ({ db, params, user }) => targetDrilldown(db, user, params.id),
);

/** PATCH /marketing/api/v1/targets/:id — change the value, period or note (marketing manager). */
export const PATCH = defineRoute(
  { permission: 'marketing:targets:manage', params, body: targetUpdateBody },
  async ({ db, params, body, user, requestId }) =>
    updateTarget(db, user, params.id, body, requestId),
);

/** DELETE /marketing/api/v1/targets/:id — remove a target (audited with its last values). */
export const DELETE = defineRoute(
  { permission: 'marketing:targets:manage', params },
  async ({ db, params, user, requestId }) => deleteTarget(db, user, params.id, requestId),
);
