import { Suspense } from 'react';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { getCurrentUser, requirePageAccess } from '@elevate/server-kit/next';
import { MODULES } from '@elevate/shared-types';
import {
  AppShell,
  ButtonLink,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  JourneyRail,
  LoadingState,
  MetricStrip,
  MODULE_NAV,
  PageHeader,
  StatusBadge,
} from '@elevate/shared-ui';
import { MODULE_BLURBS, PLATFORM_PATHS } from '../lib/shell';
import { platformShell } from '../server/shell';
import {
  enquiryProgrammes,
  istDate,
  loadAttention,
  loadFollowUps,
  loadInbox,
  loadMetrics,
  loadPipeline,
  loadTodayClasses,
  type OverviewDeps,
  type Widget,
} from '../server/overview-adapter';
import { JsonForm } from '../ui/json-form';
import { NewEnquiryForm } from '../ui/new-enquiry-form';
import { FrontPage } from './_components/front-page';
import './overview.css';
import './home.css';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

/** "Overdue · 29 days (22 Sept)", "Today", "Tomorrow" or the date. */
function dueLabel(due: string, today: string, tomorrow: string) {
  const late = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
  if (late > 0)
    return (
      <StatusBadge tone="danger">
        Overdue · {late} day{late === 1 ? '' : 's'} ({dateLabel(due)})
      </StatusBadge>
    );
  if (due === today) return <StatusBadge tone="warning">Today</StatusBadge>;
  if (due === tomorrow) return 'Tomorrow';
  return dateLabel(due);
}

