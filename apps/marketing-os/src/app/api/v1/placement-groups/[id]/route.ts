import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { getPlacementGroup } from '../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** GET — the group, its placements and a fresh collab-rule validation. */
export const GET = defineRoute(
  { permission: 'marketing:content:read', params: idParams },
  async ({ db, params }) => getPlacementGroup(db, params.id),
);
