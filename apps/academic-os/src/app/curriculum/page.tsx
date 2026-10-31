import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { REFERENCE_DATA_HELP } from '@elevate/shared-contracts';
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  ListEmpty,
  PageHeader,
  StatusBadge,
  Subnav,
  Tabs,
} from '@elevate/shared-ui';
import { PLAN_STATUSES, TEACHING_PLAN_STATUSES } from '../../domain';
import { COURSE_STATUSES, curriculumCatalogue, listProgrammes, type CatalogueQuery } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { ClassLength, MODE_OPTIONS, PlanBadge, StateBadge, modeLabel, programmeName, wordOptions } from '../../ui/badges';
import { Filter } from '../../ui/filters';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load, CURRICULUM_TABS, sectionLabel } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Curriculum' };

const LABELS = wordOptions(['locked', 'approved', 'provisional', 'proposed', 'draft', 'unverified', 'unknown']);
const VIEW_LABELS = { mine: 'My courses', all: 'All courses' };
const STATUS_OPTIONS = [
  ...COURSE_STATUSES.map((v) => ({ value: v, label: `Course: ${v}` })),
  ...PLAN_STATUSES.map((v) => ({ value: v, label: `Plan: ${v}` })),
];
const isTeaching = (status: string) => (TEACHING_PLAN_STATUSES as readonly string[]).includes(status);

type Search = Promise<Record<string, string | string[] | undefined>>;
type Catalogue = Awaited<ReturnType<typeof curriculumCatalogue>>;

export default async function CurriculumPage({ searchParams }: { searchParams: Search }) {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:courses:read', MODULE_PATHS.curriculum);
  return (
    <AcademicShell access={access} active="curriculum" loading="Loading curriculum…">
      {access.status === 'allowed' ? <Body access={access} searchParams={searchParams} /> : null}
    </AcademicShell>
  );
}

function PlanTable({ title, description, rows }: { title: string; description: string; rows: Catalogue['plans'] }) {
  if (rows.length === 0) return null;
  return (
    <Card title={`${title} (${rows.length})`} description={description}>
      <DataTable
        compact
        rows={rows}
        rowKey={(p) => p.id}
        columns={[
          { key: 'code', header: 'Plan', render: (p) => <a href={MODULE_PATHS.plan(p.id)}>{p.code}</a> },
          { key: 'course', header: 'Course', render: (p) => p.courseCode },
          { key: 'scope', header: 'Scope', render: (p) => (p.batchId ? 'Batch override' : 'Course template') },
          { key: 'status', header: 'Status', render: (p) => <PlanBadge status={p.status} /> },
          { key: 'labels', header: 'Counts / dates', render: (p) => <><PlanBadge status={p.countsStatus} prefix="counts" /> <PlanBadge status={p.datesStatus} prefix="dates" /></> },
          { key: 'classes', header: 'Planned classes', numeric: true, render: (p) => p.plannedClasses },
          { key: 'hours', header: 'Planned hours', numeric: true, render: (p) => p.plannedHours },
          { key: 'pending', header: 'Pending', render: (p) => (p.pendingTargetStatus ? <>Approval: <PlanBadge status={p.pendingTargetStatus} /></> : '—') },
        ]}
      />
    </Card>
  );
}

