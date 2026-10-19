import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { correctClassBody, uuidParams } from '../../../../../../server/schemas';
import { correctClassRecord } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/class-records/:id/correct — Audited correction; the original is preserved as superseded. */
export const POST = defineRoute({ permission: 'academic:classes:verify', params: uuidParams, body: correctClassBody }, async (ctx) => created(await correctClassRecord(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)));
