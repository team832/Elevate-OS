import { Suspense } from 'react';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { requirePageAccess } from '@elevate/server-kit/next';
import {
  AppShell,
  ButtonLink,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricStrip,
  PageHeader,
  SourceBadge,
  StatusBadge,
  Tabs,
} from '@elevate/shared-ui';
import { PLATFORM_PATHS } from '../lib/shell';
import { platformShell } from '../server/shell';
import {
  PRIORITY_TAB_LABELS,
  PRIORITY_TABS,
  enquiryProgrammes,
  istDate,
  loadAttention,
  loadFollowUps,
  loadInbox,
  loadMetrics,
  loadPipeline,
  loadPriorities,
  loadTodayClasses,
  parsePriorityTab,
  type OverviewDeps,
  type PriorityTab,
  type Widget,
} from '../server/overview-adapter';
import { NewEnquiryForm } from '../ui/new-enquiry-form';
import './overview.css';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

/** "Overdue", "Today", "Tomorrow" or "21 Oct". */
function dueLabel(due: string, today: string, tomorrow: string) {
  if (due < today) return <StatusBadge tone="danger">Overdue {dateLabel(due)}</StatusBadge>;
  if (due === today) return <StatusBadge tone="warning">Today</StatusBadge>;
  if (due === tomorrow) return 'Tomorrow';
  return dateLabel(due);
}

