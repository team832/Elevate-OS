import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { EmptyState, PageHeader, StatusBadge, Subnav } from '@elevate/shared-ui';
import { istToday } from '../../../domain/dates';
import { PAYROLL_MANAGE } from '../../../server/payroll';
import { payrollHome, type PayrollHome } from '../../../server/payroll-read';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { fmtDate, fmtMonth, fmtPaise, plural } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { API, BASE, PayrollRules, RunBadge } from './_components/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payroll' };

const VIEWS = [
  ['', 'Monthly payroll'],
  ['salaries', 'Salaries'],
  ['advances', 'Advances'],
  ['components', 'Earnings and deductions'],
] as const;
type View = (typeof VIEWS)[number][0];
type Props = { d: PayrollHome; manage: boolean; open?: string; today: string };
const viewHref = (view: View, open?: string) => listHref(BASE, { view: view || undefined, open });

/**
 * /ops/hr/payroll — payroll (F4-14): monthly runs, salaries, advances, and the earnings and
 * deductions the owner pays. Figures only for ops:payroll:manage / approve (checked in the service).
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:module:access', BASE);
  const sp = await searchParams;
  const view = VIEWS.find(([k]) => k === sp.view)?.[0] ?? '';
  return (
    <Frame access={access} active="hr-payroll">
      <PageHeader
        title="Payroll"
        description="Salaries, advances and each month's payroll. Only the people who prepare or approve payroll see these figures."
        tabs={
          <Subnav
            label="Payroll views"
            items={VIEWS.map(([k, label]) => [viewHref(k), label])}
            current={viewHref(view)}
          />
        }
      />
      <Section label="Loading payroll…">
        <Body user={access.user} view={view} open={sp.open} />
      </Section>
    </Frame>
  );
}

async function Body({ user, view, open }: { user: AuthenticatedUser; view: View; open?: string }) {
  const r = await load((db) => payrollHome(db, user));
  if (!r.ok) return r.view;
  const props = { d: r.data, manage: can(user, PAYROLL_MANAGE), open, today: istToday(new Date()) };
  const View = { '': Runs, salaries: Salaries, advances: Advances, components: Components }[view];
  return (
    <div className="el-stack">
      <View {...props} />
      <PayrollRules unpaidTypes={r.data.unpaidTypes} />
    </div>
  );
}

function Runs({ d, manage, today }: Props) {
  return (
    <>
      <RecordTable
        caption={plural(d.runs.length, 'monthly payroll')}
        rows={d.runs}
        rowKey={(r) => r.id}
        rowHref={(r) => `${BASE}/${r.id}`}
        linkColumn="month"
        sampleOf={(r) => r.isSample}
        empty={
          d.salaries.length
            ? 'No payroll yet. Start one for a month below.'
            : 'No payroll yet. Set salaries first (Salaries tab), then start a month.'
        }
        columns={[
          { key: 'month', header: 'Month', render: (r) => fmtMonth(r.month.slice(0, 7)) },
          { key: 'status', header: 'Status', render: (r) => <RunBadge status={r.status} /> },
          { key: 'payslips', header: 'Payslips', numeric: true },
          { key: 'net', header: 'Net pay', numeric: true, render: (r) => fmtPaise(r.netPaise) },
        ]}
      />
      {manage ? (
        <Segment
          title="Start a month's payroll"
          description="A draft is built from the salaries in force on the 1st, approved unpaid leave and advance instalments. You can add lines and rebuild it until you submit it."
        >
          <ActionForm
            action={`${API}/runs`}
            submitLabel="Start payroll"
            redirectTo={`${BASE}/{id}`}
            fields={[
              {
                name: 'month',
                label: 'Month (YYYY-MM)',
                defaultValue: today.slice(0, 7),
                required: true,
              },
            ]}
          />
        </Segment>
      ) : null}
    </>
  );
}

const money = (rows: PayrollHome['salaries'][number]['versions'][number]['lines']) =>
  rows.map((l) => `${l.label} ${fmtPaise(l.amountPaise)}`).join(' · ');

function Salaries({ d, manage, open, today }: Props) {
  const rows = d.salaries.map((s) => ({
    ...s,
    now: s.versions.find((v) => v.effectiveFrom <= today),
    next: s.versions.filter((v) => v.effectiveFrom > today).at(-1),
  }));
  const shown = rows.find((s) => s.staffId === open);
  const active = d.components.filter((c) => c.status === 'active');
  return (
    <>
      <RecordTable
        caption={plural(rows.length, 'staff member') + ' with a salary'}
        rows={rows}
        rowKey={(s) => s.staffId}
        rowHref={(s) => viewHref('salaries', s.staffId)}
        linkColumn="staff"
        sampleOf={(s) => s.isSample}
        empty="No salaries yet. Set one below."
        columns={[
          { key: 'staff', header: 'Staff member', render: (s) => s.staffName },
          {
            key: 'from',
            header: 'In force from',
            render: (s) => (s.now ? fmtDate(s.now.effectiveFrom) : 'Not yet'),
          },
          {
            key: 'gross',
            header: 'Monthly earnings',
            numeric: true,
            render: (s) => (s.now ? fmtPaise(s.now.earningsPaise) : '—'),
          },
          {
            key: 'deductions',
            header: 'Monthly deductions',
            numeric: true,
            render: (s) => (s.now ? fmtPaise(s.now.deductionsPaise) : '—'),
          },
          {
            key: 'next',
            header: 'Next change',
            render: (s) => (s.next ? `From ${fmtDate(s.next.effectiveFrom)}` : 'None'),
          },
        ]}
      />
      {shown ? (
        <RecordModal
          id="salary"
          title={shown.staffName}
          closeHref={viewHref('salaries')}
          returnId={shown.staffId}
        >
          {shown.versions.map((v) => (
            <Segment key={v.id} level={3} title={`From ${fmtDate(v.effectiveFrom)}`} flush>
              <DetailTable
                rows={[
                  {
                    label: 'Earnings',
                    value: money(v.lines.filter((l) => l.kind === 'earning')) || 'None',
                  },
                  {
                    label: 'Deductions',
                    value: money(v.lines.filter((l) => l.kind === 'deduction')) || 'None',
                  },
                  { label: 'Net per month', value: fmtPaise(v.netPaise) },
                  v.note && { label: 'Note', value: v.note },
                ]}
              />
            </Segment>
          ))}
        </RecordModal>
      ) : null}
      {manage ? (
        <Segment
          title="Set a salary"
          description="A salary is never edited: a change is a new salary from the 1st of a month, and the old one stays in the history. Leave a component blank if it is not paid."
        >
          {active.length ? (
            <ActionForm
              action={`${API}/structures`}
              submitLabel="Save salary"
              resetOnSuccess
              fields={[
                {
                  name: 'staffId',
                  label: 'Staff member',
                  type: 'select',
                  options: d.staff,
                  required: true,
                  section: 'Who and from when',
                },
                {
                  name: 'effectiveFrom',
                  label: 'From (the 1st of a month)',
                  type: 'date',
                  required: true,
                  section: 'Who and from when',
                },
                ...active.map((c): FieldSpec => ({
                  name: `lines.${c.id}`,
                  label: `${c.name} (per month)`,
                  type: 'money',
                  section: c.kind === 'earning' ? 'Earnings' : 'Deductions',
                })),
                { name: 'note', label: 'Note (optional)', type: 'textarea', section: 'Deductions' },
              ]}
            />
          ) : (
            <EmptyState
              title="Add earnings and deductions first"
              description="Salaries are made of the earnings and deductions you pay. Add them on the Earnings and deductions tab."
            />
          )}
        </Segment>
      ) : null}
    </>
  );
}

function advanceState(a: PayrollHome['advances'][number], today: string) {
  if (a.cancelledAt) return <StatusBadge>Cancelled</StatusBadge>;
  if (a.remainingPaise <= 0) return <StatusBadge tone="success">Recovered</StatusBadge>;
  if (a.recoverFrom > today)
    return <StatusBadge tone="info">From {fmtMonth(a.recoverFrom.slice(0, 7))}</StatusBadge>;
  return <StatusBadge tone="warning">Recovering</StatusBadge>;
}

function Advances({ d, manage, open, today }: Props) {
  const shown = d.advances.find((a) => a.id === open);
  return (
    <>
      <RecordTable
        caption={plural(d.advances.length, 'salary advance')}
        rows={d.advances}
        rowKey={(a) => a.id}
        rowHref={(a) => viewHref('advances', a.id)}
        linkColumn="staff"
        sampleOf={(a) => a.isSample || Boolean(a.sampleStaff)}
        empty="No salary advances recorded."
        columns={[
          { key: 'staff', header: 'Staff member', render: (a) => a.staffName },
          { key: 'given', header: 'Given on', render: (a) => fmtDate(a.givenOn) },
          {
            key: 'amount',
            header: 'Advance',
            numeric: true,
            render: (a) => fmtPaise(a.amountPaise),
          },
          {
            key: 'instalment',
            header: 'Per month',
            numeric: true,
            render: (a) => fmtPaise(a.monthlyInstalmentPaise),
          },
          {
            key: 'remaining',
            header: 'Still to recover',
            numeric: true,
            render: (a) => fmtPaise(Math.max(0, a.remainingPaise)),
          },
          { key: 'state', header: 'Status', render: (a) => advanceState(a, today) },
        ]}
      />
      {shown ? (
        <RecordModal
          id="advance"
          title={`Advance to ${shown.staffName}`}
          meta={advanceState(shown, today)}
          closeHref={viewHref('advances')}
          returnId={shown.id}
        >
          <DetailTable
            rows={[
              { label: 'Given on', value: fmtDate(shown.givenOn) },
              { label: 'Advance', value: fmtPaise(shown.amountPaise) },
              {
                label: 'Recovered per month',
                value: `${fmtPaise(shown.monthlyInstalmentPaise)} from ${fmtMonth(shown.recoverFrom.slice(0, 7))}`,
              },
              { label: 'Recovered in approved payroll', value: fmtPaise(shown.recoveredPaise) },
              { label: 'Why', value: shown.reason },
              shown.reference && { label: 'Reference', value: shown.reference },
              shown.cancelReason && { label: 'Cancelled because', value: shown.cancelReason },
            ]}
          />
          {manage && !shown.cancelledAt && shown.remainingPaise > 0 ? (
            <ActionForm
              action={`${API}/advances/${shown.id}`}
              submitLabel="Cancel this advance"
              successText="Cancelled. Nothing more is recovered."
              variant="danger"
              fields={[
                {
                  name: 'reason',
                  label: 'Why (recoveries already in payroll stay)',
                  type: 'textarea',
                  required: true,
                },
              ]}
            />
          ) : null}
        </RecordModal>
      ) : null}
      {manage ? (
        <Segment
          title="Record an advance"
          description="Recovered from each month's payroll from the month you choose, until nothing is left."
        >
          <ActionForm
            action={`${API}/advances`}
            submitLabel="Record advance"
            resetOnSuccess
            fields={[
              {
                name: 'staffId',
                label: 'Staff member',
                type: 'select',
                options: d.staff,
                required: true,
              },
              {
                name: 'givenOn',
                label: 'Given on',
                type: 'date',
                required: true,
                defaultValue: today,
              },
              { name: 'amount', label: 'Advance (₹)', type: 'money', required: true },
              {
                name: 'monthlyInstalment',
                label: 'Recover per month (₹)',
                type: 'money',
                required: true,
              },
              {
                name: 'recoverFrom',
                label: 'First month of recovery (the 1st)',
                type: 'date',
                required: true,
              },
              { name: 'reference', label: 'Payment reference (optional)' },
              { name: 'reason', label: 'Why', type: 'textarea', required: true },
            ]}
          />
        </Segment>
      ) : null}
    </>
  );
}

function Components({ d, manage }: Props) {
  return (
    <>
      <RecordTable
        caption={`Earnings and deductions: ${d.components.length}`}
        rows={d.components}
        rowKey={(c) => c.id}
        empty="Nothing yet. Add what you pay and deduct, for example Basic pay and House rent allowance (earnings) or Professional tax (a deduction). PF, ESI and TDS are not worked out for you: add them as deductions with the amounts you set."
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'code', header: 'Code' },
          {
            key: 'kind',
            header: 'Type',
            render: (c) => (c.kind === 'earning' ? 'Earning' : 'Deduction'),
          },
          {
            key: 'status',
            header: 'Status',
            render: (c) => (c.status === 'active' ? 'In use' : 'Retired: no new salaries'),
          },
          ...(manage
            ? [
                {
                  key: 'action',
                  header: 'Change',
                  render: (c: PayrollHome['components'][number]) => (
                    <ActionForm
                      action={`${API}/components/${c.id}`}
                      method="PATCH"
                      extra={{ status: c.status === 'active' ? 'retired' : 'active' }}
                      submitLabel={c.status === 'active' ? 'Retire' : 'Use again'}
                      labelSuffix={` ${c.name}`}
                      variant="secondary"
                      compact
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      {manage ? (
        <Segment
          title="Add an earning or deduction"
          description="Its amount is set per person on their salary."
        >
          <ActionForm
            action={`${API}/components`}
            submitLabel="Add"
            resetOnSuccess
            fields={[
              { name: 'name', label: 'Name, as printed on payslips', required: true },
              {
                name: 'code',
                label: 'Short code (e.g. basic, hra)',
                required: true,
                hint: 'Lower-case letters, digits or _; cannot be changed later.',
              },
              {
                name: 'kind',
                label: 'Type',
                type: 'select',
                required: true,
                options: [
                  { value: 'earning', label: 'Earning' },
                  { value: 'deduction', label: 'Deduction' },
                ],
              },
            ]}
          />
        </Segment>
      ) : null}
    </>
  );
}
