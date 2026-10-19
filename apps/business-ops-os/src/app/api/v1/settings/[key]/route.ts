import { defineRoute } from '@elevate/server-kit';
import { updateSetting } from '../../../../../server/settings';
import { settingBody, settingParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/settings/[key] — Change a configurable value (stays proposed). */
export const PUT = defineRoute(
  { permission: 'ops:settings:manage', params: settingParams, body: settingBody },
  async ({ user, db, params, body, requestId }) =>
    updateSetting(db, user, { key: params.key, value: body.value, note: body.note }, requestId),
);
