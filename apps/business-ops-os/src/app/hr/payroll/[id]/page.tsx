import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ButtonLink, PageHeader, StatCard, StatusBadge } from '@elevate/shared-ui';
import { istToday } from '../../../../domain/dates';
import {
  LINE_SOURCE_LABELS,
  LOCKED,
  MANUAL_SOURCES,
  PAY_MODE_LABELS,
  type RunAction,
} from '../../../../domain/payroll';
import { PAYROLL_MANAGE } from '../../../../server/payroll';
import { payrollRun, type RunPayslip } from '../../../../server/payroll-read';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, fmtMonth, fmtPaise, plural } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { RecordModal } from '../../../../ui/record-modal';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../ui/sections';
import { API, BASE, PayrollRules, RunBadge } from '../_components/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payroll for a month' };

const paidText = (s: RunPayslip) =>
  s.paidOn
    ? `${fmtDate(s.paidOn)}, ${PAY_MODE_LABELS[s.paidMode!]}${s.paidReference ? `, ${s.paidReference}` : ''}`
    : 'Not paid yet';

/** /ops/hr/payroll/:id — one month's payroll: payslips, lines, submit, approve, mark paid (F4-14). */
export default async function PayrollRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const access = await gate('ops:module:access', `${BASE}/${id}`);
  const { open } = await searchParams;
  return (
    <Frame access={access} active="hr-payroll">
      <Section label="Loading payroll…">
        <Run user={access.user} id={id} open={open} />
      </Section>
    </Frame>
  );
}

