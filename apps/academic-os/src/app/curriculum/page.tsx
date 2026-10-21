import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader, Subnav } from '@elevate/shared-ui';
import { listCourses, listPlans, listProgrammes } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { PlanBadge, StateBadge } from '../../ui/badges';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, gate, load, CURRICULUM_TABS } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Curriculum' };

const LABELS = ['locked', 'approved', 'provisional', 'proposed', 'draft', 'unverified', 'unknown'].map((v) => ({ value: v, label: v }));

export default async function CurriculumPage() {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:courses:read', MODULE_PATHS.curriculum);
  return (
    <AcademicShell access={access} active="curriculum" loading="Loading curriculum…">
      {access.status === 'allowed' ? <Body access={access} /> : null}
    </AcademicShell>
  );
}

async function Body({ access }: { access: PageAccess }) {
  const db = getDb();
  const data = await load(async () => ({ courses: await listCourses(db), plans: await listPlans(db), programmes: await listProgrammes(db) }));
  const canWrite = can(access.user, 'academic:courses:write');
  return (
    <>
      <PageHeader
        title="Courses and curriculum plans"
        description="Course versions and their plans. Locked plans change only by an approved new version."
        tabs={<Subnav label="Curriculum" items={CURRICULUM_TABS} current={MODULE_PATHS.curriculum} />}
      />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <Card title="Courses">
            <DataTable compact
              rows={data.data.courses}
              rowKey={(c) => c.id}
              empty={<EmptyState title="No courses yet" description="Seed the legacy curriculum (npm run db:seed) or create a course below." />}
              columns={[
                { key: 'programme', header: 'Programme', render: (c) => c.programmeCode },
                { key: 'code', header: 'Course', render: (c) => `${c.code} (v${c.version})` },
                { key: 'name', header: 'Name' },
                { key: 'mode', header: 'Mode', render: (c) => c.mode ?? '—' },
                { key: 'len', header: 'Class length', render: (c) => (c.classMinutes ? <>{c.classMinutes} min <PlanBadge status={c.classMinutesStatus} /></> : <PlanBadge status="unknown" prefix="length" />) },
                { key: 'status', header: 'Status', render: (c) => <StateBadge state={c.status} /> },
                { key: 'plans', header: 'Plans', render: (c) => Object.entries(c.plansByStatus).map(([s, n]) => <span key={s}><PlanBadge status={s} /> {n} </span>) },
              ]}
            />
          </Card>
          <Card title="Curriculum plan versions">
            <DataTable compact
              rows={data.data.plans}
              rowKey={(p) => p.id}
              empty={<EmptyState title="No plan versions yet" />}
              columns={[
                { key: 'code', header: 'Plan', render: (p) => <a href={MODULE_PATHS.plan(p.id)}>{p.code}</a> },
                { key: 'course', header: 'Course', render: (p) => p.courseCode },
                { key: 'scope', header: 'Scope', render: (p) => (p.batchId ? 'Batch override' : 'Course template') },
                { key: 'status', header: 'Status', render: (p) => <PlanBadge status={p.status} /> },
                { key: 'labels', header: 'Counts / dates', render: (p) => <><PlanBadge status={p.countsStatus} prefix="counts" /> <PlanBadge status={p.datesStatus} prefix="dates" /></> },
                { key: 'classes', header: 'Planned classes', numeric: true, render: (p) => p.plannedClasses },
                { key: 'hours', header: 'Planned hours', numeric: true, render: (p) => p.plannedHours },
                { key: 'pending', header: 'Pending', render: (p) => (p.pendingTargetStatus ? <>approval → <PlanBadge status={p.pendingTargetStatus} /></> : '—') },
              ]}
            />
          </Card>
          {canWrite ? (
            <>
              <Card title="Create a course version">
                <ApiForm
                  action={MODULE_PATHS.api('courses')}
                  submitLabel="Create course"
                  successMessage="Course created."
                  idPrefix="course"
                  fields={[
                    { name: 'programmeCode', label: 'Programme', type: 'select', required: true, options: data.data.programmes.map((p) => ({ value: p.code, label: `${p.code} — ${p.name} (${p.status})` })) },
                    { name: 'code', label: 'Course code', required: true, placeholder: 'IPMAT-C12-2028' },
                    { name: 'familyCode', label: 'Family code', required: true, placeholder: 'IPMAT-C12', hint: 'Shared by every version of this course.' },
                    { name: 'version', label: 'Version', type: 'number', defaultValue: 1 },
                    { name: 'name', label: 'Name', required: true },
                    { name: 'mode', label: 'Mode', type: 'select', options: ['offline', 'online', 'hybrid'].map((v) => ({ value: v, label: v })) },
                    { name: 'classMinutes', label: 'Class length (minutes)', type: 'number', hint: 'Leave empty when not decided — it is never assumed.' },
                    { name: 'classMinutesStatus', label: 'Class length status', type: 'select', options: LABELS },
                    { name: 'status', label: 'Status', type: 'select', options: ['draft', 'active', 'paused', 'archived'].map((v) => ({ value: v, label: v })) },
                  ]}
                />
              </Card>
              <Card title="Create a plan version" description="New versions start as proposed. To change a locked plan, supersede it (optionally copying its items) and request approval.">
                <ApiForm
                  action={MODULE_PATHS.api('plans')}
                  submitLabel="Create proposed plan"
                  successMessage="Proposed plan created. Add items, then request approval."
                  idPrefix="plan"
                  fields={[
                    { name: 'courseId', label: 'Course', type: 'select', required: true, options: data.data.courses.map((c) => ({ value: c.id, label: c.code })) },
                    { name: 'code', label: 'Plan code', required: true },
                    { name: 'title', label: 'Title', required: true },
                    { name: 'supersedesPlanId', label: 'Supersedes (locked or provisional plan)', type: 'select', options: data.data.plans.filter((p) => p.status === 'locked' || p.status === 'provisional').map((p) => ({ value: p.id, label: `${p.code} (${p.status})` })) },
                    { name: 'copyItems', label: 'Copy the superseded plan’s items', type: 'checkbox' },
                    { name: 'batchId', label: 'Batch id (batch-scoped override only)', hint: 'Leave empty for a course template.' },
                    { name: 'classMinutes', label: 'Class length (minutes)', type: 'number' },
                    { name: 'countsStatus', label: 'Counts label', type: 'select', options: LABELS },
                    { name: 'datesStatus', label: 'Dates label', type: 'select', options: LABELS },
                    { name: 'scopeNote', label: 'Scope note', type: 'textarea' },
                    { name: 'changeLog', label: 'Change log', type: 'textarea' },
                  ]}
                />
              </Card>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
