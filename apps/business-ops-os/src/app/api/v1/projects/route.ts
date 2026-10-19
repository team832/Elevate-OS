import { created, defineRoute } from '@elevate/server-kit';
import { createProject, listProjects } from '../../../../server/planning';
import { projectBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/projects — Projects with milestones. */
export const GET = defineRoute({ permission: 'ops:risks:read' }, async ({ user, db }) =>
  listProjects(db, user),
);

/** POST /ops/api/v1/projects — Create a project. */
export const POST = defineRoute(
  { permission: 'ops:risks:write', body: projectBody },
  async ({ user, db, body, requestId }) => created(await createProject(db, user, body, requestId)),
);
