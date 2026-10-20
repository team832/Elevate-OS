import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { getAttendanceSession } from '../../../../server/hr/attendance';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import {
  HM_HINT,
  LateEarly,
  localTime,
  minutes,
  RequestStatus,
  sessionColumns,
  sessionTailFields,
  SOURCE_LABELS,
  TimeNav,
} from '../time-ui';

export const dynamic = 'force-dynamic';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:attendance:read', `/ops/hr/attendance/${id}`);
  return (
    <Frame access={access} active="attendance">
      <TimeNav user={access.user} />
      <Section label="Loading session…">
        <SessionDetail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function SessionDetail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getAttendanceSession(db, user, id));
  if (!r.ok) return r.view;
  const d = r.data;
  const s = d.session;
  const tz = s.timezone;
  const zoneLabel = tz === 'Asia/Kolkata' ? 'IST (Asia/Kolkata)' : tz;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${d.employee.fullName}: ${fmtDate(s.workDate)}`}
        description={`Times shown in ${zoneLabel}. Source: ${SOURCE_LABELS[s.source] ?? s.source}.`}
      />
      {s.status === 'superseded' && d.replacedBy ? (
        <Alert tone="info" title="This session was corrected">
          The original is kept unchanged for the record.{' '}
          <a href={`/ops/hr/attendance/${d.replacedBy.id}`}>Open the corrected session</a>.
        </Alert>
      ) : null}
      {s.flags.missingClockOut ? (
        <Alert tone="warning" title="Missing clock-out">
          This session is still open after the shift ended. Clock out from “My attendance &amp;
          leave” or request a correction with the right time.
        </Alert>
      ) : null}
      <Card title="Session">
        <DataTable
          rows={[s]}
          rowKey={(x) => x.id}
          columns={[
            {
              key: 'in',
              header: 'Clock-in',
              render: (x) => localTime(x.clockInAt, tz, x.workDate),
            },
            {
              key: 'out',
              header: 'Clock-out',
              render: (x) => localTime(x.clockOutAt, tz, x.workDate),
            },
            { key: 'break', header: 'Unpaid break', render: (x) => minutes(x.breakMinutes) },
            {
              key: 'worked',
              header: 'Worked',
              render: (x) => (x.workedMinutes === null ? 'Still open' : minutes(x.workedMinutes)),
            },
            {
              key: 'shift',
              header: 'Shift',
              render: () =>
                d.shift
                  ? `${d.shift.code} (${d.shift.startTime}–${d.shift.endTime})`
                  : 'Not scheduled (not measured)',
            },
            {
              key: 'flags',
              header: 'Late / early',
              render: (x) =>
                x.flags.notMeasured ? (
                  'Not measured'
                ) : (
                  <>
                    <LateEarly s={x} />
                    {!x.flags.late && !x.flags.early ? 'Within grace' : null}
                  </>
                ),
            },
            sessionColumns<typeof s>(() => tz).status,
          ]}
        />
        {s.reason ? <p>Note: {s.reason}</p> : null}
        <p className="el-field-hint">Recorded {fmtDateTime(s.createdAt)}.</p>
      </Card>
      <div className="el-grid">
        <Card title="Breaks">
          <DataTable
            rows={d.breaks}
            rowKey={(b) => b.id}
            empty={
              <EmptyState
                title="No break records"
                description="Breaks entered as a total (manual, CSV or correction) have no start and end."
              />
            }
            columns={[
              {
                key: 'start',
                header: 'Start',
                render: (b) => localTime(b.startAt, tz, s.workDate),
              },
              {
                key: 'end',
                header: 'End',
                render: (b) => (b.endAt ? localTime(b.endAt, tz, s.workDate) : 'Running'),
              },
            ]}
          />
        </Card>
        <Card
          title="Corrections"
          description="Decided by a manager in the employee’s reporting line or HR, never by the requester."
        >
          <DataTable
            rows={d.corrections}
            rowKey={(c) => c.id}
            empty={<EmptyState title="No corrections requested" />}
            columns={[
              {
                key: 'code',
                header: 'Request',
                render: (c) => <a href={`/ops/hr/attendance/corrections/${c.id}`}>{c.code}</a>,
              },
              {
                key: 'times',
                header: 'Proposed',
                render: (c) =>
                  `${localTime(c.proposedClockInAt, tz, c.workDate)} – ${localTime(c.proposedClockOutAt, tz, c.workDate)}`,
              },
              {
                key: 'status',
                header: 'Status',
                render: (c) => <RequestStatus status={c.status} />,
              },
            ]}
          />
        </Card>
      </div>
      {d.replaces.length ? (
        <Card title="Replaces">
          <ul>
            {d.replaces.map((o) => (
              <li key={o.id}>
                <a href={`/ops/hr/attendance/${o.id}`}>
                  Original session {localTime(o.clockInAt, tz, o.workDate)} –{' '}
                  {localTime(o.clockOutAt, tz, o.workDate)}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {d.canRequestCorrection ? (
        <Card
          title="Request a correction"
          description="Propose the right times and explain why. The session is not changed unless the correction is approved."
        >
          <ActionForm
            action="/ops/api/v1/hr/attendance-corrections"
            submitLabel="Request correction"
            extra={{ sessionId: s.id, workDate: s.workDate }}
            fields={[
              { name: 'clockIn', label: 'Correct clock-in', required: true, hint: HM_HINT },
              { name: 'clockOut', label: 'Correct clock-out', required: true, hint: HM_HINT },
              ...sessionTailFields(String(s.breakMinutes)),
              { name: 'reason', label: 'What is wrong and why', type: 'textarea', required: true },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
