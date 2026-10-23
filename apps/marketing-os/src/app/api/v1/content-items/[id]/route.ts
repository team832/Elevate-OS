import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { getContentItemDetail } from '../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** GET /marketing/api/v1/content-items/:id — versions, rule check, approvals, comments, placements. */
export const GET = defineRoute(
  { permission: 'marketing:content:read', params: idParams },
  async ({ db, params, user }) => getContentItemDetail(db, params.id, user),
);