function hrefWith(params: Record<string, string | undefined>, key: string, value?: string) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, [key]: value })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/?${qs}` : '/';
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await getCurrentUser())) return <FrontPage />;
  const access = await requirePageAccess('platform:module:access', {
    loginPath: PLATFORM_PATHS.login,
    returnTo: '/',
  });
  const { user, modules } = access;
  const shell = {
    user,
    modules,
    current: 'platform' as const,
    logoutAction: PLATFORM_PATHS.logoutApi,
    ...(await platformShell(user, 'overview')),
  };

  if (access.status === 'forbidden') {
    return (
      <AppShell {...shell}>
        <ErrorState
          level={1}
          title="No access"
          description="Your account has no role that opens Elevate OS. Ask a platform administrator."
        />
      </AppShell>
    );
  }

  const sp = await searchParams;
  const fq = one(sp.fq)?.slice(0, 100);
  const params = { fq: fq || undefined };
  const deps: OverviewDeps = { db: getDb(), user, now: new Date() };
  const inbox = loadInbox(deps);
  const canAddEnquiry = can(user, 'ops:leads:write');
  const programmes = canAddEnquiry ? await enquiryProgrammes(deps.db) : [];
  const today = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(deps.now);

  return (
    <AppShell {...shell}>
      <PageHeader
        title="Overview"
        description={`${today}: what needs attention across admissions, classes and content.`}
        actions={
          canAddEnquiry ? (
            <Dialog
              id="new-enquiry"
              title="New enquiry"
              description="Creates a lead in Business Operations. Student name and at least one phone or email are needed; duplicates are flagged, never merged."
              triggerLabel="New enquiry"
              triggerIcon="plus"
            >
              <NewEnquiryForm programmes={programmes} />
            </Dialog>
          ) : null
        }
      />

      <Suspense fallback={<LoadingState label="Loading figures…" />}>
        <Figures deps={deps} inbox={inbox} />
      </Suspense>

      <div className="el-stack">
        <Card
          id="pipeline"
          title="Admissions pipeline"
          description="Open admission cases by stage. Lost and on-hold cases are not shown."
          actions={
            can(user, 'ops:admissions:read') ? (
              <ButtonLink href="/ops/admissions/overview">Admissions overview</ButtonLink>
            ) : null
          }
        >
          <Suspense fallback={<LoadingState label="Loading the pipeline…" />}>
            <Pipeline deps={deps} />
          </Suspense>
        </Card>

        <div className="ov-layout">
          <div className="ov-main">
            <Card
              id="follow-ups"
              title="Follow-ups"
              description="Next contact due with each student, most overdue first."
              actions={
                <form className="ov-filter" method="get" action="/" role="search">
                  <label className="el-visually-hidden" htmlFor="ov-fq">
                    Search follow-ups
                  </label>
                  <input
                    id="ov-fq"
                    className="el-input ov-filter-input"
                    type="search"
                    name="fq"
                    placeholder="Search follow-ups"
                    defaultValue={fq}
                    maxLength={100}
                  />
                  <button className="el-button el-button-secondary" type="submit">
                    Search
                  </button>
                  {fq ? <a href={hrefWith(params, 'fq')}>Clear</a> : null}
                </form>
              }
            >
              <Suspense fallback={<LoadingState label="Loading follow-ups…" />}>
                <FollowUps
                  deps={deps}
                  q={fq}
                  clearHref={hrefWith(params, 'fq')}
                  canClose={can(user, 'ops:leads:write')}
                />
              </Suspense>
            </Card>
          </div>

          <div className="ov-side">
            <Card id="attention" title="Needs your decision">
              <Suspense fallback={<LoadingState label="Loading…" />}>
                <Attention deps={deps} inbox={inbox} />
              </Suspense>
            </Card>
            <Card
              id="classes"
              title="Today’s classes"
              description="Scheduled sessions you can see."
            >
              <Suspense fallback={<LoadingState label="Loading today’s classes…" />}>
                <TodayClasses deps={deps} />
              </Suspense>
            </Card>
            <Modules modules={modules} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/** One line per module the user can open (the module checks again on the server). */
function Modules({ modules }: { modules: readonly string[] }) {
  const open = MODULE_NAV.filter((m) => modules.includes(m.key));
  if (open.length === 0) return null;
  return (
    <Card id="modules" title="Go to">
      <ul className="ov-attention">
        {open.map((m) => (
          <li key={m.key}>
            <div className="ov-attention-text">
              <a className="ov-attention-label" href={MODULES[m.key].basePath}>
                {m.label}
              </a>
              <span className="ov-attention-detail">{MODULE_BLURBS[m.key]}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

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
  const canLeads = can(deps.user, 'ops:leads:read');
  if (w.status !== 'ok') return <WidgetState widget={w} />;
  if (w.data.every((s) => s.count === 0))
    return (
      <EmptyState
        title="No admission cases yet"
        description="Cases appear here once enquiries are recorded in Business Operations."
        action={<a href="/ops/admissions">Open admissions</a>}
      />
    );
  return (
    <JourneyRail
      label="Admission stages, in order"
      stages={w.data.map((s) => ({
        key: s.key,
        label: s.label,
        count: s.count,
        // Only a one-status stage maps exactly onto the leads list's stage filter.
        href: canLeads && s.statuses.length === 1 ? `/ops/leads?stage=${s.statuses[0]}` : undefined,
      }))}
    />
  );
}

async function FollowUps({
  deps,
  q,
  clearHref,
  canClose,
}: {
  deps: OverviewDeps;
  q?: string;
  clearHref: string;
  /** ops:leads:write; the server re-checks permission and scope. */
  canClose: boolean;
}) {
  const w = await loadFollowUps(deps, q);
  if (w.status !== 'ok') return <WidgetState widget={w} />;
  const today = istDate(deps.now);
  const tomorrow = istDate(deps.now, 1);
  const { rows, matched, total, capped } = w.data;
  const caption = [
    q ? `${matched} of ${total} open follow-ups match “${q}”.` : `${total} open follow-ups.`,
    rows.length < matched ? `Showing the ${rows.length} due first.` : '',
    capped ? `Only the first ${total} by due date are counted and searched here.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <DataTable
      compact
      caption={caption}
      columns={[
        {
          key: 'student',
          header: 'Student',
          render: (r) => (
            <div>
              <a href={`/ops/leads/${r.leadId}`}>{r.student}</a>
              <div className="el-field-hint">
                {r.programme} · {r.nextStep}
              </div>
            </div>
          ),
        },
        { key: 'owner', header: 'Owner' },
        {
          key: 'due',
          header: 'Due',
          render: (r) => <span className="ov-due">{dueLabel(r.due, today, tomorrow)}</span>,
        },
        ...(canClose
          ? [
              {
                key: 'done',
                header: 'Done',
                // Completing needs an outcome (evidence), as in Business Operations.
                render: (r: (typeof rows)[number]) => (
                  <details className="pf-done">
                    <summary className="el-button el-button-secondary">
                      Mark done<span className="el-visually-hidden">: {r.student}</span>
                    </summary>
                    <JsonForm
                      action={`/ops/api/v1/follow-ups/${r.id}`}
                      submitLabel="Done"
                      variant="secondary"
                    >
                      <input type="hidden" name="action" value="complete" />
                      <div className="el-field">
                        <label htmlFor={`fu-${r.id}`}>What happened *</label>
                        <input
                          id={`fu-${r.id}`}
                          name="outcome"
                          className="el-input"
                          required
                          maxLength={1000}
                        />
                      </div>
                    </JsonForm>
                  </details>
                ),
              },
            ]
          : []),
      ]}
      rows={rows}
      rowKey={(r) => r.id}
      empty={
        <EmptyState
          title={q ? 'No follow-ups match this filter' : 'No open follow-ups'}
          description={q ? 'Try a different name, programme or owner.' : undefined}
          action={q ? <a href={clearHref}>Clear the filter</a> : undefined}
        />
      }
    />
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
