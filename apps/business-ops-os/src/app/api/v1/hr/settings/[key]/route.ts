import { defineRoute } from '@elevate/server-kit';
import { updateHrSetting } from '../../../../../../server/hr-settings';
import { settingBody, settingParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/hr/settings/[key] — Change an HR, report or feedback setting (stays proposed). */
export const PUT = defineRoute(
  { permission: 'ops:hr_settings:manage', params: settingParams, body: settingBody },
  async ({ user, db, params, body, requestId }) =>
    updateHrSetting(db, user, { key: params.key, value: body.value, note: body.note }, requestId),
);
