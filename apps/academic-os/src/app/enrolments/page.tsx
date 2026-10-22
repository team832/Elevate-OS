import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import type { PageAccess } from '@elevate/server-kit/next';
import { Card, DataTable, EmptyState, PageHeader, SourceBadge, Tabs } from '@elevate/shared-ui';
import { modulePath } from '../../domain';
import { listBatches, listPlacementViews } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { PLACEMENT_VIEWS } from '../../server/schemas-placements';
import { ApiForm } from '../../ui/api-form';
import { StateBadge } from '../../ui/badges';
import { EndEnrolmentForm, placementNote } from '../../ui/batch-tabs';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Enrolments' };

const PATH = modulePath('enrolments');
type View = (typeof PLACEMENT_VIEWS)[number];
type Search = Promise<Record<string, string | string[] | undefined>>;

const LABELS: Record<View, string> = { awaiting: 'Awaiting batch', placed: 'Placed', transfers: 'Transfers', ended: 'Ended' };
const EMPTY: Record<View, { title: string; description: string }> = {
  awaiting: { title: 'No one is waiting for a batch', description: 'Confirmed admissions without a batch appear here after the enrolment intake runs.' },
  placed: { title: 'No students placed yet', description: 'Allocate a batch from the Awaiting batch tab.' },
  transfers: { title: 'No transfers yet', description: 'Move a student from the Placed tab; each transfer is listed here with its date and reason.' },
  ended: { title: 'No completed or withdrawn enrolments', description: 'End an enrolment from the Placed tab or a batch’s Students tab. Its history stays.' },
};

export default async function EnrolmentsPage({ searchParams }: { searchParams: Search }) {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:enrolments:read', PATH);
  const sp = await searchParams;
  const view = PLACEMENT_VIEWS.find((v) => v === sp.view) ?? 'awaiting';
  return (
    <AcademicShell access={access} active="enrolments" loading="Loading enrolments…">
      {access.status === 'allowed' ? <Body access={access} view={view} /> : null}
    </AcademicShell>
  );
}

