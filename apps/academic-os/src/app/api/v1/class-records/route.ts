import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { classRecordsQuery, recordClassBody } from '../../../../server/schemas-teaching';
import { listClassRecords, recordClass } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/class-records?batchId&teacherStaffId&state&from&to — Teaching log (teachers: own sessions; drafts only to their author). */
export const GET = defineRoute({ permission: 'academic:classes:read', query: classRecordsQuery }, async (ctx) => listClassRecords(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/class-records — Save a draft log, or submit it (`submit: true`, session must be marked delivered). */
export const POST = defineRoute({ permission: 'academic:classes:record', body: recordClassBody }, async (ctx) => created(await recordClass(ctx.db, actorOf(ctx), ctx.body)));
