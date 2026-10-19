import { defineRoute } from '@elevate/server-kit';
import { processAccessRevocations } from '../../../../../server/access-revocation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/jobs/access-revocations — run the access-revocation consumer by
 * hand (no scheduler yet): disables the logins of separated employees
 * (`ops.employee.separated`). Idempotent. Disabling accounts is user
 * administration, so it needs `platform:users:manage` (platform_admin only).
 */
export const POST = defineRoute(
  { permission: 'platform:users:manage', module: 'platform' },
  async ({ db }) => processAccessRevocations(db),
);
