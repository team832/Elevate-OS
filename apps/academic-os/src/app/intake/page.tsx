import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { getIntakeQueue } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiButton } from '../../ui/api-form';
import { StateBadge, fmtDateTime } from '../../ui/badges';
import { AcademicShell, LoadError, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';

export default async function IntakePage() {
  const access = await gate('academic:enrolments:read', MODULE_PATHS.intake);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="intake">{null}</AcademicShell>;
  const data = await load(() => getIntakeQueue(getDb()));
  const canRun = can(access.user, 'academic:enrolments:decide');
  return (
    <AcademicShell access={access} active="intake">
      <PageHeader title="Enrolment intake" description="Requests from Business Ops (ops.admission.enrolment_requested v1). Each is confirmed (academic.enrolment.confirmed v1) or rejected with a reason (academic.enrolment.rejected v1) in the same transaction." />
      <div className="el-stack">
        <Alert tone="warning" title="No scheduler yet">
          The intake consumer (academic.enrolment-intake) runs only when someone presses “Process intake now”. A scheduler is a wave-3 integration item. Until a reply is sent, Business Ops shows the admission as awaiting Academic OS.
        </Alert>
        {!data.ok ? (
          <LoadError error={data.error} />
        ) : (
          <>
            <Card title="Queue">
              <p>
                <StatusBadge tone={data.data.waiting > 0 ? 'warning' : 'neutral'}>{data.data.waiting} waiting</StatusBadge>{' '}
                <StatusBadge tone={data.data.problems.length > 0 ? 'danger' : 'neutral'}>{data.data.problems.length} failed or dead</StatusBadge>
              </p>
              {canRun ? <ApiButton action={MODULE_PATHS.api('enrolment-intake/run')} label="Process intake now" variant="primary" successMessage="Intake run finished." showResult /> : null}
            </Card>
            <Card title="Failed and dead deliveries" description="Failed deliveries are retried on the next run; dead ones (after 5 attempts) need a person.">
              <DataTable
                rows={data.data.problems}
                rowKey={(p) => p.eventId}
                empty={<EmptyState title="No failed deliveries" />}
                columns={[
                  { key: 'when', header: 'Requested', render: (p) => fmtDateTime(p.occurredAt) },
                  { key: 'student', header: 'Student', render: (p) => p.studentName ?? '—' },
                  { key: 'programme', header: 'Programme', render: (p) => p.programmeCode ?? '—' },
                  { key: 'status', header: 'Delivery', render: (p) => <><StateBadge state={p.status} /> {p.attempts} attempt(s)</> },
                  { key: 'error', header: 'Last error', render: (p) => p.lastError ?? '' },
                ]}
              />
            </Card>
            <Card title="Processed requests">
              <DataTable
                rows={data.data.processed}
                rowKey={(p) => p.id}
                empty={<EmptyState title="Nothing processed yet" />}
                columns={[
                  { key: 'when', header: 'Processed', render: (p) => fmtDateTime(p.processedAt) },
                  { key: 'student', header: 'Student', render: (p) => (p.studentId ? <a href={MODULE_PATHS.student(p.studentId)}>{p.studentName}</a> : p.studentName) },
                  { key: 'programme', header: 'Programme', render: (p) => p.programmeCode },
                  { key: 'attempt', header: 'Attempt', numeric: true, render: (p) => p.attempt },
                  { key: 'outcome', header: 'Outcome', render: (p) => <StateBadge state={p.outcome} /> },
                  { key: 'reason', header: 'Reason', render: (p) => (p.reasonCode ? `${p.reasonCode}: ${p.reason}` : p.existingStudent ? 'existing student reused' : 'new student') },
                ]}
              />
            </Card>
          </>
        )}
      </div>
    </AcademicShell>
  );
}
