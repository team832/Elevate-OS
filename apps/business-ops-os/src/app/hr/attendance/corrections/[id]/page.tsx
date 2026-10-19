import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, PageHeader } from '@elevate/shared-ui';
import { getCorrection } from '../../../../../server/hr/attendance';
import { ActionForm } from '../../../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../../ui/frame';
import { localTime, minutes, RequestStatus, TimeNav, timeNavItems } from '../../time-ui';

export const dynamic = 'force-dynamic';

export default async function CorrectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:attendance:read', `/ops/hr/attendance/corrections/${id}`);
  return (
    <Frame access={access} active="attendance">
      <TimeNav current="" items={timeNavItems(access.user)} />
      <Section label="Loading correction…">
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getCorrection(db, user, id));
  if (!r.ok) return r.view;
  const { correction: c, employee: e, original: o } = r.data;
  const tz = e.timezone;
  const rows = [
    {
      key: 'original',
      label: 'Recorded now',
      inAt: o ? localTime(o.clockInAt, o.timezone, o.workDate) : 'No session',
      outAt: o ? localTime(o.clockOutAt, o.timezone, o.workDate) : '—',
      brk: o ? minutes(o.breakMinutes) : '—',
    },
    {
      key: 'proposed',
      label: 'Proposed',
      inAt: localTime(c.proposedClockInAt, tz, c.workDate),
      outAt: localTime(c.proposedClockOutAt, tz, c.workDate),
      brk: minutes(c.proposedBreakMinutes),
    },
  ];
  return (
    <div className="el-stack">
      <PageHeader
        title={`${c.code}: ${e.fullName}, ${fmtDate(c.workDate)}`}
        description={`Requested ${fmtDateTime(c.createdAt)}.`}
      />
      <p>
        <RequestStatus status={c.status} />
        {c.decidedAt ? ` · decided ${fmtDateTime(c.decidedAt)}` : ''}
        {c.decisionNote ? ` · note: ${c.decisionNote}` : ''}
      </p>
      <Card title="Times">
        <DataTable
          rows={rows}
          rowKey={(x) => x.key}
          columns={[
            { key: 'label', header: '' },
            { key: 'inAt', header: 'Clock-in' },
            { key: 'outAt', header: 'Clock-out' },
            { key: 'brk', header: 'Break' },
          ]}
        />
        <p>Reason given: {c.reason}</p>
        {o ? (
          <p>
            <a href={`/ops/hr/attendance/${o.id}`}>Open the recorded session</a>
          </p>
        ) : null}
        {c.resultingSessionId ? (
          <p>
            <a href={`/ops/hr/attendance/${c.resultingSessionId}`}>Open the corrected session</a>
          </p>
        ) : null}
      </Card>
      {r.data.canDecide ? (
        <div className="el-grid">
          <Card
            title="Approve"
            description="The recorded session is kept as superseded; the proposed times become a new session."
          >
            <ActionForm
              action={`/ops/api/v1/hr/attendance-corrections/${c.id}/decision`}
              submitLabel="Approve correction"
              extra={{ decision: 'approve' }}
              fields={[{ name: 'note', label: 'Note (optional)' }]}
            />
          </Card>
          <Card title="Reject" description="The recorded session stays as it is.">
            <ActionForm
              action={`/ops/api/v1/hr/attendance-corrections/${c.id}/decision`}
              submitLabel="Reject correction"
              variant="danger"
              extra={{ decision: 'reject' }}
              fields={[{ name: 'note', label: 'Reason for rejecting', required: true }]}
            />
          </Card>
        </div>
      ) : c.status === 'pending' ? (
        <Alert tone="info" title="Waiting for a decision">
          A manager in {e.fullName}’s reporting line or HR decides. The requester cannot decide
          their own request.
        </Alert>
      ) : null}
      {r.data.canWithdraw ? (
        <ActionForm
          action={`/ops/api/v1/hr/attendance-corrections/${c.id}/withdraw`}
          submitLabel="Withdraw my request"
          variant="secondary"
        />
      ) : null}
    </div>
  );
}
