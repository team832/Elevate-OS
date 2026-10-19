import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { addVersion, versionBody } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — new immutable version. On an approved/scheduled item this voids the approval and reopens review. */
export const POST = defineRoute(
  { permission: 'marketing:content:write', params: idParams, body: versionBody },
  async ({ db, params, body, user, requestId }) =>
    created(await addVersion(db, user, params.id, body, requestId)),
);