async function Body({ access, view }: { access: PageAccess; view: View }) {
  const db = getDb();
  const actor = actorFor(access.user);
  const canDecide = can(access.user, 'academic:enrolments:decide');
  const data = await load(async () => ({
    list: await listPlacementViews(db, actor, view),
    batches: canDecide ? (await listBatches(db, actor)).filter((b) => b.status !== 'completed' && b.status !== 'cancelled') : [],
  }));
  const header = (
    <PageHeader
      title="Enrolments"
      description="A confirmed admission becomes an enrolment; a placement puts it in a batch from a date. Moving or ending one programme never changes another."
    />
  );
  if (!data.ok) return <>{header}<LoadError error={data.error} /></>;
  const { list, batches } = data.data;
  type Row = (typeof list.rows)[number];
  const batchOptions = batches.map((b) => ({ value: b.id, label: `${b.code}, ${b.programmeCode} / ${b.courseCode}${b.capacity ? ` (${b.activeEnrolments} of ${b.capacity} seats)` : ''}` }));
  const enrolmentOptions = list.rows.map((r) => ({ value: r.enrolmentId, label: `${r.studentName} · ${r.studentCode} · ${r.programmeName}${r.startDate ? ` · since ${r.startDate}` : ''}${r.placement ? ` (${r.placement.batchCode})` : ''}` }));
  const placementText = (r: Row) => (r.placement ? `${r.placement.batchCode}, ${r.placement.startDate} to ${r.placement.endDate ?? 'now'}${r.placement.endedReason ? ` (${placementNote(r.placement)})` : ''}` : 'Awaiting batch');
  return (
    <>
      {header}
      <Tabs
        idBase="enrolments"
        label="Enrolment lists"
        selected={view}
        items={PLACEMENT_VIEWS.map((v) => ({ key: v, label: LABELS[v], href: `${PATH}?view=${v}`, count: list.counts[v] }))}
      >
        <div className="el-stack">
          <Card>
            <DataTable
              compact
              rows={list.rows}
              rowKey={(r) => r.enrolmentId}
              empty={<EmptyState title={EMPTY[view].title} description={EMPTY[view].description} />}
              columns={[
                { key: 'student', header: 'Student', render: (r) => <><a href={MODULE_PATHS.student(r.studentId)}>{r.studentName}</a> <SourceBadge source={r.isSample ? 'sample' : 'live'} /></> },
                { key: 'programme', header: 'Programme', render: (r) => `${r.programmeName}${r.courseCode ? ` · ${r.courseCode}` : ''}` },
                { key: 'year', header: 'Academic year', render: (r) => r.academicYear ?? 'Not recorded' },
                { key: 'start', header: 'Enrolled from', render: (r) => r.startDate ?? 'Not recorded' },
                view === 'transfers'
                  ? { key: 'moves', header: 'Transfers', render: (r: Row) => r.transfers.map((t) => `${t.effectiveDate}: ${t.fromBatchCode ?? '?'} to ${t.toBatchCode} (${t.reason ?? 'no reason'})`).join('; ') }
                  : { key: 'batch', header: 'Batch', render: placementText },
                ...(view === 'transfers'
                  ? [{
                      key: 'catchup',
                      header: 'Proposed catch-up (as of today)',
                      render: (r: Row) =>
                        r.transfers
                          .map((t) => t.catchUp?.map((c) => `${c.code} ${c.title}`).join(', ') || 'Nothing to catch up')
                          .join('; '),
                    }]
                  : []),
                { key: 'source', header: 'Source', render: (r) => (r.source === 'manual' ? `Manual: ${r.manualReason ?? ''}` : 'Business Ops admission') },
                { key: 'ops', header: 'Business Ops', render: (r) => (r.coreStudentId ?? r.sourceAdmissionId ? <a href={`/ops/students/${r.coreStudentId ?? r.sourceAdmissionId}`}>Admission and fees</a> : 'Not linked') },
                { key: 'status', header: 'Status', render: (r) => <StateBadge state={r.status} /> },
              ]}
            />
            {view === 'transfers' ? <p className="el-field-hint">Catch-up lists chapters the new batch has taught that the old batch has not. Nothing is assigned; the coordinator decides.</p> : null}
          </Card>
          {canDecide && view === 'awaiting' && enrolmentOptions.length > 0 ? (
            <Card title="Allocate a batch" description="Checks the seat limit and the student’s other classes for clashes.">
              <ApiForm
                action={MODULE_PATHS.api('placements')}
                submitLabel="Place in batch"
                successMessage="Student placed. They now appear under Placed."
                idPrefix="allocate"
                fields={[
                  { name: 'enrolmentId', label: 'Enrolment', type: 'select', required: true, options: enrolmentOptions },
                  { name: 'batchId', label: 'Batch', type: 'select', required: true, options: batchOptions },
                  { name: 'startDate', label: 'First day in the batch', type: 'date', hint: 'Empty = today, or the enrolment start if that is later.' },
                  { name: 'reason', label: 'Note' },
                ]}
              />
            </Card>
          ) : null}
          {canDecide && view === 'placed' && enrolmentOptions.length > 0 ? (
            <>
              <Card title="Transfer to another batch" description="The current placement ends the day before. Attendance, logs and marks stay where they were recorded.">
                <ApiForm
                  action={MODULE_PATHS.api('placements/transfer')}
                  submitLabel="Transfer student"
                  successMessage="Transfer saved. See the Transfers tab for the proposed catch-up."
                  idPrefix="transfer"
                  fields={[
                    { name: 'enrolmentId', label: 'Enrolment', type: 'select', required: true, options: enrolmentOptions },
                    { name: 'toBatchId', label: 'New batch', type: 'select', required: true, options: batchOptions },
                    { name: 'effectiveDate', label: 'First day in the new batch', type: 'date', required: true },
                    { name: 'reason', label: 'Reason', required: true },
                  ]}
                />
              </Card>
              <Card title="Complete or withdraw an enrolment" description="Ends this one programme only. Other enrolments of the same student stay open.">
                <EndEnrolmentForm idPrefix="end" options={enrolmentOptions} />
              </Card>
            </>
          ) : null}
        </div>
      </Tabs>
    </>
  );
}
