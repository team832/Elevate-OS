import { defineRoute, respond } from '@elevate/server-kit';
import { listStudents } from '../../../../server/students';
import { studentSearchQuery } from '../../../../server/students-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/students — Students by view (directory / active / on_hold / former); search by name or admission number, or by phone/email with ops:student_private:read (audited). */
export const GET = defineRoute(
  { permission: 'ops:students:read', query: studentSearchQuery },
  async ({ user, db, query, requestId }) => {
    const page = await listStudents(db, user, query, requestId);
    return respond(page.items, {
      meta: { page: { limit: query.limit, nextCursor: page.nextCursor }, total: page.total },
    });
  },
);
