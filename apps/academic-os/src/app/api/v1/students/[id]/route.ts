import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { getStudentRecord } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/students/:id — Student with enrolments. */
export const GET = defineRoute({ permission: 'academic:students:read', params: uuidParams }, async (ctx) => getStudentRecord(ctx.db, actorOf(ctx), ctx.params.id));
