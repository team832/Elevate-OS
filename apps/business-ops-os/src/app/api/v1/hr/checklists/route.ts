import { created, defineRoute } from '@elevate/server-kit';
import { checklistStartBody, startChecklist } from '../../../../../server/hr-staff-records';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/checklists — start a staff member's joining or leaving checklist (F4-09). */
export const POST = defineRoute(
  { permission: 'ops:staff:manage', body: checklistStartBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await startChecklist(db, user, body, requestId)),
);
