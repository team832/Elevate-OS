import { defineRoute } from '@elevate/server-kit';
import { listProgrammes } from '../../../../server/services/curriculum';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/programmes — core programme catalogue (read). */
export const GET = defineRoute({ permission: 'academic:courses:read' }, async ({ db }) => listProgrammes(db));
