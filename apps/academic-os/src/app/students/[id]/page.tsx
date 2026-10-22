import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, ButtonLink, Card, DataTable, EmptyState, PageHeader, SourceBadge } from '@elevate/shared-ui';
import { getStudentProgress, getStudentRecord, listStaff } from '../../../server';
import { modulePath } from '../../../domain';
import { MODULE_PATHS } from '../../../server/paths';
import { ApiForm } from '../../../ui/api-form';
import { StateBadge } from '../../../ui/badges';
import { placementNote } from '../../../ui/batch-tabs';
import { InterventionsTable } from '../../../ui/interventions';
import { AcademicShell, LoadError, actorFor, gate, load, workspaceLink } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Student progress' };

const TRIGGERS = ['repeated_absence', 'declining_scores', 'low_scores', 'missed_assessments', 'overdue_catch_up', 'other'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:students:read', MODULE_PATHS.student(id));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="students">{null}</AcademicShell>;
  const db = getDb();
  const actor = actorFor(access.user);
  const canProgress = can(access.user, 'academic:progress:read');
  const canWrite = can(access.user, 'academic:progress:write');
  const data = await load(async () => ({
    record: await getStudentRecord(db, actor, id),
    progress: canProgress ? await getStudentProgress(db, actor, id) : null,
    staff: canWrite ? await listStaff(db) : [],
  }));
  if (!data.ok) return <AcademicShell access={access} active="students"><LoadError error={data.error} /></AcademicShell>;
  const { record, progress, staff } = data.data;
  const s = record.student;
  const opsRef = can(access.user, 'academic:enrolments:read') ? (s.coreStudentId ?? s.sourceAdmissionId) : null;
  const opsHref = opsRef ? workspaceLink(access.user, 'ops', `/students/${opsRef}`) : null;
  return (
    <AcademicShell access={access} active="students">
      <PageHeader
        title={s.fullName}
        meta={<><StateBadge state={s.status} /> <SourceBadge source={s.isSample ? 'sample' : 'live'} /> <span className="el-field-hint">{s.code}</span></>}
        description={`${s.currentStage ?? 'Stage not recorded'}${s.contactsHidden ? ' · contact details hidden for your role' : ''}`}
        actions={<>{opsHref ? <a href={opsHref}>Admission, KYC and fees in Business Ops</a> : null} <a href={`${modulePath('reviews')}?academicStudentId=${s.id}`}>Teacher reviews</a> <ButtonLink href={MODULE_PATHS.students}>All students</ButtonLink></>}
      />
      <div className="el-stack">
        {!s.contactsHidden ? (
          <Card title="Contact (restricted)">
            <p>Student: {[s.email, s.phone].filter(Boolean).join(' · ') || 'none recorded'}</p>
            <p>Guardian: {s.guardianName ?? 'none recorded'}{s.guardianRelationship ? ` (${s.guardianRelationship})` : ''} {[s.guardianEmail, s.guardianPhone].filter(Boolean).join(' · ')}</p>
          </Card>
        ) : null}
        <Card title="Enrolments">
          <DataTable compact
            rows={record.enrolments}
            rowKey={(e) => e.id}
            empty={<EmptyState title="No enrolments" />}
            columns={[
              { key: 'programme', header: 'Programme', render: (e) => e.programmeCode },
              { key: 'year', header: 'Academic year', render: (e) => e.academicYear ?? 'Not recorded' },
              { key: 'batch', header: 'Batch', render: (e) => (e.batchId ? <a href={MODULE_PATHS.batch(e.batchId)}>{e.batchCode}</a> : 'awaiting batch allocation') },
              { key: 'start', header: 'Start', render: (e) => e.startDate ?? '—' },
              { key: 'late', header: 'Late joiner', render: (e) => (e.lateJoiner ? 'yes' : 'no') },
              { key: 'source', header: 'Source', render: (e) => (e.source === 'manual' ? `manual: ${e.manualReason}` : 'Business Ops admission') },
              { key: 'status', header: 'Status', render: (e) => <StateBadge state={e.status} /> },
            ]}
          />
        </Card>
        <Card title="Batch placements" description="Which batch the student was in, and when. Transfers end one placement and start the next; nothing is deleted.">
          <DataTable compact
            rows={record.placements}
            rowKey={(p) => p.id}
            empty={<EmptyState title="Not placed in a batch" description="Allocate a batch from the Enrolments page (Awaiting batch tab)." />}
            columns={[
              { key: 'batch', header: 'Batch', render: (p) => <a href={MODULE_PATHS.batch(p.batchId)}>{p.batchCode}</a> },
              { key: 'from', header: 'From', render: (p) => p.startDate },
              { key: 'to', header: 'To', render: (p) => p.endDate ?? 'Current' },
              { key: 'note', header: 'Note', render: placementNote },
              { key: 'status', header: 'Enrolment', render: (p) => <StateBadge state={p.enrolmentStatus} /> },
            ]}
          />
        </Card>
        {progress
          ? progress.batches.map((b) => (
              <Card key={b.batchId} title="Progress in batch" description={b.lateJoiner ? 'Late joiner: classes held before the enrolment start are listed as missed.' : undefined}>
                <p>
                  Attendance:{' '}
                  {b.attendance.ratePercent === null ? 'No attendance recorded' : `${b.attendance.ratePercent}%`} · {b.attendance.recorded} recorded of {b.attendance.heldSessions} held ({b.attendance.notRecorded} not recorded) · present {b.attendance.present}, late {b.attendance.late}, partial {b.attendance.partial}, absent {b.attendance.absent}, excused {b.attendance.excused}
                </p>
                <p>
                  Assessment trend:{' '}
                  {b.trend.status === 'ok'
                    ? `${b.trend.direction} (${b.trend.slope > 0 ? '+' : ''}${b.trend.slope} percentage points per assessment over ${b.trend.pointsUsed} results; mean ${b.trend.mean}%)`
                    : `Insufficient data — ${b.trend.reason}`}
                </p>
                <DataTable compact
                  caption="Final results"
                  rows={b.results.map((r, i) => ({ ...r, key: `${r.code}-${i}` }))}
                  rowKey={(r) => r.key}
                  empty={<EmptyState title="No finalised results" />}
                  columns={[
                    { key: 'code', header: 'Assessment' },
                    { key: 'date', header: 'Date', render: (r) => r.date ?? '—' },
                    { key: 'score', header: 'Score', render: (r) => (r.state === 'scored' ? `${Number(r.total)} / ${Number(r.max)}` : <StateBadge state={r.state} />) },
                    { key: 'pct', header: 'Percentile', render: (r) => (r.percentile === null ? '—' : Number(r.percentile).toFixed(2)) },
                  ]}
                />
                <DataTable compact
                  caption={`Missed classes (${b.missed.unrecorded} held session(s) have no attendance mark and are not counted)`}
                  rows={b.missed.missed}
                  rowKey={(m) => m.sessionId}
                  empty={<EmptyState title="No missed classes recorded" />}
                  columns={[
                    { key: 'date', header: 'Date' },
                    { key: 'reason', header: 'Reason', render: (m) => m.reason.replace(/_/g, ' ') },
                  ]}
                />
              </Card>
            ))
          : null}
        {progress ? (
          <>
            <Card title="Catch-up tasks">
              <DataTable compact
                rows={progress.catchupTasks}
                rowKey={(t) => t.id}
                empty={<EmptyState title="No catch-up tasks" />}
                columns={[
                  { key: 'reason', header: 'Reason', render: (t) => t.reason.replace(/_/g, ' ') },
                  { key: 'due', header: 'Due', render: (t) => t.dueDate ?? '—' },
                  { key: 'status', header: 'Status', render: (t) => <StateBadge state={t.status} /> },
                  { key: 'note', header: 'Note', render: (t) => t.note ?? '' },
                ]}
              />
              <p className="el-field-hint">Ranked catch-up lists per batch are on the <a href={MODULE_PATHS.progress}>Progress</a> page.</p>
            </Card>
            <Card title="Interventions">
              <InterventionsTable rows={progress.interventions} canWrite={canWrite} />
              {canWrite ? (
                staff.length === 0 ? (
                  <Alert tone="info">No staff records exist to make responsible.</Alert>
                ) : (
                  <ApiForm
                    action={MODULE_PATHS.api('interventions')}
                    extra={{ studentId: id }}
                    submitLabel="Open intervention"
                    successMessage="Intervention opened."
                    idPrefix="newiv"
                    fields={[
                      { name: 'trigger', label: 'Trigger', type: 'select', required: true, options: TRIGGERS },
                      { name: 'description', label: 'Concern', type: 'textarea', required: true },
                      { name: 'action', label: 'Action', type: 'textarea', required: true },
                      { name: 'responsibleStaffId', label: 'Responsible staff member', type: 'select', required: true, options: staff.map((x) => ({ value: x.id, label: x.fullName })) },
                      { name: 'dueDate', label: 'Due', type: 'date' },
                    ]}
                  />
                )
              ) : null}
            </Card>
          </>
        ) : null}
      </div>
    </AcademicShell>
  );
}
