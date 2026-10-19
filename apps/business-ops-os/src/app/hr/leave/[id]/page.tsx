import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { getLeaveRequest } from '../../../../server/hr/leave';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { DecisionBadge, RequestStatus, TimeNav, timeNavItems } from '../../attendance/time-ui';

export const dynamic = 'force-dynamic';

const PART = { full: 'Full day', first_half: 'First half', second_half: 'Second half' } as const;

export default async function LeaveRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:leave:read', `/ops/hr/leave/${id}`);
  return (
    <Frame access={access} active="leave">
      <TimeNav current="" items={timeNavItems(access.user)} />
      <Section label="Loading leave request…">
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getLeaveRequest(db, user, id));
  if (!r.ok) return r.view;
  const d = r.data;
  const q = d.request;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${q.code}: ${d.employee.fullName}`}
        description={`${d.type.name} (${d.type.paid ? 'paid' : 'unpaid'}) · ${fmtDate(q.startDate)} – ${fmtDate(q.endDate)} · ${q.workingDays} working day(s)`}
      />
      <p>
        <RequestStatus status={q.status} /> · leave type <DecisionBadge state={d.type.status} /> ·
        requested {fmtDateTime(q.createdAt)}
      </p>
      {d.countBasis === 'default_work_week' ? (
        <Alert tone="info" title="Counted with the default work week">
          No shift was assigned for some of these days, so the proposed default working week
          (setting “Leave day counting”) was used.
        </Alert>
      ) : null}
      <div className="el-grid">
        <Card title="Details">
          <p>Reason: {q.reason ?? 'not given'}</p>
          <p>Supporting document reference: {q.documentRef ?? 'none'}</p>
          {q.decidedAt ? (
            <p>
              Decided {fmtDateTime(q.decidedAt)}
              {q.decisionNote ? `: ${q.decisionNote}` : ''}
            </p>
          ) : null}
          {q.cancelledAt ? (
            <p>
              Cancelled {fmtDateTime(q.cancelledAt)}
              {q.cancelReason ? `: ${q.cancelReason}` : ''}
            </p>
          ) : null}
        </Card>
        <Card title="Day by day">
          <DataTable
            rows={d.perDate}
            rowKey={(x) => x.date}
            columns={[
              { key: 'date', header: 'Date', render: (x) => fmtDate(x.date) },
              {
                key: 'counts',
                header: 'Counts',
                render: (x) =>
                  x.excluded === 'holiday'
                    ? `Holiday: ${x.holidayName ?? ''}`
                    : x.excluded === 'non_working_day'
                      ? 'Non-working day'
                      : x.fraction === 1
                        ? PART.full
                        : `${x.fraction} day`,
              },
            ]}
          />
        </Card>
        <Card
          title="Balance ledger entries"
          description="Approval writes a usage entry; cancelling approved leave writes a reversal."
        >
          <DataTable
            rows={d.ledger}
            rowKey={(l) => l.id}
            empty={<EmptyState title="No ledger entries for this request" />}
            columns={[
              { key: 'type', header: 'Entry', render: (l) => l.entryType },
              { key: 'days', header: 'Days', numeric: true, render: (l) => l.days },
              { key: 'date', header: 'Effective', render: (l) => fmtDate(l.effectiveDate) },
            ]}
          />
        </Card>
      </div>
      {d.canDecide ? (
        <div className="el-grid">
          <Card title="Approve">
            <ActionForm
              action={`/ops/api/v1/hr/leave-requests/${q.id}/decision`}
              submitLabel="Approve leave"
              extra={{ decision: 'approve' }}
              fields={[{ name: 'note', label: 'Note (optional)' }]}
            />
          </Card>
          <Card title="Reject">
            <ActionForm
              action={`/ops/api/v1/hr/leave-requests/${q.id}/decision`}
              submitLabel="Reject leave"
              variant="danger"
              extra={{ decision: 'reject' }}
              fields={[{ name: 'note', label: 'Reason for rejecting', required: true }]}
            />
          </Card>
        </div>
      ) : q.status === 'pending' ? (
        <p>
          <StatusBadge tone="info">Waiting</StatusBadge> A manager in the employee’s reporting line
          or HR decides.
        </p>
      ) : null}
      {d.canCancel ? (
        <Card
          title="Cancel this leave"
          description={
            d.cancelNeedsReason
              ? 'This leave has started, so only an approver can cancel it and a reason is required. The days used are reversed in the ledger.'
              : 'Cancelling approved leave reverses the days in the ledger.'
          }
        >
          <ActionForm
            action={`/ops/api/v1/hr/leave-requests/${q.id}/cancel`}
            submitLabel="Cancel leave"
            variant="danger"
            fields={[{ name: 'reason', label: 'Reason', required: d.cancelNeedsReason }]}
          />
        </Card>
      ) : null}
    </div>
  );
}
