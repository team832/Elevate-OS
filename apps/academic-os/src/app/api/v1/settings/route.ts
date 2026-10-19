import { defineRoute } from '@elevate/server-kit';
import { listSettings } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/settings — Configurable rules with their status (proposed/approved). */
export const GET = defineRoute({ permission: 'academic:courses:read' }, async (ctx) => listSettings(ctx.db));
