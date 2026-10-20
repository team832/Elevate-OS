import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  listAttendance,
  monthlyAttendanceSummary,
  myAttendanceStatus,
} from '../../../../server/hr/attendance';
import { listLeaveBalances, listLeaveRequests, listLeaveTypes } from '../../../../server/hr/leave';
import { staffIdForUser } from '../../../../server/context';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import {
  HM_HINT,
  localTime,
  measuredColumns,
  minutes,
  ProviderNotice,
  RequestStatus,
  sessionColumns,
  sessionTailFields,
  SessionStatus,
  TimeNav,
} from '../time-ui';

export const dynamic = 'force-dynamic';

export default async function MyTimePage() {
  const access = await gate('ops:attendance:record', '/ops/hr/attendance/me');
  return (
    <Frame access={access} active="my-time">
      <PageHeader
        title="My attendance & leave"
        description="Clock in and out, see this month’s hours against your shift, request a correction or leave. Times are shown in your timezone."
      />
      <TimeNav current="/ops/hr/attendance/me" user={access.user} />
      <ProviderNotice>
        Record your time here. HR can enter a missed day manually or import a CSV.
      </ProviderNotice>
      <Section label="Loading today…">
        <Today user={access.user} />
      </Section>
      {can(access.user, 'ops:attendance:read') ? (
        <Section label="Loading this month…">
          <ThisMonth user={access.user} />
        </Section>
      ) : null}
      {can(access.user, 'ops:leave:read') ? (
        <Section label="Loading leave…">
          <MyLeave user={access.user} />
        </Section>
      ) : null}
    </Frame>
  );
}

async function Today({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => myAttendanceStatus(db, user));
  if (!r.ok) return r.view;
  const s = r.data;
  if (!s.linked)
    return (
      <EmptyState
        title="Your account is not linked to a staff record"
        description="Ask HR or a platform administrator to link your login to your employee record before recording attendance."
      />
    );
  const tz = s.employee.timezone;
  const col = sessionColumns<(typeof s.todaySessions)[number]>(() => tz);
  return (
    <div className="el-grid">
      <Card
        title={`Today, ${fmtDate(s.today)}`}
        description={
          s.shift
            ? `Shift ${s.shift.code}: ${localTime(s.shift.start, tz)} – ${localTime(s.shift.end, tz)}${s.shift.status === 'proposed' ? ' (timing proposed, not approved)' : ''}`
            : 'No shift is assigned for today, so late and early times are not measured.'
        }
      >
        {s.open ? (
          <div className="el-stack">
            <p>
              <SessionStatus
                status={s.open.status}
                missingClockOut={s.open.flags.missingClockOut}
              />{' '}
              since {localTime(s.open.clockInAt, tz, s.open.workDate)} ·{' '}
              {minutes(s.open.elapsedMinutes)} so far
              {s.open.flags.late ? (
                <>
                  {' '}
                  <StatusBadge tone="warning">Late by {minutes(s.open.lateMinutes)}</StatusBadge>
                </>
              ) : null}
            </p>
            {s.runningBreak ? (
              <p>Break running since {localTime(s.runningBreak.startAt, tz)}.</p>
            ) : null}
            <div className="el-inline-form">
              <ActionForm
                action="/ops/api/v1/hr/attendance/breaks"
                submitLabel={s.runningBreak ? 'End break' : 'Start break'}
                extra={{ action: s.runningBreak ? 'end' : 'start' }}
                variant="secondary"
                compact
              />
              <ActionForm
                action="/ops/api/v1/hr/attendance/clock-out"
                submitLabel="Clock out"
                compact
              />
            </div>
          </div>
        ) : s.todaySessions.length && !s.rules.multipleSessionsPerDay ? (
          <p>
            You have recorded today’s session. One session per day is the current (proposed) rule;
            if a time is wrong, open the session and request a correction.
          </p>
        ) : (
          <ActionForm action="/ops/api/v1/hr/attendance/clock-in" submitLabel="Clock in" />
        )}
      </Card>
      <Card title="Today’s sessions">
        <DataTable
          rows={s.todaySessions}
          rowKey={(x) => x.id}
          empty={<EmptyState title="Nothing recorded today" />}
          columns={[
            {
              key: 'in',
              header: 'In',
              render: (x) => (
                <a href={`/ops/hr/attendance/${x.id}`}>{localTime(x.clockInAt, tz, x.workDate)}</a>
              ),
            },
            col.out,
            col.break,
            col.worked,
            col.status,
          ]}
        />
      </Card>
    </div>
  );
}

