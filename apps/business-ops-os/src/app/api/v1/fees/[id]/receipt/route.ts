import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { RECEIPT_SIZES } from '../../../../../../server/pdf/receipt';
import { pdfResponse } from '../../../../../../server/pdf/document';
import { issueReceipt, receiptPdfFor } from '../../../../../../server/receipts';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/fees/[id]/receipt?size=a4|a5 — the payment's receipt PDF (fee record readers; each print counts, the second says "Duplicate"). */
export const GET = defineRoute(
  {
    permission: 'ops:fees:read',
    params: idParams,
    query: z.object({ size: z.enum(RECEIPT_SIZES).default('a4') }),
  },
  async ({ user, db, params, query }) => {
    const { bytes, filename } = await receiptPdfFor(db, user, params.id, query.size);
    return pdfResponse(bytes, filename);
  },
);

/** POST — "Issue receipt" for a payment recorded without one; the same receipt again if it has one (201 when new). */
export const POST = defineRoute(
  {
    permission: 'ops:fees:record',
    params: idParams,
    body: z.strictObject({}),
    idempotency: 'optional',
  },
  async ({ user, db, params, requestId }) => {
    const r = await issueReceipt(db, user, params.id, requestId);
    return r.created ? created(r.receipt) : r.receipt;
  },
);
