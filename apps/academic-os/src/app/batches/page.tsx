import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listBatches, listCourses } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { PlanBadge, StateBadge } from '../../ui/badges';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Batches' };

export default async function BatchesPage() {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:batches:read', MODULE_PATHS.batches);
  return (
    <AcademicShell access={access} active="batches" loading="Loading batches…">
      {access.status === 'allowed' ? <Body access={access} /> : null}
    </AcademicShell>
  );
}

async function Body({ access }: { access: PageAccess }) {
  const db = getDb();
  const canWrite = can(access.user, 'academic:batches:write');
  const data = await load(async () => ({ batches: await listBatches(db, actorFor(access.user)), courses: canWrite ? await listCourses(db) : [] }));
  return (
    <>
      <PageHeader title="Batches" description="Cohorts, each following one course version. Teachers see only their own batches." />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <Card>
            <DataTable compact
              rows={data.data.batches}
              rowKey={(b) => b.id}
              empty={<EmptyState title="No batches" description={canWrite ? 'Create a batch below.' : 'You are not assigned to any batch yet.'} />}
              columns={[
                { key: 'code', header: 'Batch', render: (b) => <a href={MODULE_PATHS.batch(b.id)}>{b.code}</a> },
                { key: 'name', header: 'Name' },
                { key: 'programme', header: 'Programme / course', render: (b) => `${b.programmeCode} / ${b.courseCode}` },
                { key: 'mode', header: 'Mode', render: (b) => b.mode ?? '—' },
                { key: 'start', header: 'Start', render: (b) => b.startDate ?? 'not set' },
                { key: 'len', header: 'Class length', render: (b) => (b.classLength.minutes ? <>{b.classLength.minutes} min <PlanBadge status={b.classLength.status} /></> : <PlanBadge status="unknown" />) },
                { key: 'exam', header: 'Target exam', render: (b) => (b.targetExamDate ? <>{b.targetExam ?? 'exam'} {b.targetExamDate} <PlanBadge status={b.targetExamDateStatus} /></> : '—') },
                { key: 'enrolled', header: 'Enrolled', numeric: true, render: (b) => `${b.activeEnrolments}${b.capacity ? ` / ${b.capacity}` : ''}` },
                { key: 'status', header: 'Status', render: (b) => <StateBadge state={b.status} /> },
              ]}
            />
          </Card>
          {canWrite ? (
            <Card title="Create a batch">
              <ApiForm
                action={MODULE_PATHS.api('batches')}
                submitLabel="Create batch"
                successMessage="Batch created."
                idPrefix="batch"
                fields={[
                  { name: 'code', label: 'Code', required: true, placeholder: 'CAF-SEP27-REG' },
                  { name: 'name', label: 'Name', required: true },
                  { name: 'courseId', label: 'Course version', type: 'select', required: true, options: data.data.courses.map((c) => ({ value: c.id, label: `${c.code} (${c.programmeCode})` })) },
                  { name: 'route', label: 'Route', type: 'select', options: ['regular', 'dropper', 'class11_two_year', 'fast_track'].map((v) => ({ value: v, label: v })) },
                  { name: 'mode', label: 'Mode', type: 'select', options: ['offline', 'online', 'hybrid'].map((v) => ({ value: v, label: v })) },
                  { name: 'startDate', label: 'Start date', type: 'date' },
                  { name: 'endDate', label: 'End date', type: 'date' },
                  { name: 'capacity', label: 'Seat limit', type: 'number' },
                  { name: 'classMinutesOverride', label: 'Class length override (minutes)', type: 'number' },
                  { name: 'targetExam', label: 'Target exam' },
                  { name: 'targetExamDate', label: 'Target exam date', type: 'date' },
                  { name: 'targetExamDateStatus', label: 'Exam date status', type: 'select', options: ['official', 'tentative', 'assumed', 'unverified'].map((v) => ({ value: v, label: v })), hint: 'Required with an exam date. Unverified dates stay flagged in every check.' },
                  { name: 'status', label: 'Status', type: 'select', options: ['planning', 'active', 'completed', 'cancelled'].map((v) => ({ value: v, label: v })) },
                ]}
              />
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
