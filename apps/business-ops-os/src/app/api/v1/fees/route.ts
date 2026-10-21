import { created, defineRoute, respond } from '@elevate/server-kit';
import { feeListQuery } from '../../../../server/admissions-schemas';
import { feeChargeBody, listFeeRecords, recordFee } from '../../../../server/fees';

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

/** POST /ops/api/v1/fees — Registration or demo charge, payment, discount or waiver (outside the tuition split, D-039). */
export const POST = defineRoute(
  { permission: 'ops:fees:record', body: feeChargeBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => {
    const { admissionId, ...entry } = body;
    return created(await recordFee(db, user, admissionId, entry, requestId));
  },
);
