import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { scheduledShiftMinutes } from '../../../../domain/hr/shifts';
import { getShiftTemplate, listShiftAssignments, toTemplate } from '../../../../server/hr/shifts';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { DecisionBadge, minutes, TimeNav, timeNavItems, weekdays } from '../../attendance/time-ui';

export const dynamic = 'force-dynamic';

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:shifts:read', `/ops/hr/shifts/${id}`);
  return (
    <Frame access={access} active="shifts">
      <TimeNav current="" items={timeNavItems(access.user)} />
      <Section label="Loading shift…">
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    t: await getShiftTemplate(db, user, id),
    assignments: await listShiftAssignments(db, user, { shiftTemplateId: id }),
  }));
  if (!r.ok) return r.view;
  const { t, assignments } = r.data;
  const manage = can(user, 'ops:shifts:manage');
  return (
    <div className="el-stack">
      <PageHeader
        title={`${t.code}: ${t.name}`}
        description={`${t.startTime}–${t.endTime}${t.crossesMidnight ? ' (ends the next day)' : ''} · ${weekdays(t.workingWeekdays)} · ${minutes(scheduledShiftMinutes(toTemplate(t)))} paid per day`}
      />
      <p>
        <DecisionBadge state={t.status} /> · last changed {fmtDateTime(t.updatedAt)}
      </p>
      {t.status === 'proposed' ? (
        <Alert tone="warning" title="Proposed timing">
          These hours are used to measure late and early times, but the owner has not approved them
          (OD-026).
        </Alert>
      ) : null}
      {t.notes ? <p>{t.notes}</p> : null}
      {manage ? (
        <div className="el-grid">
          <Card
            title="Edit timing"
            description="Changing the timing of an approved template makes it proposed again."
          >
            <ActionForm
              action={`/ops/api/v1/hr/shifts/${t.id}`}
              method="PATCH"
              submitLabel="Save shift timing"
              fields={[
                { name: 'name', label: 'Name', defaultValue: t.name },
                {
                  name: 'startTime',
                  label: 'Start',
                  defaultValue: t.startTime,
                  hint: 'HH:MM, 24-hour',
                },
                { name: 'endTime', label: 'End', defaultValue: t.endTime, hint: 'HH:MM, 24-hour' },
                {
                  name: 'crossesMidnight',
                  label: 'Ends the next day (overnight)',
                  type: 'checkbox',
                  defaultValue: String(t.crossesMidnight),
                },
                {
                  name: 'unpaidBreakMinutes',
                  label: 'Unpaid break (minutes)',
                  type: 'number',
                  defaultValue: String(t.unpaidBreakMinutes),
                },
                {
                  name: 'workingWeekdays',
                  label: 'Working weekdays',
                  type: 'json',
                  defaultValue: JSON.stringify(t.workingWeekdays),
                  hint: '0 = Sunday … 6 = Saturday',
                },
                { name: 'location', label: 'Location', defaultValue: t.location ?? '' },
                { name: 'notes', label: 'Notes', type: 'textarea', defaultValue: t.notes ?? '' },
              ]}
            />
          </Card>
          <Card title="Decision state" description="Record the owner’s decision on this timing.">
            <div className="el-inline-form">
              {t.status !== 'approved' ? (
                <ActionForm
                  action={`/ops/api/v1/hr/shifts/${t.id}`}
                  method="PATCH"
                  submitLabel="Mark timing approved"
                  extra={{ status: 'approved' }}
                  compact
                />
              ) : null}
              {t.status === 'approved' ? (
                <ActionForm
                  action={`/ops/api/v1/hr/shifts/${t.id}`}
                  method="PATCH"
                  submitLabel="Set back to proposed"
                  extra={{ status: 'proposed' }}
                  variant="secondary"
                  compact
                />
              ) : null}
              {t.status !== 'retired' ? (
                <ActionForm
                  action={`/ops/api/v1/hr/shifts/${t.id}`}
                  method="PATCH"
                  submitLabel="Retire template"
                  extra={{ status: 'retired' }}
                  variant="danger"
                  compact
                />
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
      <Card
        title="Assignments"
        description="Ending sets a last date; cancelling keeps the row for history."
      >
        <DataTable
          rows={assignments.rows}
          rowKey={(a) => a.id}
          empty={<EmptyState title="Nobody is assigned to this shift" />}
          columns={[
            { key: 'name', header: 'Employee', render: (a) => a.fullName },
            { key: 'from', header: 'From', render: (a) => fmtDate(a.fromDate) },
            {
              key: 'to',
              header: 'To',
              render: (a) => (a.toDate ? fmtDate(a.toDate) : 'Open-ended'),
            },
            {
              key: 'act',
              header: '',
              render: (a) =>
                manage ? (
                  <div className="el-inline-form">
                    <ActionForm
                      action={`/ops/api/v1/hr/shift-assignments/${a.id}`}
                      method="PATCH"
                      submitLabel="End assignment"
                      extra={{ action: 'end' }}
                      fields={[{ name: 'toDate', label: 'Last day', type: 'date', required: true }]}
                      variant="secondary"
                      compact
                    />
                    <ActionForm
                      action={`/ops/api/v1/hr/shift-assignments/${a.id}`}
                      method="PATCH"
                      submitLabel="Cancel assignment"
                      extra={{ action: 'cancel' }}
                      fields={[{ name: 'reason', label: 'Reason', required: true }]}
                      variant="danger"
                      compact
                    />
                  </div>
                ) : null,
            },
          ]}
        />
      </Card>
    </div>
  );
}
