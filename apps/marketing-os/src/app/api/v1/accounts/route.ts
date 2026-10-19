import { defineRoute } from '@elevate/server-kit';
import { listAccounts, listLegacyConflicts } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/accounts — registry + unreconciled source conflicts (OD-001). */
export const GET = defineRoute({ permission: 'marketing:accounts:read' }, async ({ db }) => ({
  accounts: await listAccounts(db),
  conflicts: await listLegacyConflicts(db),
}));
