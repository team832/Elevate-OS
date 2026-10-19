import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createCalendarRuleBody } from '../../../../server/schemas';
import { createCalendarRule } from '../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/calendar-rules — Add a weekly calendar rule to a batch. */
export const POST = defineRoute({ permission: 'academic:batches:write', body: createCalendarRuleBody }, async (ctx) => created(await createCalendarRule(ctx.db, actorOf(ctx), ctx.body)));
