import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { getAccountById, updateAccount, updateAccountBody } from '../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** GET /marketing/api/v1/accounts/:id */
export const GET = defineRoute(
  { permission: 'marketing:accounts:read', params: idParams },
  async ({ db, params }) => getAccountById(db, params.id),
);

/** PATCH /marketing/api/v1/accounts/:id — owner, confirmed handle, cadence, rules (not integration status). */
export const PATCH = defineRoute(
  { permission: 'marketing:accounts:manage', params: idParams, body: updateAccountBody },
  async ({ db, params, body, user, requestId }) =>
    updateAccount(db, user, params.id, body, requestId),
);
