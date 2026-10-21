import { defineRoute } from '@elevate/server-kit';
import { checkDuplicates } from '../../../../../server/lead-duplicates';
import { duplicateCheckBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/check-duplicates — Preview duplicate warnings for contact details (nothing is saved). */
export const POST = defineRoute(
  { permission: 'ops:leads:write', body: duplicateCheckBody },
  async ({ user, db, body }) => checkDuplicates(db, user, body),
);
