import { defineRoute } from '@elevate/server-kit';
import { uuidParams } from '../../../../../server/schemas';
import { getCourse } from '../../../../../server/services/curriculum';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/courses/:id — course with subjects, chapters and plan versions. */
export const GET = defineRoute({ permission: 'academic:courses:read', params: uuidParams }, async ({ db, params }) =>
  getCourse(db, params.id),
);
