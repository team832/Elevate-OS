import type { Metadata } from 'next';
import { formatPaise, MANUAL_FEE_DISCLAIMER } from '@elevate/business-ops-os/domain';
import { portalFees, receiptFor } from '@elevate/business-ops-os/server';
import { getDb } from '@elevate/database';
import { fmtDay } from '@elevate/shared-types';
import { Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { portalPage } from '../../../server/portal';
import { PortalClosed, PortalFrame } from '../../../ui/portal-frame';

export const metadata: Metadata = { title: 'Fees' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ student?: string | string[] }>;
const money = (paise: number) => formatPaise(paise).replace(/\.00$/, '');
const FOR = { tuition: 'Tuition', registration: 'Registration', demo: 'Demo classes' } as const;

export default async function PortalFees({ searchParams }: { searchParams: Params }) {
  const view = await portalPage('/portal/fees', (await searchParams).student);
  if (view.closed) return <PortalClosed />;
  const db = getDb();
  const f = await portalFees(db, view.child.id);
  const withReceipt = new Set<string>();
  for (const p of f.payments) if (await receiptFor(db, p.id)) withReceipt.add(p.id);
  return (
    <PortalFrame
      view={view}
      path="/portal/fees"
      title="Fees"
      description={`${view.child.fullName}. ${MANUAL_FEE_DISCLAIMER}`}
    >
      {f.agreements.length === 0 ? (
        <EmptyState
          title="No fee agreement recorded"
          description="Ask Elevate Education if you expected one here."
        />
      ) : (
        f.agreements.map((a) => (
          <Card key={a.id} title={a.label} meta={<StatusBadge>{a.status}</StatusBadge>}>
            <dl className="portal-facts">
              <dt>Academic year</dt>
              <dd>{a.academicYear ?? 'Not recorded'}</dd>
              <dt>Agreed total</dt>
              <dd>{money(a.totals.totalPaise)}</dd>
              <dt>Paid so far</dt>
              <dd>{money(a.totals.netPaidPaise)}</dd>
              <dt>Still to pay</dt>
              <dd>{money(a.totals.outstandingPaise)}</dd>
            </dl>
            <DataTable
              caption="Instalments"
              rows={a.instalments}
              rowKey={(i) => i.id}
              empty={<EmptyState title="No instalments recorded" />}
              columns={[
                { key: 'n', header: 'No.', numeric: true, render: (i) => i.sequence },
                { key: 'due', header: 'Due', render: (i) => fmtDay(i.dueDate) },
                {
                  key: 'amount',
                  header: 'Amount',
                  numeric: true,
                  render: (i) => money(i.amountPaise),
                },
                { key: 'paid', header: 'Paid', numeric: true, render: (i) => money(i.paidPaise) },
                {
                  key: 'left',
                  header: 'Left to pay',
                  numeric: true,
                  render: (i) => money(i.remainingPaise),
                },
                { key: 'status', header: 'Status', render: (i) => i.status },
              ]}
            />
          </Card>
        ))
      )}
      <Card title="Payments received">
        <DataTable
          rows={f.payments}
          rowKey={(p) => p.id}
          empty={<EmptyState title="No payment recorded" />}
          columns={[
            { key: 'date', header: 'Date', render: (p) => fmtDay(p.paymentDate) },
            { key: 'amount', header: 'Amount', numeric: true, render: (p) => money(p.amountPaise) },
            { key: 'for', header: 'For', render: (p) => FOR[p.chargeCategory] },
            {
              key: 'receipt',
              header: 'Receipt',
              render: (p) =>
                withReceipt.has(p.id) ? (
                  <a href={`/api/v1/portal/receipts/${p.id}`}>Download receipt (PDF)</a>
                ) : (
                  'No receipt issued yet'
                ),
            },
          ]}
        />
      </Card>
    </PortalFrame>
  );
}
