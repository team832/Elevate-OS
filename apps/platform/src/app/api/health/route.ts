import { createHealthHandler } from '@elevate/server-kit';

export const dynamic = 'force-dynamic';

/** GET /api/health — 200 when the database answers, 503 otherwise. Public. */
export const GET = createHealthHandler({ app: '@elevate/platform', module: 'platform' });
