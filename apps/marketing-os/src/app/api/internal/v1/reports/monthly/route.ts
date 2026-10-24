import { defineInternalRoute } from '@elevate/server-kit';
import {
  buildMonthlySnapshot,
  monthlySnapshotQuery,
  staffActor,
} from '../../../../../../server/monthly-report';

export const dynamic = 'force-dynamic';

/**
 * GET /marketing/api/internal/v1/reports/monthly?staffId&month=YYYY-MM&cutoffAt →
 * MarketingMonthlySnapshotV1, for Business Ops to freeze into a monthly work report version.
 * Server-to-server only (caller ops). Lead facts are read as the person themselves.
 */
export const GET = defineInternalRoute(
  { callers: ['ops'], query: monthlySnapshotQuery },
  async ({ db, query }) =>
    buildMonthlySnapshot(db, await staffActor(db, query.staffId), {
      staffId: query.staffId,
      month: query.month,
      cutoffAt: query.cutoffAt ? new Date(query.cutoffAt) : undefined,
    }),
);
