import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { substituteBody } from '../../../../../../server/schemas-sessions';
import { assignSubstitute } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/sessions/:id/substitute — Authorise a substitute; the original teacher stays on record. */
export const POST = defineRoute({ permission: 'academic:timetable:publish', params: uuidParams, body: substituteBody }, async (ctx) => created(await assignSubstitute(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)));