async function Run({ user, id, open }: { user: AuthenticatedUser; id: string; open?: string }) {
  const r = await load((db) => payrollRun(db, user, id), 1);
  if (!r.ok) return r.view;
  const { run, names, slips, totals, approveRefusal, unpaidTypes, staff } = r.data;
  const manage = can(user, PAYROLL_MANAGE);
  const here = `${BASE}/${id}`;
  const month = fmtMonth(run.month.slice(0, 7));
  const step = (action: RunAction, label: string, variant?: 'secondary') => (
    <ActionForm
      key={action}
      action={`${API}/runs/${id}`}
      extra={{ action }}
      submitLabel={label}
      variant={variant}
      compact
    />
  );
  const draft = run.status === 'draft';
  const shown = slips.find((s) => s.id === open);
  const who = [
    `Started by ${names.get(run.createdBy) ?? 'someone'}`,
    run.submittedBy && `submitted by ${names.get(run.submittedBy)} ${fmtDateTime(run.submittedAt)}`,
    run.approvedBy && `approved by ${names.get(run.approvedBy)} ${fmtDateTime(run.approvedAt)}`,
  ];
  return (
    <>
      <PageHeader
        title={`Payroll for ${month}`}
        meta={<RunBadge status={run.status} />}
        description={`${who.filter(Boolean).join(', ')}.`}
        actions={
          <>
            <ButtonLink href={`${API}/runs/${id}/download?format=pdf`} download>
              All payslips (PDF)
            </ButtonLink>
            <ButtonLink href={`${API}/runs/${id}/download?format=csv`} download>
              Download spreadsheet (CSV)
            </ButtonLink>
          </>
        }
      />
      <div className="el-page-actions">
        {draft && manage
          ? [
              step('rebuild', 'Rebuild from salaries and leave', 'secondary'),
              step('submit', 'Submit for approval'),
            ]
          : null}
        {run.status === 'submitted'
          ? [
              !approveRefusal && step('approve', 'Approve payroll'),
              step('return', 'Send back to draft', 'secondary'),
            ]
          : null}
      </div>
      {run.status === 'submitted' && approveRefusal ? (
        <p className="el-field-hint">{approveRefusal}</p>
      ) : null}
      {run.status === 'approved' ? <p className="el-field-hint">{LOCKED}</p> : null}
      <ul className="el-grid ops-kpis">
        <li>
          <StatCard label="Payslips" value={slips.length} />
        </li>
        <li>
          <StatCard label="Earnings" value={fmtPaise(totals.earningsPaise)} />
        </li>
        <li>
          <StatCard label="Deductions" value={fmtPaise(totals.deductionsPaise)} />
        </li>
        <li>
          <StatCard label="Net pay" value={fmtPaise(totals.netPaise)} />
        </li>
      </ul>
      <RecordTable
        caption={plural(slips.length, 'payslip')}
        rows={slips}
        rowKey={(s) => s.id}
        rowHref={(s) => `${here}?open=${s.id}`}
        linkColumn="staff"
        sampleOf={(s) => s.isSample}
        empty="No payslips. Nobody has a salary in force on the 1st of this month: set salaries, then rebuild."
        columns={[
          { key: 'staff', header: 'Staff member', render: (s) => s.staffName },
          { key: 'lop', header: 'Loss-of-pay days', numeric: true, render: (s) => s.lossOfPayDays },
          {
            key: 'earnings',
            header: 'Earnings',
            numeric: true,
            render: (s) => fmtPaise(s.earningsPaise),
          },
          {
            key: 'deductions',
            header: 'Deductions',
            numeric: true,
            render: (s) => fmtPaise(s.deductionsPaise),
          },
          {
            key: 'net',
            header: 'Net pay',
            numeric: true,
            render: (s) =>
              s.netPaise < 0 ? (
                <StatusBadge tone="danger">{fmtPaise(s.netPaise)}</StatusBadge>
              ) : (
                fmtPaise(s.netPaise)
              ),
          },
          { key: 'paid', header: 'Paid', render: paidText },
        ]}
      />
      {shown ? (
        <RecordModal
          id="payslip"
          title={shown.staffName}
          meta={shown.paidOn ? <StatusBadge tone="success">Paid</StatusBadge> : null}
          closeHref={here}
          returnId={shown.id}
        >
          <DetailTable
            rows={[
              { label: 'Days in the month', value: shown.daysInMonth },
              { label: 'Loss-of-pay days', value: shown.lossOfPayDays },
              { label: 'Net pay', value: fmtPaise(shown.netPaise) },
              { label: 'Paid', value: paidText(shown) },
            ]}
          />
          <RecordTable
            caption="Lines"
            rows={shown.lines}
            rowKey={(l) => l.id}
            columns={[
              {
                key: 'label',
                header: 'Line',
                render: (l) => (l.note ? `${l.label} (${l.note})` : l.label),
              },
              {
                key: 'source',
                header: 'From',
                render: (l) =>
                  `${l.kind === 'earning' ? 'Earning' : 'Deduction'} · ${LINE_SOURCE_LABELS[l.source]}`,
              },
              {
                key: 'amount',
                header: 'Amount',
                numeric: true,
                render: (l) => fmtPaise(l.amountPaise),
              },
              ...(draft && manage
                ? [
                    {
                      key: 'remove',
                      header: 'Remove',
                      render: (l: RunPayslip['lines'][number]) =>
                        (MANUAL_SOURCES as readonly string[]).includes(l.source) ? (
                          <ActionForm
                            action={`${API}/lines/${l.id}`}
                            method="DELETE"
                            submitLabel="Remove"
                            labelSuffix={` ${l.label}`}
                            variant="secondary"
                            compact
                          />
                        ) : null,
                    },
                  ]
                : []),
            ]}
          />
          <ButtonLink href={`/ops/api/v1/payslips/${shown.id}/pdf`} download>
            Download payslip (PDF)
          </ButtonLink>
          {run.status === 'approved' && !shown.paidOn && manage ? (
            <ActionForm
              action={`${API}/payslips/${shown.id}`}
              submitLabel="Mark paid"
              fields={[
                {
                  name: 'paidOn',
                  label: 'Paid on',
                  type: 'date',
                  required: true,
                  defaultValue: istToday(new Date()),
                },
                {
                  name: 'paidMode',
                  label: 'How',
                  type: 'select',
                  required: true,
                  options: Object.entries(PAY_MODE_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  })),
                },
                { name: 'paidReference', label: 'Reference (UTR, cheque no.; optional)' },
              ]}
            />
          ) : null}
        </RecordModal>
      ) : null}
      {draft && manage ? (
        <Segment
          title="Add a line"
          description="A one-off payment or deduction this month, or a correction of an earlier month. It stays when the payroll is rebuilt."
        >
          <ActionForm
            action={`${API}/runs/${id}/lines`}
            submitLabel="Add line"
            resetOnSuccess
            fields={[
              {
                name: 'staffId',
                label: 'Staff member',
                type: 'select',
                options: staff,
                required: true,
              },
              {
                name: 'kind',
                label: 'Type',
                type: 'select',
                required: true,
                options: [
                  { value: 'earning', label: 'Earning (adds to pay)' },
                  { value: 'deduction', label: 'Deduction (takes from pay)' },
                ],
              },
              {
                name: 'source',
                label: 'Kind of line',
                type: 'select',
                required: true,
                options: [
                  { value: 'one_off', label: LINE_SOURCE_LABELS.one_off },
                  { value: 'adjustment', label: LINE_SOURCE_LABELS.adjustment },
                ],
              },
              { name: 'label', label: 'Printed on the payslip as', required: true },
              { name: 'amount', label: 'Amount (₹)', type: 'money', required: true },
              { name: 'note', label: 'What it is for (HR only)', type: 'textarea', required: true },
            ]}
          />
        </Segment>
      ) : null}
      <PayrollRules unpaidTypes={unpaidTypes} />
    </>
  );
}
