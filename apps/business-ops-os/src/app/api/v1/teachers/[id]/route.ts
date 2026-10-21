import { defineRoute } from '@elevate/server-kit';
import { teacherUpdateBody } from '../../../../../server/appointments-schemas';
import { idParams } from '../../../../../server/schemas';
import { getTeacherProfile, updateTeacher } from '../../../../../server/teachers';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/teachers/:id — Teacher profile (sections by permission). */
export const GET = defineRoute(
  { permission: 'ops:teachers:read', params: idParams },
  async ({ user, db, params }) => getTeacherProfile(db, user, params.id),
);

/** PATCH /ops/api/v1/teachers/:id — Display name, staff ref, verification, role note, subjects. */
export const PATCH = defineRoute(
  { permission: 'ops:teachers:manage', params: idParams, body: teacherUpdateBody },
  async ({ user, db, params, body, requestId }) =>
    updateTeacher(db, user, params.id, body, requestId),
);
