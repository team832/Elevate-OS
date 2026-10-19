import { defineRoute, respond } from '@elevate/server-kit';
import { studentListQuery } from '../../../../server/admissions-schemas';
import { listStudents } from '../../../../server/students';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/students — Admitted / awaiting / enrolled / withdrawn students (no private fields). */
export const GET = defineRoute(
  { permission: 'ops:students:read', query: studentListQuery },
  async ({ user, db, query }) => {
    const page = await listStudents(db, user, query);
    return respond(page.items, {
      meta: { page: { limit: query.limit, nextCursor: page.nextCursor } },
    });
  },
);