/** Query string for the overview with one parameter changed (keeps the others). */
function hrefWith(params: Record<string, string | undefined>, key: string, value?: string) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, [key]: value })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/?${qs}` : '/';
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  // Permission check first: signed-out visitors get a real 307 before any Suspense boundary.
  const access = await requirePageAccess('platform:module:access', {
    loginPath: PLATFORM_PATHS.login,
    returnTo: '/',
  });
  const { user, modules } = access;
  const extras = await platformShell(user, 'overview');

  if (access.status === 'forbidden') {
    return (
      <AppShell
        user={user}
        modules={modules}
        current="platform"
        logoutAction={PLATFORM_PATHS.logoutApi}
        {...extras}
      >
        <ErrorState
          title="No access"
          description="Your account has no role that opens Elevate OS. Ask a platform administrator."
        />
      </AppShell>
    );
  }

  const sp = await searchParams;
  const tab = parsePriorityTab(one(sp.tasks));
  const fq = one(sp.fq)?.slice(0, 100);
  const params = { tasks: tab === 'today' ? undefined : tab, fq: fq || undefined };
  const deps: OverviewDeps = { db: getDb(), user, now: new Date() };
  const inbox = loadInbox(deps); // shared by the figures and the attention panel
  const canAddEnquiry = can(user, 'ops:leads:write');
  const programmes = canAddEnquiry ? await enquiryProgrammes(deps.db) : [];
  const today = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(deps.now);

  return (
    <AppShell
      user={user}
      modules={modules}
      current="platform"
      logoutAction={PLATFORM_PATHS.logoutApi}
      {...extras}
    >
      <PageHeader
        title="Workspace overview"
        description={`What needs attention across admissions, people, classes and content, ${today}.`}
        actions={
          <>
            {canAddEnquiry ? (
              <Dialog
                id="new-enquiry"
                title="New enquiry"
                description="Creates a lead in Business Operations. Student name and at least one phone or email are needed; duplicates are flagged, never merged."
                triggerLabel="New enquiry"
                triggerIcon="plus"
              >
                <NewEnquiryForm programmes={programmes} />
              </Dialog>
            ) : null}
            {can(user, 'ops:tasks:read') ? (
              <ButtonLink href="/ops/tasks?view=mine" variant="secondary">
                View tasks
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <Suspense fallback={<LoadingState label="Loading figures…" />}>
        <Figures deps={deps} inbox={inbox} />
      </Suspense>

      <div className="ov-layout">
        <div className="ov-main">
          <Card
            id="pipeline"
            title="Admissions pipeline"
            description="Open admission cases by stage."
          >
            <Suspense fallback={<LoadingState label="Loading the pipeline…" />}>
              <Pipeline deps={deps} />
            </Suspense>
          </Card>

          <Card
            id="follow-ups"
            title="Follow-ups"
            description="Next contact due with each student."
            actions={
              <form className="ov-filter" method="get" action="/" role="search">
                {params.tasks ? <input type="hidden" name="tasks" value={params.tasks} /> : null}
                <label className="el-visually-hidden" htmlFor="ov-fq">
                  Filter follow-ups
                </label>
                <input
                  id="ov-fq"
                  className="el-input ov-filter-input"
                  type="search"
                  name="fq"
                  placeholder="Student, programme or owner"
                  defaultValue={fq}
                  maxLength={100}
                />
                <button className="el-button el-button-secondary" type="submit">
                  Filter
                </button>
                {fq ? <a href={hrefWith(params, 'fq')}>Clear</a> : null}
              </form>
            }
          >
            <Suspense fallback={<LoadingState label="Loading follow-ups…" />}>
              <FollowUps deps={deps} q={fq} clearHref={hrefWith(params, 'fq')} />
            </Suspense>
          </Card>

          <Card id="priorities" title="Team priorities" description="Open tasks by due date (IST).">
            <Suspense fallback={<LoadingState label="Loading tasks…" />}>
              <Priorities deps={deps} tab={tab} params={params} />
            </Suspense>
          </Card>
        </div>

        <div className="ov-side">
          <Card id="attention" title="Needs your decision">
            <Suspense fallback={<LoadingState label="Loading…" />}>
              <Attention deps={deps} inbox={inbox} />
            </Suspense>
          </Card>
          <Card id="classes" title="Today’s classes" description="Scheduled sessions you can see.">
            <Suspense fallback={<LoadingState label="Loading today’s classes…" />}>
              <TodayClasses deps={deps} />
            </Suspense>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

// --- sections (each loads its own data inside a Suspense boundary) ------------------------------

/** Renders the non-ok states of a widget, or null when it has data. */
function WidgetState({ widget }: { widget: Widget<unknown> }) {
  if (widget.status === 'unavailable')
    return (
      <p className="ov-unavailable" data-state="unavailable">
        <strong>Not available.</strong> {widget.reason}
      </p>
    );
  if (widget.status === 'error')
    return <ErrorState title="Could not load this" description={widget.message} />;
  return null;
}

function SampleNote({ widget }: { widget: Widget<unknown> }) {
  if (widget.status !== 'ok' || widget.source !== 'sample') return null;
  return (
    <p className="ov-sample-note">
      <SourceBadge source="sample" /> {widget.note}
    </p>
  );
}

async function Figures({
  deps,
  inbox,
}: {
  deps: OverviewDeps;
  inbox: ReturnType<typeof loadInbox>;
}) {
  const items = await loadMetrics(deps, inbox);
  return <MetricStrip label="Key figures" items={items} />;
}

async function Pipeline({ deps }: { deps: OverviewDeps }) {
  const w = await loadPipeline(deps);
  if (w.status !== 'ok') return <WidgetState widget={w} />;
  const max = Math.max(1, ...w.data.map((s) => s.count));
  return (
    <>
      <SampleNote widget={w} />
      <ol className="ov-pipeline" aria-label="Admission stages, in order">
        {w.data.map((s) => (
          <li key={s.key} className="ov-stage">
            <span className="ov-stage-count">{s.count}</span>
            <span className="ov-stage-label">{s.label}</span>
            <span className="ov-stage-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((s.count / max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

async function FollowUps({
  deps,
  q,
  clearHref,
}: {
  deps: OverviewDeps;
  q?: string;
  clearHref: string;
}) {
  const w = await loadFollowUps(deps, q);
  if (w.status !== 'ok') return <WidgetState widget={w} />;
  const today = istDate(deps.now);
  const tomorrow = istDate(deps.now, 1);
  return (
    <>
      <SampleNote widget={w} />
      <DataTable
        compact
        caption={q ? `${w.data.rows.length} of ${w.data.total} follow-ups match “${q}”` : undefined}
        columns={[
          { key: 'student', header: 'Student' },
          { key: 'programme', header: 'Programme' },
          { key: 'owner', header: 'Owner' },
          {
            key: 'nextStep',
            header: 'Next step',
          },
          {
            key: 'due',
            header: 'Due',
            render: (r) => <span className="ov-due">{dueLabel(r.due, today, tomorrow)}</span>,
          },
        ]}
        rows={w.data.rows}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            title={q ? 'No follow-ups match this filter' : 'No follow-ups due'}
            description={q ? 'Try a different name, programme or owner.' : undefined}
            action={q ? <a href={clearHref}>Clear the filter</a> : undefined}
          />
        }
      />
    </>
  );
}

async function Priorities({
  deps,
  tab,
  params,
}: {
  deps: OverviewDeps;
  tab: PriorityTab;
  params: Record<string, string | undefined>;
}) {
  const w = await loadPriorities(deps, tab);
  if (w.status !== 'ok') return <WidgetState widget={w} />;
  const today = istDate(deps.now);
  const tomorrow = istDate(deps.now, 1);
  return (
    <>
      <SampleNote widget={w} />
      <Tabs
        idBase="priorities"
        label="Team priorities"
        selected={tab}
        items={PRIORITY_TABS.map((t) => ({
          key: t,
          label: PRIORITY_TAB_LABELS[t],
          href: `${hrefWith(params, 'tasks', t === 'today' ? undefined : t)}#priorities`,
          count: w.data.counts[t],
        }))}
      >
        <DataTable
          compact
          columns={[
            { key: 'title', header: 'Task' },
            { key: 'owner', header: 'Owner' },
            { key: 'due', header: 'Due', render: (r) => dueLabel(r.due, today, tomorrow) },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <StatusBadge
                  tone={
                    r.status === 'Blocked'
                      ? 'danger'
                      : r.status === 'In progress'
                        ? 'info'
                        : 'neutral'
                  }
                >
                  {r.status}
                </StatusBadge>
              ),
            },
          ]}
          rows={w.data.rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title={tab === 'today' ? 'Nothing due today' : 'Nothing due this week'}
              description="Switch to All tasks to see what is coming up."
            />
          }
        />
      </Tabs>
    </>
  );
}

