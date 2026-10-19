import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createStudentBody, studentsQuery } from '../../../../server/schemas';
import { createStudent, listStudents } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/students — Students (teachers: students of their batches; contacts hidden). */
export const GET = defineRoute({ permission: 'academic:students:read', query: studentsQuery }, async (ctx) => listStudents(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/students — Create a student record by hand. */
export const POST = defineRoute({ permission: 'academic:students:write', body: createStudentBody }, async (ctx) => created(await createStudent(ctx.db, actorOf(ctx), ctx.body)));
