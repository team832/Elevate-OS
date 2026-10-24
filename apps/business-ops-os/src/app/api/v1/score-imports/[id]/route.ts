import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../server/schemas';
import { importReview } from '../../../../../server/score-import';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/score-imports/:id: the staged rows, their matches and the test with its roster. */
export const GET = defineRoute(
  { permission: 'ops:assessments:read', params: idParams },
  async ({ db, user, params }) => importReview(db, user, params.id),
);
