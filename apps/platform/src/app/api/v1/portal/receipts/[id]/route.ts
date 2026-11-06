import { portalReceipt } from '../../../../../../server/portal';

export const dynamic = 'force-dynamic';

/** GET /api/v1/portal/receipts/[feeRecordId] — a linked student's receipt PDF; anything else 404. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return portalReceipt(request, (await params).id);
}
