import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createCourseBody } from '../../../../server/schemas';
import { createCourse, listCourses } from '../../../../server/services/curriculum';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/courses */
export const GET = defineRoute({ permission: 'academic:courses:read' }, async ({ db }) => listCourses(db));

/** POST /academic/api/v1/courses — a course version under a core programme. */
export const POST = defineRoute(
  { permission: 'academic:courses:write', body: createCourseBody },
  async (ctx) => created(await createCourse(ctx.db, actorOf(ctx), ctx.body)),
);
