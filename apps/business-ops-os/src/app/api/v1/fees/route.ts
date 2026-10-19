import { defineRoute, respond } from '@elevate/server-kit';
import { feeListQuery } from '../../../../server/admissions-schemas';
import { listFeeRecords } from '../../../../server/fees';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/fees — Fee records across admissions, newest first (cursor = last code). */
export const GET = defineRoute(
  { permission: 'ops:fees:read', query: feeListQuery },
  async ({ user, db, query }) => {
    const page = await listFeeRecords(db, user, query);
    return respond(
      { items: page.items, disclaimer: page.disclaimer },
      { meta: { page: { limit: query.limit, nextCursor: page.nextCursor } } },
    );
  },
);
