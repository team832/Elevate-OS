import type { Metadata } from 'next';
import { can, scopeFor } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { ButtonLink, Card, DataTable, ListEmpty, PageHeader, fmtDay } from '@elevate/shared-ui';
import { listBatches, listCourses } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { ClassLength, MODE_OPTIONS, PlanBadge, StateBadge, modeLabel, programmeName, wordOptions } from '../../ui/badges';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load, sectionLabel } from '../../ui/shell';

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
  const own = scopeFor(access.user, 'academic:batches:read') === 'own';
  const data = await load(async () => ({ batches: await listBatches(db, actorFor(access.user)), courses: canWrite ? await listCourses(db) : [] }));
  type Row = Awaited<ReturnType<typeof listBatches>>[number];
  const batchCell = (b: Row) => (
    <>
      <a href={MODULE_PATHS.batch(b.id)}>{b.name}</a>
      <br />
      <span className="el-field-hint">{b.code}</span>
    </>
  );
  const status = { key: 'status', header: 'Status', render: (b: Row) => <StateBadge state={b.status} /> };
  // A teacher's list leads with what they act on; dates, mode, class length and target exam are on the batch page.
  const columns = own
    ? [
        { key: 'batch', header: 'Batch', render: batchCell },
        { key: 'subject', header: 'Subject', render: (b: Row) => b.mySubjects.join(', ') },
        { key: 'students', header: 'Students', numeric: true, render: (b: Row) => b.activeEnrolments },
        status,
      ]
    : [
        { key: 'batch', header: 'Batch', render: batchCell },
        { key: 'programme', header: 'Programme / course', render: (b: Row) => `${programmeName(b.programmeCode)} / ${b.courseCode}` },
        { key: 'mode', header: 'Mode', render: (b: Row) => modeLabel(b.mode) },
        { key: 'start', header: 'Start', render: (b: Row) => fmtDay(b.startDate, 'Not set') },
        { key: 'len', header: 'Class length', render: (b: Row) => <ClassLength minutes={b.classLength.minutes} status={b.classLength.status} /> },
        { key: 'exam', header: 'Target exam', render: (b: Row) => (b.targetExamDate ? <>{b.targetExam ?? 'Exam'} {fmtDay(b.targetExamDate)} <PlanBadge status={b.targetExamDateStatus} /></> : '—') },
        { key: 'enrolled', header: 'Enrolled', numeric: true, render: (b: Row) => `${b.activeEnrolments}${b.capacity ? ` / ${b.capacity}` : ''}` },
        status,
      ];
  return (
    <>
      <PageHeader
        title={sectionLabel(access.user, 'batches')}
        description={own ? 'The batches you teach today. Open one for its course, dates, class length and students.' : 'Cohorts, each following one course version.'}
      />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <Card>
            <DataTable compact
              rows={data.data.batches}
              rowKey={(b) => b.id}
              sampleOf={(b) => b.isSample}
              empty={
                <ListEmpty
                  noun="batches"
                  params={{}}
                  first={canWrite ? 'Create a batch below.' : own ? 'An academic coordinator assigns you to batches; your assignments are on My day.' : 'An academic coordinator creates batches here.'}
                  action={own ? <ButtonLink href={MODULE_PATHS.home}>Open My day</ButtonLink> : undefined}
                />
              }
              columns={columns}
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
                  { name: 'courseId', label: 'Course version', type: 'select', required: true, options: data.data.courses.map((c) => ({ value: c.id, label: `${c.code} (${programmeName(c.programmeCode)})` })) },
                  { name: 'route', label: 'Route', type: 'select', options: wordOptions(['regular', 'dropper', 'class11_two_year', 'fast_track']) },
                  { name: 'mode', label: 'Mode', type: 'select', options: MODE_OPTIONS },
                  { name: 'startDate', label: 'Start date', type: 'date' },
                  { name: 'endDate', label: 'End date', type: 'date' },
                  { name: 'capacity', label: 'Seat limit', type: 'number' },
                  { name: 'classMinutesOverride', label: 'Class length override (minutes)', type: 'number' },
                  { name: 'targetExam', label: 'Target exam' },
                  { name: 'targetExamDate', label: 'Target exam date', type: 'date' },
                  { name: 'targetExamDateStatus', label: 'Exam date status', type: 'select', options: wordOptions(['official', 'tentative', 'assumed', 'unverified']), hint: 'Required with an exam date. Unverified dates stay flagged in every check.' },
                  { name: 'status', label: 'Status', type: 'select', options: wordOptions(['planning', 'active', 'completed', 'cancelled']) },
                ]}
              />
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
