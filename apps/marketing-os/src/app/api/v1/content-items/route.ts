import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { CONTENT_STATES } from '../../../../domain';
import { listContentItems } from '../../../../server';

export const dynamic = 'force-dynamic';

const query = z.object({ state: z.enum(CONTENT_STATES).optional() });

/** GET /marketing/api/v1/content-items?state= — non-archived items by default. */
export const GET = defineRoute(
  { permission: 'marketing:content:read', query },
  async ({ db, query }) => listContentItems(db, { state: query.state }),
);
