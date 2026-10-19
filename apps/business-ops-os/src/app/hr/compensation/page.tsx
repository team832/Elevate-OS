import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  COMPENSATION_BASES,
  COMPENSATION_STATUSES,
  formatInr,
  NOT_PAYROLL_NOTICE,
} from '../../../domain/hr/compensation';
import { istToday } from '../../../domain/dates';
import { listCompensation } from '../../../server/hr/compensation';
import { employeeOptions } from '../../../server/hr/employees';
import { compensationListQuery } from '../../../server/hr/schemas';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { hrTone, FilterForm, options } from '../../../ui/hr-records';

export const dynamic = 'force-dynamic';

export default async function CompensationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:compensation:read', '/ops/hr/compensation');
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-compensation">
      <PageHeader
        title="Compensation records"
        description="Agreed pay terms per employee with the date they take effect. A record becomes current only when a second person approves it."
      />
      <Alert tone="warning" title="Not a payroll system">
        {NOT_PAYROLL_NOTICE} Approved terms can be exported for the payroll process that runs
        outside Elevate OS.
      </Alert>
      <Section label="Loading compensation records…">
        <Records user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Records({
  user,
  sp,
}: {
  user: AuthenticatedUser;
  sp: Record<string, string | undefined>;
}) {
  const parsed = compensationListQuery.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => v)),
  );
  const query = parsed.success ? parsed.data : {};
  const r = await load(async (db) => ({
    list: await listCompensation(db, user, query),
    employees: await employeeOptions(db),
  }));
  if (!r.ok) return r.view;
  const { list, employees } = r.data;
  const manage = can(user, 'ops:compensation:manage');
  const approver = can(user, 'ops:compensation:approve');
  const exporter = can(user, 'ops:compensation:export');
  const current = new Set(list.effectiveToday.map((e) => e.recordId).filter(Boolean));
  const conflicts = list.effectiveToday.filter((e) => e.conflict);
  return (
    <div className="el-stack">
      {conflicts.length ? (
        <Alert tone="danger" title="Overlapping approved records">
          {conflicts.map((c) => `${c.employeeCode} ${c.fullName}`).join(', ')}: more than one
          approved record covers today. Export is blocked until this is corrected.
        </Alert>
      ) : null}
      <Card
        title="Records"
        description={`“Current” marks the record in effect today (${fmtDate(list.today)}).`}
      >
        <div className="el-stack">
          <FilterForm
            action="/ops/hr/compensation"
            submitLabel="Apply filters"
            resetHref="/ops/hr/compensation"
            fields={[
              {
                name: 'staffId',
                label: 'Employee',
                type: 'select',
                options: employees,
                value: query.staffId,
                anyLabel: 'All employees',
              },
              {
                name: 'status',
                label: 'Status',
                type: 'select',
                options: options(COMPENSATION_STATUSES),
                value: query.status,
              },
            ]}
          />
          <DataTable
            rows={list.records}
            rowKey={(x) => x.id}
            empty={
              <EmptyState
                title={
                  query.staffId || query.status
                    ? 'No record matches these filters'
                    : 'No compensation recorded yet'
                }
                description={
                  manage ? 'Draft the first record below; a second person approves it.' : undefined
                }
              />
            }
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (x) => (
                  <a href={`/ops/hr/employees/${x.staffId}`}>{`${x.employeeCode} ${x.fullName}`}</a>
                ),
              },
              { key: 'basis', header: 'Basis', render: (x) => humanise(x.basis) },
              {
                key: 'amountPaise',
                header: 'Amount',
                numeric: true,
                render: (x) => formatInr(x.amountPaise),
              },
              {
                key: 'components',
                header: 'Components',
                render: (x) =>
                  x.components.length
                    ? x.components.map((c) => `${c.label} ${formatInr(c.amountPaise)}`).join('; ')
                    : '—',
              },
              {
                key: 'window',
                header: 'In effect',
                render: (x) =>
                  `${fmtDate(x.effectiveFrom)} – ${x.effectiveTo ? fmtDate(x.effectiveTo) : 'open'}`,
              },
              {
                key: 'status',
                header: 'Status',
                render: (x) => (
                  <>
                    <StatusBadge tone={hrTone(x.status)}>{humanise(x.status)}</StatusBadge>
                    {current.has(x.id) ? <StatusBadge tone="success">Current</StatusBadge> : null}
                  </>
                ),
              },
              { key: 'approvedAt', header: 'Approved', render: (x) => fmtDateTime(x.approvedAt) },
              {
                key: 'act',
                header: '',
                render: (x) =>
                  manage && x.status === 'draft' ? (
                    x.createdBy === user.id ? (
                      <div className="el-stack">
                        <span className="el-field-hint">
                          You drafted this; another person approves it.
                        </span>
                        <ActionForm
                          action={`/ops/api/v1/hr/compensation/${x.id}/cancel`}
                          submitLabel="Cancel draft"
                          variant="secondary"
                          fields={[{ name: 'reason', label: 'Reason', required: true }]}
                          compact
                        />
                      </div>
                    ) : (
                      <div className="el-stack">
                        {approver ? (
                          <ActionForm
                            action={`/ops/api/v1/hr/compensation/${x.id}/approve`}
                            submitLabel="Approve these terms"
                            fields={[
                              {
                                name: 'confirm',
                                label: 'I have checked the amount and the effective date',
                                type: 'checkbox',
                              },
                            ]}
                            compact
                          />
                        ) : null}
                        <ActionForm
                          action={`/ops/api/v1/hr/compensation/${x.id}/cancel`}
                          submitLabel="Cancel draft"
                          variant="secondary"
                          fields={[{ name: 'reason', label: 'Reason', required: true }]}
                          compact
                        />
                      </div>
                    )
                  ) : null,
              },
            ]}
          />
        </div>
      </Card>
      <div className="el-grid">
        {manage ? (
          <Card
            title="Draft a compensation record"
            description="Earnings and allowances only. If you list components, they must add up to the amount."
          >
            <ActionForm
              action="/ops/api/v1/hr/compensation"
              submitLabel="Save draft"
              fields={[
                {
                  name: 'staffId',
                  label: 'Employee',
                  type: 'select',
                  required: true,
                  options: employees,
                  defaultValue: query.staffId,
                },
                {
                  name: 'basis',
                  label: 'Basis',
                  type: 'select',
                  required: true,
                  options: options(COMPENSATION_BASES),
                },
                {
                  name: 'amountInr',
                  label: 'Amount in rupees',
                  required: true,
                  hint: 'For example 45000 or 45000.50.',
                },
                { name: 'effectiveFrom', label: 'Takes effect on', type: 'date', required: true },
                {
                  name: 'components',
                  label: 'Components (optional)',
                  type: 'json',
                  hint: 'JSON list in paise, for example [{"kind":"earning","label":"Basic","amountPaise":4000000},{"kind":"allowance","label":"Travel","amountPaise":500000}]',
                },
                { name: 'note', label: 'Note', type: 'textarea' },
              ]}
            />
          </Card>
        ) : null}
        {exporter ? (
          <Card
            title="Export for payroll"
            description="CSV of the terms in effect on the chosen date. Each export gets a reference and is recorded in the audit trail."
          >
            <form
              method="get"
              action="/ops/api/v1/hr/compensation/export"
              className="el-inline-form"
            >
              <div className="el-field">
                <label htmlFor="export-as-of">Terms in effect on</label>
                <input
                  id="export-as-of"
                  name="asOf"
                  type="date"
                  className="el-input"
                  defaultValue={istToday(new Date())}
                  required
                />
              </div>
              <button type="submit" className="el-button el-button-primary">
                Download CSV
              </button>
            </form>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
