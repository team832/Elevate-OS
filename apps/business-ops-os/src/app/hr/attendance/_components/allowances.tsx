/**
 * Leave balances (F4-12): the HR "Leave allowances" tab (a year's balances for the staff HR manages,
 * with the forms that set allowances, carry-forwards and adjustments) and the small balance table
 * shown on My attendance, the leave form and the staff record.
 */
import { ROLES } from '@elevate/authorization';
import { Subnav } from '@elevate/shared-ui';
import { ROLE_KEYS } from '@elevate/shared-types';
import { balanceText, daysText, type LeaveBalance } from '../../../../domain/leave-balance';
import type { AllowanceSheet, Balances } from '../../../../server/leave-balances';
import { ActionForm } from '../../../../ui/action-form';
import { ExportLink } from '../../../../ui/export-link';
import { listHref } from '../../../../ui/list-controls';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../ui/sections';
import { API, BASE } from './days';

/** What makes up the balance, or what was taken when none is kept. */
const breakdown = (b: LeaveBalance) =>
  b.state === 'set'
    ? `Allowance ${b.allowance}, carried forward ${b.carried}, adjusted ${b.adjusted}, taken ${b.taken}`
    : b.taken
      ? `${daysText(b.taken)} taken this year`
      : '';

function BalanceCell({ b }: { b: LeaveBalance }) {
  const more = breakdown(b);
  return (
    <>
      {balanceText(b)}
      {more ? <p className="el-field-hint">{more}</p> : null}
    </>
  );
}

/** One person's balances for the leave year. */
export function BalanceList({ data }: { data: Balances }) {
  return (
    <DetailTable
      caption={`Leave balance, leave year ${data.year.label}`}
      rows={data.balances.map(({ type, balance }) => ({
        label: type,
        value: <BalanceCell b={balance} />,
      }))}
    />
  );
}

export const balanceTitle = (data: Balances) => `Leave balance, ${data.year.label}`;

const EXPLAIN = (
  <details className="el-explain">
    <summary>How balances are worked out</summary>
    <p>
      Balance = the year&apos;s allowance + days carried forward + adjustments − approved leave of
      that type in the year. Days are calendar days and a half day counts 0.5. With no allowance set
      there is no balance, and nothing is checked; that is not 0 days. Types in the setting
      &quot;Leave types without a balance&quot; never use one. Asking for more than the balance warns
      HR, or is refused, as the setting &quot;Leave balances&quot; says. These rules are proposed
      until the owner approves them.
    </p>
  </details>
);

const ROLE_OPTIONS = ROLE_KEYS.filter((r) => r !== 'student' && r !== 'guardian').map((r) => ({
  value: r,
  label: ROLES[r].label,
}));

/** /ops/hr/attendance?tab=allowances&yearStart=2026-04-01 */
export function AllowancesTab({
  sheet,
  canManage,
  staffOptions,
}: {
  sheet: AllowanceSheet;
  canManage: boolean;
  staffOptions: readonly { value: string; label: string }[];
}) {
  const yearHref = (start: string) => listHref(BASE, { tab: 'allowances', yearStart: start });
  const types = sheet.types.filter((t) => !sheet.unpaid.includes(t));
  const typeField = {
    name: 'leaveType',
    label: 'Leave type',
    type: 'select' as const,
    required: true,
    options: types.map((t) => ({ value: t, label: t })),
  };
  const extra = { yearStart: sheet.year.start };
  const days = { name: 'days', label: 'Days', type: 'number' as const, required: true };
  return (
    <>
      <Subnav
        label="Leave year"
        items={sheet.years.map((y): [string, string] => [yearHref(y.start), `Leave year ${y.label}`])}
        current={yearHref(sheet.year.start)}
      />
      {EXPLAIN}
      <RecordTable
        rows={sheet.rows}
        rowKey={(r) => r.staff.id}
        caption={`Leave balances, leave year ${sheet.year.label} (${sheet.rows.length} staff)`}
        empty="No staff to show. Staff appear here once they have a staff record in the departments HR manages."
        columns={[
          {
            key: 'staff',
            header: 'Staff member',
            render: (r) => (r.staff.staffCode ? `${r.staff.name} (${r.staff.staffCode})` : r.staff.name),
          },
          ...sheet.types.map((t) => ({
            key: t,
            header: t,
            render: (r: AllowanceSheet['rows'][number]) => <BalanceCell b={r.balances[t]!} />,
          })),
        ]}
      />
      <ExportLink
        list="leave-allowances"
        params={extra}
        label="Download balances (spreadsheet)"
      />
      {canManage ? (
        <div className="ops-panels">
          <Segment
            title="Set an allowance for one person"
            description={`Leave year ${sheet.year.label}. Setting it again replaces the number.`}
          >
            <ActionForm
              action={`${API}/leave-allowances`}
              extra={extra}
              submitLabel="Set allowance"
              successText="Allowance set."
              fields={[
                { name: 'staffId', label: 'Staff member', type: 'select', required: true, options: staffOptions },
                typeField,
                { ...days, hint: 'Whole or half days, such as 12 or 7.5.' },
              ]}
            />
          </Segment>
          <Segment
            title="Set an allowance for everyone with a role"
            description={`Leave year ${sheet.year.label}, for the staff HR manages with this role. Your own allowance is left for another HR person.`}
          >
            <ActionForm
              action={`${API}/leave-allowances`}
              extra={extra}
              submitLabel="Set allowance for the role"
              successText="Allowances set."
              showCounts
              fields={[
                { name: 'role', label: 'Role', type: 'select', required: true, options: ROLE_OPTIONS },
                typeField,
                days,
              ]}
            />
          </Segment>
          <Segment
            title="Carry forward or adjust"
            description="Needs an allowance for the year first. A carry-forward is once a year, at most the setting's cap and what was left the year before."
          >
            <ActionForm
              action={`${API}/leave-adjustments`}
              extra={extra}
              submitLabel="Save to the balance"
              successText="Saved to the balance."
              resetOnSuccess
              fields={[
                { name: 'staffId', label: 'Staff member', type: 'select', required: true, options: staffOptions },
                typeField,
                {
                  name: 'kind',
                  label: 'What',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'carry_forward', label: 'Carry forward from the year before' },
                    { value: 'adjustment', label: 'Adjustment' },
                  ],
                },
                { ...days, hint: 'A minus number takes days off, such as -1.5.' },
                { name: 'reason', label: 'Reason', type: 'textarea', required: true },
              ]}
            />
          </Segment>
        </div>
      ) : null}
    </>
  );
}