async function Body({ access, searchParams }: { access: PageAccess; searchParams: Search }) {
  const db = getDb();
  const sp = await searchParams;
  const query = Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string')) as CatalogueQuery;
  const data = await load(async () => ({ catalogue: await curriculumCatalogue(db, actorFor(access.user), { ...query, q: query.q?.slice(0, 100) }), programmes: await listProgrammes(db) }));
  const canWrite = can(access.user, 'academic:courses:write');
  const header = (
    <PageHeader
      title={sectionLabel(access.user, 'curriculum')}
      description="Course versions and their plans. Locked plans change only by an approved new version."
      tabs={<Subnav label="Curriculum" items={CURRICULUM_TABS} current={MODULE_PATHS.curriculum} />}
    />
  );
  if (!data.ok) return <>{header}<LoadError error={data.error} /></>;
  const c = data.data.catalogue;
  const { subject, batchId, status, q } = c.selected;
  const filters = { q, subject, batchId, status };
  const link = (over: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ view: c.view, ...filters, ...over }).filter((e): e is [string, string] => Boolean(e[1])));
    return `${MODULE_PATHS.curriculum}?${qs}`;
  };
  const list = (
    <div className="el-stack">
      <form method="get" className="el-inline-form">
        <input type="hidden" name="view" value={c.view} />
        <Filter id="cu-q" name="q" label="Search code or name" value={q} />
        {c.options.subjects.length ? <Filter id="cu-subject" name="subject" label="Subject" type="select" options={c.options.subjects} value={subject} /> : null}
        {c.options.batches.length ? <Filter id="cu-batch" name="batchId" label="Batch" type="select" options={c.options.batches} value={batchId} /> : null}
        <Filter id="cu-status" name="status" label="Status" type="select" all="Current versions" options={STATUS_OPTIONS} value={status} />
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <Card title={`Courses (${c.courses.length})`}>
        <DataTable
          compact
          rows={c.courses}
          rowKey={(r) => r.id}
          empty={
            c.view === 'mine' && !Object.values(filters).some(Boolean) ? (
              <EmptyState
                title="No course is assigned to you yet"
                description="An academic coordinator assigns subjects and batches. The whole catalogue is under All courses."
                action={<ButtonLink href={link({ view: 'all' })}>Open All courses</ButtonLink>}
              />
            ) : (
              <ListEmpty
                noun="courses"
                params={filters}
                first={data.data.programmes.length ? (canWrite ? 'Create the first course version below.' : 'An academic coordinator creates courses here.') : `A course belongs to a programme, and no programmes are loaded. ${REFERENCE_DATA_HELP}`}
              />
            )
          }
          columns={[
            {
              key: 'code',
              header: 'Course',
              render: (r) => (
                <>
                  <a href={MODULE_PATHS.course(r.id)}>{`${r.code} (v${r.version})`}</a>
                  <br />
                  <span className="el-field-hint">{r.name}</span>
                </>
              ),
            },
            { key: 'programme', header: 'Programme', render: (r) => programmeName(r.programmeCode) },
            { key: 'mode', header: 'Mode', render: (r) => modeLabel(r.mode) },
            { key: 'len', header: 'Class length', render: (r) => <ClassLength minutes={r.classMinutes} status={r.classMinutesStatus} /> },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <>
                  <StateBadge state={r.status} />{' '}
                  {r.status === 'active' && TEACHING_PLAN_STATUSES.some((s) => r.plansByStatus[s]) ? (
                    <StatusBadge tone="success">Plan in use for teaching</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Planning record</StatusBadge>
                  )}
                </>
              ),
            },
            { key: 'plans', header: 'Plan versions', render: (r) => Object.entries(r.plansByStatus).map(([s, n]) => <span key={s}><PlanBadge status={s} /> {n} </span>) },
          ]}
        />
      </Card>
      <PlanTable
        title="Plans in use for teaching"
        description="Locked or provisional: what batches follow. These are planned classes, not delivery."
        rows={c.plans.filter((p) => isTeaching(p.status))}
      />
      <PlanTable
        title="Planning records"
        description="Proposed or earlier versions, for reference. No batch follows these."
        rows={c.plans.filter((p) => !isTeaching(p.status))}
      />
      {c.supersededHidden > 0 ? (
        <p className="el-field-hint">
          {c.supersededHidden} superseded plan version{c.supersededHidden === 1 ? ' is' : 's are'} left out.{' '}
          <a href={link({ status: 'superseded' })}>Show superseded versions</a>
        </p>
      ) : null}
      <details className="el-explain">
        <summary>How this list is defined</summary>
        <p>
          A course shows &ldquo;Plan in use for teaching&rdquo; when it is active and has a locked or provisional plan; anything else is a planning record.
          &ldquo;Not recorded&rdquo;, &ldquo;Not decided&rdquo; and &ldquo;Dates: unknown&rdquo; mean nobody has entered that value yet. Nothing is assumed in its place, and none of them means zero.
        </p>
      </details>
    </div>
  );
  return (
    <>
      {header}
      {c.views.length > 1 ? (
        <Tabs
          idBase="curriculum"
          label="Which courses"
          selected={c.view}
          items={c.views.map((v) => ({ key: v, label: VIEW_LABELS[v], href: link({ view: v }), count: c.counts[v] ?? null }))}
        >
          {list}
        </Tabs>
      ) : (
        list
      )}
      {canWrite ? (
        <>
          <Card title="Create a course version">
            <ApiForm
              action={MODULE_PATHS.api('courses')}
              submitLabel="Create course"
              successMessage="Course created."
              idPrefix="course"
              fields={[
                { name: 'programmeCode', label: 'Programme', type: 'select', required: true, options: data.data.programmes.map((p) => ({ value: p.code, label: `${p.name} (${p.status.replace(/_/g, ' ')})` })) },
                { name: 'code', label: 'Course code', required: true, placeholder: 'IPMAT-C12-2028' },
                { name: 'familyCode', label: 'Family code', required: true, placeholder: 'IPMAT-C12', hint: 'Shared by every version of this course.' },
                { name: 'version', label: 'Version', type: 'number', defaultValue: 1 },
                { name: 'name', label: 'Name', required: true },
                { name: 'mode', label: 'Mode', type: 'select', options: MODE_OPTIONS },
                { name: 'classMinutes', label: 'Class length (minutes)', type: 'number', hint: 'Leave empty when not decided — it is never assumed.' },
                { name: 'classMinutesStatus', label: 'Class length status', type: 'select', options: LABELS },
                { name: 'status', label: 'Status', type: 'select', options: wordOptions(['draft', 'active', 'paused', 'archived']) },
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
                { name: 'courseId', label: 'Course', type: 'select', required: true, options: data.data.catalogue.allCourses.map((c) => ({ value: c.id, label: c.code })) },
                { name: 'code', label: 'Plan code', required: true },
                { name: 'title', label: 'Title', required: true },
                { name: 'supersedesPlanId', label: 'Supersedes (locked or provisional plan)', type: 'select', options: data.data.catalogue.allPlans.filter((p) => isTeaching(p.status)).map((p) => ({ value: p.id, label: `${p.code} (${p.status})` })) },
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
    </>
  );
}
