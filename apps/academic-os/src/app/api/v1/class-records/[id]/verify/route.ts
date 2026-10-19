import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { verifyClassRecord } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/class-records/:id/verify — Coordinator verifies a submitted record. */
export const POST = defineRoute({ permission: 'academic:classes:verify', params: uuidParams }, async (ctx) => verifyClassRecord(ctx.db, actorOf(ctx), ctx.params.id));
