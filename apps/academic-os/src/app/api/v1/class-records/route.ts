import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { classRecordsQuery, recordClassBody } from '../../../../server/schemas';
import { listClassRecords, recordClass } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/class-records — Teaching log (teachers: own sessions). */
export const GET = defineRoute({ permission: 'academic:classes:read', query: classRecordsQuery }, async (ctx) => listClassRecords(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/class-records — Log what was taught in a held session (teachers: own sessions). */
export const POST = defineRoute({ permission: 'academic:classes:record', body: recordClassBody }, async (ctx) => created(await recordClass(ctx.db, actorOf(ctx), ctx.body)));
