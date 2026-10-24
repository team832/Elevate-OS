import { defineRoute } from '@elevate/server-kit';
import {
  getMyPreferences,
  preferencesBody,
  saveMyPreferences,
} from '../../../../../server/preferences';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/settings/personal — the caller's own Personal Settings (defaults when none saved). */
export const GET = defineRoute({ permission: 'marketing:module:access' }, async ({ db, user }) =>
  getMyPreferences(db, user),
);

/** PUT /marketing/api/v1/settings/personal — replace the caller's own settings; no user id is accepted. */
export const PUT = defineRoute(
  { permission: 'marketing:module:access', body: preferencesBody },
  async ({ db, user, body, requestId }) => {
    await saveMyPreferences(db, user, body, requestId);
    return getMyPreferences(db, user);
  },
);
