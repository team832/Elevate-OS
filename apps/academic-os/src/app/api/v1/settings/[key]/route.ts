import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { settingBody, settingParams } from '../../../../../server/schemas';
import { updateSetting } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** PUT /academic/api/v1/settings/:key — Change a configurable rule (audited). */
export const PUT = defineRoute({ permission: 'academic:settings:manage', params: settingParams, body: settingBody }, async (ctx) => updateSetting(ctx.db, actorOf(ctx), ctx.params.key, ctx.body));
