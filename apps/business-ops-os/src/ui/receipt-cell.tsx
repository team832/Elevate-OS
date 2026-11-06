/**
 * A payment's receipt in a ledger table (F4-01): its number with A4 and A5 downloads, or "Issue
 * receipt" for an older payment recorded before receipts existed. Other entries show nothing.
 * The table loads its receipts once (server/receipts.ts receiptsOf).
 */
import type { Receipt } from '../server/receipts';
import { ActionForm } from './action-form';

export function ReceiptCell({
  entry,
  receipt,
  canIssue,
}: {
  entry: { id: string; code: string; kind: string; reversesRecordId: string | null };
  receipt: Receipt | undefined;
  /** `ops:fees:record`, and the payment still counts (not reversed or voided). */
  canIssue: boolean;
}) {
  if (entry.kind !== 'received' || entry.reversesRecordId) return null;
  const api = `/ops/api/v1/fees/${entry.id}/receipt`;
  if (receipt) {
    const hidden = <span className="el-visually-hidden"> receipt {receipt.receiptNumber}</span>;
    return (
      <>
        {receipt.receiptNumber}
        <br />
        <a href={api}>A4{hidden}</a> · <a href={`${api}?size=a5`}>A5{hidden}</a>
      </>
    );
  }
  return canIssue ? (
    <ActionForm
      action={api}
      submitLabel="Issue receipt"
      labelSuffix={` for ${entry.code}`}
      successText="Receipt issued."
      compact
      variant="secondary"
    />
  ) : (
    'None issued'
  );
}
