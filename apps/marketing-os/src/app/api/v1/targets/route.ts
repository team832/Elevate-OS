import { created, defineRoute } from '@elevate/server-kit';
import {
  createTarget,
  targetBody,
  targetListQuery,
  targetVsActual,
} from '../../../../server/targets';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/targets?from&to&scope&staffId&campaignId — targets with actual and remaining. */
export const GET = defineRoute(
  { permission: 'marketing:targets:read', query: targetListQuery },
  async ({ db, query, user }) => targetVsActual(db, user, query),
);

/** POST /marketing/api/v1/targets — set a target (marketing manager). */
export const POST = defineRoute(
  { permission: 'marketing:targets:manage', body: targetBody, idempotency: 'optional' },
  async ({ db, body, user, requestId }) => created(await createTarget(db, user, body, requestId)),
);