async function ThisMonth({ user }: { user: AuthenticatedUser }) {
  const r = await load(async (db) => {
    const summary = await monthlyAttendanceSummary(db, user, {});
    const recent = await listAttendance(db, user, {
      staffId: summary.employee.staffId,
      from: summary.from,
      to: summary.to,
    });
    return { summary, recent };
  });
  if (!r.ok) return r.view;
  const { summary, recent } = r.data;
  const sm = summary.summary;
  const tz = summary.employee.timezone;
  const col = sessionColumns<(typeof recent.rows)[number]>(() => tz);
  return (
    <div className="el-stack">
      <Card
        title={`This month (${fmtDate(summary.from)} – ${fmtDate(summary.to)})`}
        description="Hours worked count closed sessions minus breaks. The difference to the schedule is not approved overtime. Attendance is not a performance measure."
      >
        <DataTable
          rows={[sm]}
          rowKey={() => 'month'}
          columns={[
            ...measuredColumns((x: typeof sm) => x),
            { key: 'late', header: 'Late days', numeric: true, render: (x) => x.lateCount },
            {
              key: 'early',
              header: 'Early departures',
              numeric: true,
              render: (x) => x.earlyCount,
            },
            {
              key: 'missing',
              header: 'Missing clock-outs',
              numeric: true,
              render: (x) => x.missingClockOuts,
            },
            {
              key: 'leave',
              header: 'Approved leave days',
              numeric: true,
              render: (x) => x.approvedLeaveDays,
            },
          ]}
        />
      </Card>
      <Card
        title="Sessions this month"
        description="Open a session to see its history or to request a correction."
      >
        <DataTable
          rows={recent.rows}
          rowKey={(x) => x.id}
          empty={<EmptyState title="No sessions recorded this month" />}
          columns={[
            {
              key: 'date',
              header: 'Date',
              render: (x) => <a href={`/ops/hr/attendance/${x.id}`}>{fmtDate(x.workDate)}</a>,
            },
            col.in,
            col.out,
            col.worked,
            col.source,
            col.status,
          ]}
        />
      </Card>
      <Card
        title="Request a correction for a day with no session"
        description="For a day you worked but nothing was recorded. A manager in your reporting line or HR decides; you cannot approve your own correction."
      >
        <ActionForm
          action="/ops/api/v1/hr/attendance-corrections"
          submitLabel="Request correction"
          fields={[
            { name: 'workDate', label: 'Date', type: 'date', required: true },
            { name: 'clockIn', label: 'Clock-in', required: true, hint: HM_HINT },
            { name: 'clockOut', label: 'Clock-out', required: true, hint: HM_HINT },
            ...sessionTailFields(),
            { name: 'reason', label: 'What happened', type: 'textarea', required: true },
          ]}
        />
      </Card>
    </div>
  );
}

async function MyLeave({ user }: { user: AuthenticatedUser }) {
  const r = await load(async (db) => {
    const staffId = await staffIdForUser(db, user.id);
    return {
      requests: await listLeaveRequests(db, user, { view: 'mine' }),
      types: await listLeaveTypes(db, user),
      balances: staffId ? await listLeaveBalances(db, user, { staffId }) : [],
    };
  });
  if (!r.ok) return r.view;
  const { requests, types, balances } = r.data;
  const mine = balances[0];
  return (
    <div className="el-grid">
      <Card title="My leave requests">
        <DataTable
          rows={requests.rows}
          rowKey={(x) => x.id}
          empty={<EmptyState title="No leave requested yet" />}
          columns={[
            {
              key: 'code',
              header: 'Request',
              render: (x) => <a href={`/ops/hr/leave/${x.id}`}>{x.code}</a>,
            },
            { key: 'type', header: 'Type', render: (x) => x.typeName },
            {
              key: 'dates',
              header: 'Dates',
              render: (x) => `${fmtDate(x.startDate)} – ${fmtDate(x.endDate)}`,
            },
            { key: 'days', header: 'Working days', numeric: true, render: (x) => x.workingDays },
            { key: 'status', header: 'Status', render: (x) => <RequestStatus status={x.status} /> },
          ]}
        />
      </Card>
      {can(user, 'ops:leave:request') ? (
        <Card
          title="Request leave"
          description="Working days exclude non-working days of your shift and holidays. Leave types are proposed until the owner approves them (OD-026)."
        >
          {types.length === 0 ? (
            <EmptyState
              title="No leave types recorded yet"
              description="HR has not recorded any leave types, so leave cannot be requested here yet."
            />
          ) : (
            <ActionForm
              action="/ops/api/v1/hr/leave-requests"
              submitLabel="Request leave"
              redirectTo="/ops/hr/leave/{id}"
              fields={[
                {
                  name: 'leaveTypeId',
                  label: 'Leave type',
                  type: 'select',
                  required: true,
                  options: types.map((t) => ({
                    value: t.id,
                    label: `${t.name}${t.halfDayAllowed ? '' : ' (full days only)'}${t.requiresDocument ? ' — document reference needed' : ''}`,
                  })),
                },
                { name: 'startDate', label: 'First day', type: 'date', required: true },
                {
                  name: 'startPart',
                  label: 'First day part',
                  type: 'select',
                  required: true,
                  defaultValue: 'full',
                  options: [
                    { value: 'full', label: 'Full day' },
                    { value: 'second_half', label: 'Second half only' },
                    { value: 'first_half', label: 'First half only (single day)' },
                  ],
                },
                { name: 'endDate', label: 'Last day', type: 'date', required: true },
                {
                  name: 'endPart',
                  label: 'Last day part (several days)',
                  type: 'select',
                  options: [
                    { value: 'full', label: 'Full day' },
                    { value: 'first_half', label: 'First half only' },
                  ],
                },
                { name: 'reason', label: 'Reason', type: 'textarea' },
                { name: 'documentRef', label: 'Supporting document reference' },
              ]}
            />
          )}
        </Card>
      ) : null}
      <Card
        title="My balances"
        description="Entitlements are an open owner decision. A balance exists only where HR has recorded an allocation."
      >
        <DataTable
          rows={mine?.balances ?? []}
          rowKey={(b) => b.leaveTypeId}
          empty={<EmptyState title="No leave types recorded" />}
          columns={[
            { key: 'type', header: 'Type', render: (b) => b.name },
            {
              key: 'balance',
              header: 'Balance (days)',
              render: (b) =>
                b.balance.status === 'configured' ? (
                  b.balance.balance
                ) : (
                  <StatusBadge tone="neutral">Not configured</StatusBadge>
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
