import { defineRoute } from '@elevate/server-kit';
import { listBlockedProjects } from '../../../../../server/planning';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/projects/blocked — Live projects with block reasons (on hold, missed milestone, blocked tasks, open blockers). */
export const GET = defineRoute({ permission: 'ops:risks:read' }, async ({ user, db }) =>
  listBlockedProjects(db, user),
);
