import type { AuthenticatedUser } from '@elevate/authentication';
import { can, requirePermission, type Permission } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  type EmploymentStatus,
} from '../../../../domain/hr/employees';
import { listAssetsForEmployee } from '../../../../server/hr/assets';
import { getEmployee, listEmploymentHistory } from '../../../../server/hr/employees';
import { formOptions } from '../../../../server/options';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { hrTone, options } from '../../../../ui/hr-records';
import { DocumentsSection, PrivateSection } from './private-sections';

export const dynamic = 'force-dynamic';

const holdsAll = (user: AuthenticatedUser, permission: Permission) =>
  can(user, permission) && requirePermission(user, permission) === 'all';

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:employees:read', `/ops/hr/employees/${id}`);
  return (
    <Frame access={access} active="hr-employees">
      <p>
        <a href="/ops/hr/employees">All employees</a>
      </p>
      <Section label="Loading employee…">
        <Profile user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Profile({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    d: await getEmployee(db, user, id),
    options: can(user, 'ops:employees:manage') ? await formOptions(db) : null,
  }));
  if (!r.ok) return r.view;
  const { d, options: o } = r.data;
  const e = d.employee;
  const rec = e.record;
  const isSelf = d.access.isSelf;
  const manage = d.access.canManage;
  const showDocs =
    can(user, 'ops:employee_documents:read') &&
    (isSelf || holdsAll(user, 'ops:employee_documents:read'));
  return (
    <div className="el-stack">
      <PageHeader
        title={`${e.fullName} · ${e.employeeCode}`}
        description={`${e.title ?? 'No designation recorded'} · ${e.departmentName ?? 'No department'} · reports to ${e.managerName ?? 'nobody on record'}`}
        actions={
          rec ? (
            <StatusBadge tone={hrTone(rec.employmentStatus)}>
              {EMPLOYMENT_STATUS_LABELS[rec.employmentStatus as EmploymentStatus]}
            </StatusBadge>
          ) : undefined
        }
      />
      <div className="el-grid">
        <Card title="Work details">
          <dl className="el-stack">
            <Item label="Work email" value={e.workEmail} />
            <Item label="Work phone" value={e.workPhone} />
            <Item label="Work location" value={e.workLocation} />
            <Item label="Time zone" value={e.timezone} />
            {'legalName' in e ? <Item label="Legal name" value={e.legalName ?? null} /> : null}
          </dl>
        </Card>
        {rec ? (
          <Card title="Employment">
            <dl className="el-stack">
              <Item label="Employment type" value={humanise(rec.employmentType)} />
              <Item
                label="Start date"
                value={rec.employmentStartDate ? fmtDate(rec.employmentStartDate) : null}
              />
              <Item
                label="End date"
                value={rec.employmentEndDate ? fmtDate(rec.employmentEndDate) : null}
              />
              <Item
                label="Sign-in"
                value={rec.hasLogin ? 'Linked to a user account' : 'No user account'}
              />
              <Item
                label="Application roles"
                value={d.roles && d.roles.length ? d.roles.map(humanise).join(', ') : 'None'}
              />
            </dl>
            <p className="el-field-hint">
              Roles are assigned by a platform administrator (platform user administration). They
              cannot be changed here, and that administration screen is not built yet.
            </p>
          </Card>
        ) : (
          <Card title="Employment">
            <p>
              Employment details are visible to HR, this person’s managers and the person themself.
            </p>
          </Card>
        )}
        <Card title="Direct reports">
          {d.reports.length === 0 ? (
            <p>No direct reports.</p>
          ) : (
            <ul>
              {d.reports.map((x) => (
                <li key={x.id}>
                  {x.fullName}
                  {x.title ? ` — ${x.title}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {d.lifecycle ? (
          <Card title="Onboarding and offboarding">
            {d.lifecycle.length === 0 ? (
              <p>No onboarding or offboarding case recorded.</p>
            ) : (
              <ul>
                {d.lifecycle.map((c) => (
                  <li key={c.code}>
                    {c.code} {humanise(c.kind)}: {humanise(c.status)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {manage && o && rec ? (
        <Card
          title="Edit employee"
          description="Changes to department, designation, manager, type and status are written to the employment history with the effective date and reason."
        >
          <ActionForm
            action={`/ops/api/v1/hr/employees/${e.staffId}`}
            method="PATCH"
            submitLabel="Save changes"
            variant="secondary"
            fields={[
              { name: 'fullName', label: 'Display name', defaultValue: e.fullName },
              { name: 'title', label: 'Designation', defaultValue: e.title ?? '' },
              {
                name: 'departmentId',
                label: 'Department',
                type: 'select',
                options: o.departments,
                defaultValue: e.departmentId ?? '',
              },
              {
                name: 'managerId',
                label: 'Reports to',
                type: 'select',
                options: o.staff.filter((s) => s.value !== e.staffId),
                defaultValue: e.managerId ?? '',
              },
              {
                name: 'employmentType',
                label: 'Employment type',
                type: 'select',
                options: options(EMPLOYMENT_TYPES),
                defaultValue: rec.employmentType,
              },
              {
                name: 'employmentStatus',
                label: 'Employment status',
                type: 'select',
                options: EMPLOYMENT_STATUSES.map((s) => ({
                  value: s,
                  label: EMPLOYMENT_STATUS_LABELS[s],
                })),
                defaultValue: rec.employmentStatus,
                hint: 'A status change needs a reason; a separation needs the end date.',
              },
              {
                name: 'workEmail',
                label: 'Work email',
                type: 'email',
                defaultValue: e.workEmail ?? '',
              },
              {
                name: 'workPhone',
                label: 'Work phone',
                type: 'tel',
                defaultValue: e.workPhone ?? '',
              },
              { name: 'workLocation', label: 'Work location', defaultValue: e.workLocation ?? '' },
              { name: 'timezone', label: 'Time zone (IANA)', defaultValue: e.timezone },
              {
                name: 'employmentStartDate',
                label: 'Start date',
                type: 'date',
                defaultValue: rec.employmentStartDate ?? '',
              },
              {
                name: 'employmentEndDate',
                label: 'End date (last working day)',
                type: 'date',
                defaultValue: rec.employmentEndDate ?? '',
              },
              {
                name: 'effectiveOn',
                label: 'Change takes effect on',
                type: 'date',
                hint: 'Default: today.',
              },
              { name: 'reason', label: 'Reason for the change', type: 'textarea' },
            ]}
          />
        </Card>
      ) : null}

      {d.access.private ? (
        <Section label="Loading private HR details…">
          <PrivateSection user={user} staffId={e.staffId} />
        </Section>
      ) : null}
      {showDocs ? (
        <Section label="Loading documents…">
          <DocumentsSection user={user} staffId={e.staffId} />
        </Section>
      ) : null}
      {rec && can(user, 'ops:assets:read') ? (
        <Section label="Loading assets…">
          <Assets user={user} staffId={e.staffId} />
        </Section>
      ) : null}
      {can(user, 'ops:compensation:read') && holdsAll(user, 'ops:compensation:read') && !isSelf ? (
        <Card title="Compensation">
          <a href={`/ops/hr/compensation?staffId=${e.staffId}`}>
            Open compensation records for {e.fullName}
          </a>
        </Card>
      ) : null}
      {rec ? (
        <Section label="Loading history…">
          <History user={user} staffId={e.staffId} />
        </Section>
      ) : null}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="el-field-hint">{label}</dt>
      <dd>{value ?? 'Not recorded'}</dd>
    </div>
  );
}

async function Assets({ user, staffId }: { user: AuthenticatedUser; staffId: string }) {
  const r = await load((db) => listAssetsForEmployee(db, user, staffId));
  if (!r.ok) return r.view;
  return (
    <Card title="Assets" description="Work assets assigned to this employee, current and returned.">
      <DataTable
        rows={r.data}
        rowKey={(a) => a.id}
        empty={<EmptyState title="No assets have been assigned" />}
        columns={[
          {
            key: 'assetCode',
            header: 'Asset',
            render: (a) => (
              <a href={`/ops/operations/assets/${a.assetId}`}>
                {a.assetCode} {a.assetName}
              </a>
            ),
          },
          { key: 'assignedOn', header: 'Assigned', render: (a) => fmtDate(a.assignedOn) },
          {
            key: 'expectedReturnOn',
            header: 'Due back',
            render: (a) => fmtDate(a.expectedReturnOn),
          },
          {
            key: 'returnedAt',
            header: 'Returned',
            render: (a) =>
              a.returnedAt ? (
                `${fmtDateTime(a.returnedAt)} · ${humanise(a.conditionOnReturn)}`
              ) : (
                <StatusBadge tone={hrTone('assigned')}>Still assigned</StatusBadge>
              ),
          },
        ]}
      />
    </Card>
  );
}

async function History({ user, staffId }: { user: AuthenticatedUser; staffId: string }) {
  const r = await load((db) => listEmploymentHistory(db, user, staffId));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Employment history"
      description="Append-only: every change of department, designation, manager, employment type and status."
    >
      <DataTable
        rows={r.data}
        rowKey={(h) => h.id}
        empty={<EmptyState title="No changes recorded yet" />}
        columns={[
          { key: 'effectiveOn', header: 'Effective', render: (h) => fmtDate(h.effectiveOn) },
          { key: 'fieldLabel', header: 'Changed' },
          {
            key: 'from',
            header: 'From',
            render: (h) =>
              h.field === 'employment_status' || h.field === 'employment_type'
                ? humanise(h.from)
                : (h.from ?? '—'),
          },
          {
            key: 'to',
            header: 'To',
            render: (h) =>
              h.field === 'employment_status' || h.field === 'employment_type'
                ? humanise(h.to)
                : (h.to ?? '—'),
          },
          { key: 'reason', header: 'Reason', render: (h) => h.reason ?? '—' },
          { key: 'changedAt', header: 'Recorded', render: (h) => fmtDateTime(h.changedAt) },
        ]}
      />
      <p className="el-field-hint">
        Department and manager changes are stored by reference and shown with today’s names.
      </p>
    </Card>
  );
}
