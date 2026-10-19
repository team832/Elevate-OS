import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { answerKeyBody, uuidParams } from '../../../../../../server/schemas';
import { addAnswerKey } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assessments/:id/answer-keys — Add an answer-key version. */
export const POST = defineRoute({ permission: 'academic:assessments:write', params: uuidParams, body: answerKeyBody }, async (ctx) => created(await addAnswerKey(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)));
