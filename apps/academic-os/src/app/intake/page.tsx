import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { getIntakeQueue } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiButton } from '../../ui/api-form';
import { StateBadge, fmtDateTime, programmeName } from '../../ui/badges';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Enrolment intake' };

export default async function IntakePage() {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:enrolments:read', MODULE_PATHS.intake);
  return (
    <AcademicShell access={access} active="intake" loading="Loading intake…">
      {access.status === 'allowed' ? <Body access={access} /> : null}
    </AcademicShell>
  );
}

async function Body({ access }: { access: PageAccess }) {
  const data = await load(() => getIntakeQueue(getDb()));
  const canRun = can(access.user, 'academic:enrolments:decide');
  return (
    <>
      <PageHeader title="Enrolment intake" description="Confirmed admissions and recorded exits from Business Operations. Each run ends the enrolment of every student who left, then checks every waiting request and either creates the enrolment or rejects it with a reason that Business Operations sees." />
      <div className="el-stack">
        <Alert tone="warning" title="Intake does not run by itself yet">
          Waiting requests and exits are processed only when someone presses “Process intake now” here, or an operations manager runs “Send exits to Academic” in Business Operations. Until then, Business Operations shows the admission as awaiting Academic OS.
        </Alert>
        {!data.ok ? (
          <LoadError error={data.error} />
        ) : (
          <>
            <Card title="Queue">
              <p>
                <StatusBadge tone={data.data.waiting > 0 ? 'warning' : 'neutral'}>{data.data.waiting} waiting</StatusBadge>{' '}
                <StatusBadge tone={data.data.waitingExits > 0 ? 'warning' : 'neutral'}>{data.data.waitingExits} exits waiting</StatusBadge>{' '}
                <StatusBadge tone={data.data.problems.length > 0 ? 'danger' : 'neutral'}>{data.data.problems.length} failed or dead</StatusBadge>
              </p>
              {canRun ? <ApiButton action={MODULE_PATHS.api('enrolment-intake/run')} label="Process intake now" variant="primary" successMessage="Intake run finished." showResult /> : null}
            </Card>
            <Card title="Failed and dead deliveries" description="Failed deliveries are retried on the next run; dead ones (after 5 attempts) need a person.">
              <DataTable compact
                rows={data.data.problems}
                rowKey={(p) => p.eventId}
                empty={<EmptyState title="No failed deliveries" />}
                columns={[
                  { key: 'when', header: 'Recorded', render: (p) => fmtDateTime(p.occurredAt) },
                  { key: 'kind', header: 'Kind', render: (p) => (p.kind === 'exit' ? 'Exit' : 'Enrolment request') },
                  { key: 'student', header: 'Student', render: (p) => p.studentName ?? '—' },
                  { key: 'programme', header: 'Programme', render: (p) => (p.programmeCode ? programmeName(p.programmeCode) : '—') },
                  { key: 'status', header: 'Delivery', render: (p) => <><StateBadge state={p.status} /> {p.attempts} attempt(s)</> },
                  { key: 'error', header: 'Last error', render: (p) => p.lastError ?? '' },
                ]}
              />
            </Card>
            <Card title="Processed requests">
              <DataTable compact
                rows={data.data.processed}
                rowKey={(p) => p.id}
                sampleOf={(p) => Boolean(p.isSample)}
                empty={<EmptyState title="Nothing processed yet" description="Confirmed admissions land here once the intake is processed." />}
                columns={[
                  { key: 'when', header: 'Processed', render: (p) => fmtDateTime(p.processedAt) },
                  { key: 'student', header: 'Student', render: (p) => (p.studentId ? <a href={MODULE_PATHS.student(p.studentId)}>{p.studentName}</a> : p.studentName) },
                  { key: 'programme', header: 'Programme', render: (p) => programmeName(p.programmeCode) },
                  { key: 'attempt', header: 'Attempt', numeric: true, render: (p) => p.attempt },
                  { key: 'outcome', header: 'Outcome', render: (p) => <StateBadge state={p.outcome} /> },
                  { key: 'reason', header: 'Reason', render: (p) => (p.reasonCode ? p.reason : `${p.existingStudent ? 'Existing student reused' : 'New student'}${p.reason ? `. ${p.reason}` : ''}`) },
                ]}
              />
            </Card>
          </>
        )}
      </div>
    </>
  );
}