async function Attention({
  deps,
  inbox,
}: {
  deps: OverviewDeps;
  inbox: ReturnType<typeof loadInbox>;
}) {
  const rows = await loadAttention(deps, inbox);
  return (
    <ul className="ov-attention">
      {rows.map((r) => (
        <li key={r.key} data-status={r.count === null ? 'unavailable' : 'ok'}>
          <div className="ov-attention-text">
            {r.count === null ? (
              <span className="ov-attention-label">{r.label}</span>
            ) : (
              <a className="ov-attention-label" href={r.href}>
                {r.label}
              </a>
            )}
            <span className="ov-attention-detail">{r.count === null ? r.reason : r.detail}</span>
          </div>
          <span className="ov-attention-count" data-pending={r.count ? 'true' : undefined}>
            {r.count === null ? 'Not available' : r.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

async function TodayClasses({ deps }: { deps: OverviewDeps }) {
  const w = await loadTodayClasses(deps);
  if (w.status !== 'ok') return <WidgetState widget={w} />;
  return (
    <DataTable
      compact
      columns={[
        {
          key: 'time',
          header: 'Time',
          render: (r) => <span className="el-tabular">{r.time}</span>,
        },
        { key: 'batch', header: 'Batch' },
        { key: 'subject', header: 'Subject' },
        { key: 'room', header: 'Room' },
      ]}
      rows={w.data}
      rowKey={(r) => r.id}
      empty={
        <EmptyState
          title="No classes today"
          description="Nothing is scheduled today in the batches you can see."
          action={<a href="/academic/timetable">Open the timetable</a>}
        />
      }
    />
  );
}
