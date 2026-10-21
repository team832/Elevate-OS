import { defineRoute } from '@elevate/server-kit';
import { teacherListQuery } from '../../../../server/appointments-schemas';
import { listTeachers } from '../../../../server/teachers';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/teachers — Directory, optionally by subject / programme (the teacher picker). */
export const GET = defineRoute(
  { permission: 'ops:teachers:read', query: teacherListQuery },
  async ({ user, db, query }) => listTeachers(db, user, query),
);
