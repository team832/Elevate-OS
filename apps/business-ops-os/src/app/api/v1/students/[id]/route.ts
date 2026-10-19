import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../server/schemas';
import { getStudent } from '../../../../../server/students';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/students/[id] — Student profile by admission id; private fields need ops:student_private:read. */
export const GET = defineRoute(
  { permission: 'ops:students:read', params: idParams },
  async ({ user, db, params }) => getStudent(db, user, params.id),
);
