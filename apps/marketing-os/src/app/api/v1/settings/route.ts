import { defineRoute } from '@elevate/server-kit';
import { listLegacyConflicts, listPolicySettings } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/settings — policies (proposed owner decisions) and source conflicts. */
export const GET = defineRoute({ permission: 'marketing:module:access' }, async ({ db }) => ({
  policies: await listPolicySettings(db),
  conflicts: await listLegacyConflicts(db),
}));
