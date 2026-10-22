import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader, Subnav } from '@elevate/shared-ui';
import { getBatch, getBatchCoverage, getBatchFeasibility, getCourse, listBatchPlacements, listStaff, todayIst } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { ApiForm } from '../../../ui/api-form';
import { PlanBadge, StateBadge } from '../../../ui/badges';
import { CoverageSection, FeasibilitySection } from '../../../ui/batch-sections';
import { BatchDetails, BatchStudents, BatchTeachers } from '../../../ui/batch-tabs';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Batch' };

const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TABS = ['overview', 'students', 'teachers'] as const;

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? 'overview';
  const access = await gate('academic:batches:read', MODULE_PATHS.batch(id));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="batches">{null}</AcademicShell>;
  const db = getDb();
  const actor = actorFor(access.user);
  const batch = await load(() => getBatch(db, actor, id));
  if (!batch.ok) return <AcademicShell access={access} active="batches"><LoadError error={batch.error} /></AcademicShell>;
  const b = batch.data;
  const canAssign = can(access.user, 'academic:assignments:write');
  const canWrite = can(access.user, 'academic:batches:write');
  const canTimetable = can(access.user, 'academic:timetable:write');
  const filtered = (path: string) => `${path}?batchId=${b.id}`;
  const links: [string, string][] = [
    [MODULE_PATHS.batch(b.id), 'Overview'],
    [`${MODULE_PATHS.batch(b.id)}?tab=students`, 'Students'],
    [`${MODULE_PATHS.batch(b.id)}?tab=teachers`, 'Teachers'],
    [filtered(MODULE_PATHS.timetable), 'Timetable'],
    [filtered(MODULE_PATHS.teaching), 'Teaching logs'],
    [filtered(MODULE_PATHS.assessments), 'Assessments'],
    [filtered(MODULE_PATHS.progress), 'Progress'],
  ];
  const staffList = await load(() => listStaff(db));
  const staff = staffList.ok ? staffList.data : null;
  const header = (
    <PageHeader
      title={`${b.code} — ${b.name}`}
      meta={<StateBadge state={b.status} />}
      description={<>{b.programmeCode} / {b.courseCode} · {b.activeEnrolments} enrolled{b.capacity ? ` of ${b.capacity}` : ''} · class length {b.classLength.minutes ? `${b.classLength.minutes} min` : 'unknown'} <PlanBadge status={b.classLength.status} /></>}
      tabs={<Subnav label="Batch" items={links} current={links[TABS.indexOf(tab)]![0]} />}
    />
  );
  if (tab === 'students') {
    const placements = await load(() => listBatchPlacements(db, actor, id));
    return (
      <AcademicShell access={access} active="batches">
        {header}
        {placements.ok ? <BatchStudents batch={b} placements={placements.data} canDecide={can(access.user, 'academic:enrolments:decide')} /> : <LoadError error={placements.error} />}
      </AcademicShell>
    );
  }
  if (tab === 'teachers') {
    const course = canAssign ? await load(() => getCourse(db, b.courseId)) : null;
    return (
      <AcademicShell access={access} active="batches">
        {header}
        {course && !course.ok ? <LoadError error={course.error} /> : <BatchTeachers batch={b} subjects={course?.ok ? course.data.subjects : []} staff={staff} canAssign={canAssign} />}
      </AcademicShell>
    );
  }
  const coverage = await load(() => getBatchCoverage(db, actor, id, todayIst()));
  const feasibility = can(access.user, 'academic:timetable:read') ? await load(() => getBatchFeasibility(db, actor, id, {})) : null;
  return (
    <AcademicShell access={access} active="batches">
      {header}
      <div className="el-stack">
        <BatchDetails batch={b} staff={staff} canWrite={canWrite} />
        {b.targetExamDate ? (
          <p>
            Target exam: {b.targetExam ?? 'exam'} on {b.targetExamDate} <PlanBadge status={b.targetExamDateStatus} />
          </p>
        ) : null}
        {coverage.ok ? <CoverageSection data={coverage.data} /> : <LoadError error={coverage.error} />}
        {feasibility ? feasibility.ok ? <FeasibilitySection data={feasibility.data} /> : <LoadError error={feasibility.error} /> : null}
        <Card title="Calendar rules" description="Weekly patterns that generate gross class slots.">
          <DataTable compact
            rows={b.calendarRules}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No calendar rules" />}
            columns={[
              { key: 'label', header: 'Rule' },
              { key: 'period', header: 'Period', render: (r) => `${r.periodStart} to ${r.periodEnd}` },
              { key: 'days', header: 'Days', render: (r) => r.weekdays.map((d) => WEEKDAY[d]).join(', ') },
              { key: 'slots', header: 'Slots/day', numeric: true, render: (r) => `${r.slotsPerDay}${r.kind === 'extra' ? ' extra' : ''}` },
              { key: 'status', header: 'Status', render: (r) => <PlanBadge status={r.status} /> },
            ]}
          />
          {canWrite ? (
            <ApiForm
              action={MODULE_PATHS.api('calendar-rules')}
              extra={{ batchId: b.id }}
              submitLabel="Add rule"
              successMessage="Calendar rule added."
              idPrefix="rule"
              fields={[
                { name: 'label', label: 'Label', required: true },
                { name: 'periodStart', label: 'From', type: 'date', required: true },
                { name: 'periodEnd', label: 'To', type: 'date', required: true },
                { name: 'weekdays', label: 'Weekdays', type: 'number-list', required: true, hint: 'ISO numbers, comma-separated: 1 = Mon … 7 = Sun' },
                { name: 'slotsPerDay', label: 'Slots per day', type: 'number', required: true },
                { name: 'kind', label: 'Kind', type: 'select', options: [{ value: 'regular', label: 'regular (teaching days)' }, { value: 'extra', label: 'extra slots on teaching days' }] },
                { name: 'status', label: 'Status', type: 'select', options: ['provisional', 'proposed', 'locked'].map((v) => ({ value: v, label: v })) },
              ]}
            />
          ) : null}
        </Card>
        <Card title="Closures, allowances and exam blackouts" description="Includes centre-wide rows. Undated allowances are replaced (not added to) by dated closures of the same kind.">
          <DataTable compact
            rows={b.exclusions}
            rowKey={(x) => x.id}
            empty={<EmptyState title="No exclusions" />}
            columns={[
              { key: 'label', header: 'Label' },
              { key: 'kind', header: 'Kind' },
              { key: 'when', header: 'When', render: (x) => x.date ?? `${x.periodStart} to ${x.periodEnd}` },
              { key: 'slots', header: 'Allowance', render: (x) => (x.days !== null ? `${x.days} day(s) × ${x.slotsPerDay ?? 0} slots` : '—') },
              { key: 'scope', header: 'Scope', render: (x) => (x.batchId ? 'This batch' : 'Centre-wide') },
              { key: 'status', header: 'Status', render: (x) => <PlanBadge status={x.status} /> },
            ]}
          />
          {canTimetable ? (
            <ApiForm
              action={MODULE_PATHS.api('exclusions')}
              extra={{ batchId: b.id }}
              submitLabel="Add exclusion"
              successMessage="Exclusion added."
              idPrefix="excl"
              fields={[
                { name: 'kind', label: 'Kind', type: 'select', required: true, options: ['holiday', 'school_exam', 'exam_blackout', 'other'].map((v) => ({ value: v, label: v })) },
                { name: 'label', label: 'Label', required: true },
                { name: 'date', label: 'Date (dated closure)', type: 'date' },
                { name: 'periodStart', label: 'Period start (allowance or blackout window)', type: 'date' },
                { name: 'periodEnd', label: 'Period end', type: 'date' },
                { name: 'days', label: 'Days (allowance)', type: 'number' },
                { name: 'slotsPerDay', label: 'Slots per day (allowance)', type: 'number' },
                { name: 'status', label: 'Status', type: 'select', options: ['provisional', 'confirmed', 'locked', 'unverified'].map((v) => ({ value: v, label: v })) },
              ]}
            />
          ) : null}
        </Card>
      </div>
    </AcademicShell>
  );
}
