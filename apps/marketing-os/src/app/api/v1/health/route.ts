import { createHealthHandler } from '@elevate/server-kit';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/health — 200 when the database answers, 503 otherwise. Public. */
export const GET = createHealthHandler({ app: '@elevate/marketing-os', module: 'marketing' });
