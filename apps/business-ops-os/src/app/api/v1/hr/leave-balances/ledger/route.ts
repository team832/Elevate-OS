import { defineRoute } from '@elevate/server-kit';
import { listLedger } from '../../../../../../server/hr/leave';
import { ledgerQuery } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/leave-balances/ledger?staffId — ledger history of one employee. */
export const GET = defineRoute(
  { permission: 'ops:leave:read', query: ledgerQuery },
  async ({ user, db, query }) => listLedger(db, user, query.staffId),
);
