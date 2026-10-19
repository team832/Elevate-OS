import { scopeFor } from '@elevate/authorization';
import { defineRoute } from '@elevate/server-kit';
import { ForbiddenError } from '@elevate/shared-contracts';
import { runLifecycleReminders } from '../../../../../../server/hr/onboarding';
import { runSeparations } from '../../../../../../server/hr/offboarding';
import { lifecycleJobBody } from '../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/hr/lifecycle-cases/jobs — run an HR lifecycle job by hand until a
 * scheduler exists: `lifecycle-reminders` (overdue checklist items, once per IST day)
 * or `separations` (apply approved separations whose last working day has passed and
 * complete access-revocation items). Both are idempotent.
 */
export const POST = defineRoute(
  { permission: 'ops:lifecycle:approve', body: lifecycleJobBody },
  async ({ user, db, body }) => {
    if (scopeFor(user, 'ops:lifecycle:approve') !== 'all')
      throw new ForbiddenError('Only organisation-wide lifecycle approvers can run these jobs.');
    return body.job === 'lifecycle-reminders' ? runLifecycleReminders(db) : runSeparations(db);
  },
);
