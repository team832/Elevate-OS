import { created, defineRoute } from '@elevate/server-kit';
import { addLedgerEntry, listLeaveBalances } from '../../../../../server/hr/leave';
import { balanceQuery, ledgerEntryBody } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/leave-balances — balances per employee and type ("not configured" without allocation). */
export const GET = defineRoute(
  { permission: 'ops:leave:read', query: balanceQuery },
  async ({ user, db, query }) => listLeaveBalances(db, user, query),
);

/** POST /ops/api/v1/hr/leave-balances — ledger allocation or adjustment (never for oneself). */
export const POST = defineRoute(
  { permission: 'ops:leave:manage', body: ledgerEntryBody },
  async ({ user, db, body, requestId }) => created(await addLedgerEntry(db, user, body, requestId)),
);
