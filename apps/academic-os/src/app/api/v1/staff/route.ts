import { defineRoute } from '@elevate/server-kit';
import { listStaff } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/staff — Active core staff (pickers; read-only use of core). */
export const GET = defineRoute({ permission: 'academic:assignments:write' }, async (ctx) => listStaff(ctx.db));
