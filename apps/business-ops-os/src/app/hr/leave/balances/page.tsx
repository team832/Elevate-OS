import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { listLeaveBalances, listLeaveTypes, listLedger } from '../../../../server/hr/leave';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { EmployeeFilter, FilterForm, TimeNav, type Sp } from '../../attendance/time-ui';

export const dynamic = 'force-dynamic';

export default async function BalancesPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const access = await gate('ops:leave:read', '/ops/hr/leave/balances');
  const sp = await searchParams;
  return (
    <Frame access={access} active="leave">
      <PageHeader
        title="Leave balances"
        description="Balances are a ledger of allocations, adjustments, usage and reversals. Without an allocation the balance is “not configured”, not zero."
      />
      <TimeNav current="/ops/hr/leave/balances" user={access.user} />
      <Alert tone="warning" title="Entitlements are not decided">
        Accrual, carry-forward, encashment and yearly entitlements are an open owner decision
        (OD-026). Nothing is accrued automatically and requests are not blocked by balance.
      </Alert>
      <Section label="Loading balances…">
        <Balances user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Balances({ user, sp }: { user: AuthenticatedUser; sp: Sp }) {
  const r = await load(async (db) => {
    const all = await listLeaveBalances(db, user, {});
    const selected = sp.staffId && all.some((p) => p.staffId === sp.staffId) ? sp.staffId : null;
    return {
      all,
      selected,
      ledger: selected ? await listLedger(db, user, selected) : [],
      types: await listLeaveTypes(db, user),
    };
  });
  if (!r.ok) return r.view;
  const { all, selected, ledger, types } = r.data;
  const shown = selected ? all.filter((p) => p.staffId === selected) : all;
  const manage = can(user, 'ops:leave:manage');
  return (
    <div className="el-stack">
      <FilterForm action="/ops/hr/leave/balances" submitLabel="Show employee">
        <EmployeeFilter people={all} value={sp.staffId} />
      </FilterForm>
      <DataTable
        rows={shown}
        rowKey={(p) => p.staffId}
        empty={<EmptyState title="No employees in your scope" />}
        columns={[
          {
            key: 'name',
            header: 'Employee',
            render: (p) => <a href={`/ops/hr/leave/balances?staffId=${p.staffId}`}>{p.fullName}</a>,
          },
          {
            key: 'balances',
            header: 'Balances (days)',
            render: (p) =>
              p.balances.length === 0
                ? 'No leave types recorded'
                : p.balances.map((b) => (
                    <span key={b.leaveTypeId}>
                      {b.code}:{' '}
                      {b.balance.status === 'configured' ? (
                        <strong>{b.balance.balance}</strong>
                      ) : (
                        <StatusBadge tone="neutral">Not configured</StatusBadge>
                      )}{' '}
                    </span>
                  )),
          },
        ]}
      />
      {selected ? (
        <div className="el-grid">
          <Card title="Ledger">
            <DataTable
              rows={ledger}
              rowKey={(l) => l.id}
              empty={<EmptyState title="No ledger entries" />}
              columns={[
                { key: 'date', header: 'Effective', render: (l) => fmtDate(l.effectiveDate) },
                { key: 'type', header: 'Leave type', render: (l) => l.typeCode },
                { key: 'entry', header: 'Entry', render: (l) => l.entryType },
                { key: 'days', header: 'Days', numeric: true, render: (l) => l.days },
                { key: 'req', header: 'Request', render: (l) => l.requestCode ?? '—' },
                { key: 'note', header: 'Note', render: (l) => l.note ?? '' },
                { key: 'at', header: 'Recorded', render: (l) => fmtDateTime(l.createdAt) },
              ]}
            />
          </Card>
          {manage ? (
            <Card
              title="Record an allocation or adjustment"
              description="Recorded by HR from the owner’s decision; you cannot change your own balance."
            >
              {types.length === 0 ? (
                <EmptyState title="Record a leave type first" />
              ) : (
                <ActionForm
                  action="/ops/api/v1/hr/leave-balances"
                  submitLabel="Add ledger entry"
                  extra={{ staffId: selected }}
                  fields={[
                    {
                      name: 'leaveTypeId',
                      label: 'Leave type',
                      type: 'select',
                      required: true,
                      options: types.map((t) => ({ value: t.id, label: t.name })),
                    },
                    {
                      name: 'entryType',
                      label: 'Entry',
                      type: 'select',
                      required: true,
                      defaultValue: 'allocation',
                      options: [
                        { value: 'allocation', label: 'Allocation (adds days)' },
                        { value: 'adjustment', label: 'Adjustment (+ or −)' },
                      ],
                    },
                    { name: 'days', label: 'Days (steps of 0.5)', type: 'number', required: true },
                    {
                      name: 'effectiveDate',
                      label: 'Effective date',
                      type: 'date',
                      required: true,
                    },
                    { name: 'periodLabel', label: 'Period label (optional)', hint: 'e.g. 2026–27' },
                    { name: 'note', label: 'Why', required: true },
                  ]}
                />
              )}
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
