import type { ReactNode } from 'react';
import { can, type Permission } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import {
  Alert,
  ButtonLink,
  DataTable,
  EmptyState,
  PageHeader,
  StatTile,
  StatusBadge,
} from '@elevate/shared-ui';
import { addDays, istToday } from '../domain';
import { APPOINTMENT_TYPE_LABELS } from '../domain/appointments';
import { followUpAge } from '../domain/follow-up-age';
import { namesOf } from '../server/admissions';
import { listApprovalInbox } from '../server/approvals';
import { listAppointments } from '../server/appointments';
import { activitySeries, buildDashboard } from '../server/dashboard';
import { listDemos } from '../server/demos';
import { listFollowUps } from '../server/follow-ups';
import { buildAdmissionsFunnel } from '../server/reports/admissions';
import { myDay, NO_STAFF_RECORD } from '../server/staff-tasks';
import { studentSearchQuery } from '../server/students-schemas';
import { listStudents } from '../server/students';
import { BarChart, LineChart, StatCard } from '../ui/charts';
import { CrossModulePanels } from '../ui/cross-module';
import { decisionTone, fmtDate, fmtDateTime, humanise } from '../ui/format';
import { Frame, gate, load, Section } from '../ui/frame';
import { RecordTable } from '../ui/record-table';
import { Segment } from '../ui/sections';
import {
  ConversionBreakdown,
  demoListHref,
  Funnel,
  OutcomeDonut,
} from './reports/_components/admissions-charts';
import { AttendanceCell, FollowUpDone } from './admissions/_components/demo-bits';
import { dueText, TaskBadge } from './tasks/_components/task-views';

export const dynamic = 'force-dynamic';

const time = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
});
const dayLabel = (iso: string) => fmtDate(iso).replace(/ \d{4}$/, '');

/** /ops — "Today" (OPS-024): the signed-in person's work first, then the figures. Every panel checks its own permission and scope. */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const access = await gate('ops:module:access', '/ops');
  const allStaff = (await searchParams).staff === 'all';
  const user = access.user;
  return (
    <Frame access={access} active="home">
      <PageHeader
        title="Today"
        description={`Your classes, follow-ups, approvals and tasks for ${fmtDate(istToday(new Date()))}, then the admissions figures.`}
        actions={
          <>
            {can(user, 'ops:tasks:write') ? (
              <ButtonLink variant="primary" href="/ops/tasks?new=1">
                Log a task
              </ButtonLink>
            ) : null}
            {can(user, 'ops:leads:write') ? (
              <ButtonLink variant="secondary" href="/ops/admissions?new=1">
                Book a demo
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <Section label="Loading today…">
        <Dashboard user={user} allStaff={allStaff} />
      </Section>
    </Frame>
  );
}

type Loaded<T> = Awaited<ReturnType<typeof load<T>>> | null;

const notForRole = <p className="el-field-hint">Not available for your role.</p>;

/** A panel's body: "not available" without the permission, the error state on failure. */
function Panel<T>({ r, children }: { r: Loaded<T>; children: (data: T) => ReactNode }) {
  if (!r) return notForRole;
  return r.ok ? children(r.data) : r.view;
}

/** A KPI value from a loaded source: the figure, or why there is none. */
const figure = <T,>(r: Loaded<T>, pick: (d: T) => number | null) =>
  r === null ? null : r.ok ? pick(r.data) : 'Source unavailable';

async function Dashboard({ user, allStaff }: { user: AuthenticatedUser; allStaff: boolean }) {
  const now = new Date();
  const today = istToday(now);
  const last30 = { from: addDays(today, -29), to: today };
  const when = <T,>(permission: Permission, fn: Parameters<typeof load<T>>[0]) =>
    can(user, permission) ? load(fn) : null;
  const [series, demos, demosToday, meetings, followUps, tasks, funnel, students, approvals, mgmt] =
    await Promise.all([
      when('ops:leads:read', (db) => activitySeries(db, user, { now })),
      when('ops:leads:read', (db) => listDemos(db, user, {}, now)),
      // shortcut: classes of the first 25 current demos (one list page); add a server read if a day has more.
      when('ops:leads:read', async (db) => {
        const list = await listDemos(db, user, { from: today, to: today }, now);
        const ids = list.rows.flatMap((r) => r.sessions.map((s) => s.recordedBy));
        return { ...list, names: await namesOf(db, ids) };
      }),
      when('ops:appointments:read', (db) =>
        listAppointments(db, user, { from: today, to: today }, 50),
      ),
      when('ops:leads:read', async (db) =>
        (await listFollowUps(db, user, { view: 'mine', now })).filter((f) => f.dueDate <= today),
      ),
      when('ops:tasks:read', (db) => myDay(db, user, today)),
      when('ops:admissions:read', (db) => buildAdmissionsFunnel(db, user, { ...last30, now })),
      when('ops:students:read', (db) =>
        listStudents(db, user, studentSearchQuery.parse({ view: 'active', limit: 1 })),
      ),
      load((db) => listApprovalInbox(db, user)),
      when('ops:dashboard:read', (db) => buildDashboard(db, user, { now })),
    ]);
  const own = series?.ok && series.data.scope === 'own';
  const write = can(user, 'ops:leads:write');

  const todayRows = [
    ...(demosToday?.ok
      ? demosToday.data.rows.flatMap((r) =>
          r.sessions
            .filter((s) => istToday(s.startsAt) === today)
            .map((s) => {
              const what = `Demo day ${s.dayNumber}, class ${s.sessionNumber} · ${s.subject ?? 'Class'}`;
              return {
                id: s.id as string,
                at: s.startsAt,
                what,
                who: r.studentName,
                with: s.teacherName ?? 'Teacher not set',
                status: (
                  <AttendanceCell
                    action={`/ops/api/v1/demos/${r.demo.id}/sessions/${s.id}`}
                    label={`${r.studentName}, ${what}, ${time.format(s.startsAt)}`}
                    s={s}
                    recorder={demosToday.data.names.get(s.recordedBy ?? '') ?? 'Staff member'}
                    write={write}
                  />
                ) as ReactNode,
                href: `/ops/admissions?open=${r.demo.id}`,
              };
            }),
        )
      : []),
    ...(meetings?.ok
      ? meetings.data.rows.map((a) => ({
          id: a.id as string,
          at: a.startsAt,
          what: APPOINTMENT_TYPE_LABELS[a.type],
          who: a.personName,
          with: a.staffName,
          status: humanise(a.status),
          href: `/ops/meetings?open=${a.id}`,
        }))
      : []),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const todayFailed =
    demosToday?.ok === false ? demosToday : meetings?.ok === false ? meetings : null;
  const openTasks = (d: NonNullable<Awaited<ReturnType<typeof myDay>>>) => [
    ...d.carried,
    ...d.open,
  ];

  // What needs the signed-in person today; each figure jumps to its list below.
  const mine = [
    {
      key: 'today',
      label: 'Classes and meetings today',
      value:
        demosToday === null && meetings === null
          ? null
          : todayFailed
            ? 'Source unavailable'
            : todayRows.length,
      note: 'In time order below',
      href: '#today-classes',
    },
    {
      key: 'followups',
      label: 'Your follow-ups due',
      value: figure(followUps, (d) => d.length),
      note: 'Overdue or due today',
      href: '#my-follow-ups',
    },
    {
      key: 'approvals',
      label: 'Approvals waiting for you',
      value: approvals.ok ? approvals.data.total : 'Source unavailable',
      note: 'Requests you may decide',
      href: '#my-approvals',
    },
    {
      key: 'tasks',
      label: 'Your open tasks',
      value: figure(tasks, (d) => (d ? openTasks(d).length : null)),
      note: 'Due today or carried forward',
      href: '#my-tasks',
    },
  ];

  const kpis: { key: string; show: boolean; card: ReactNode }[] = [
    {
      key: 'leads',
      show: series !== null,
      card: (
        <StatCard
          label="New leads this week"
          value={figure(series, (d) => d.newLeadsThisWeek)}
          note="Monday to today · line: last 30 days"
          trend={series?.ok ? series.data.leadsPerDay.map((p) => p.count) : undefined}
          href="/ops/leads"
        />
      ),
    },
    {
      key: 'current',
      show: demos !== null,
      card: (
        <StatCard
          label="Current demos"
          value={figure(demos, (d) => d.kpis.current)}
          note="First class on or before today, no outcome yet"
          href="/ops/admissions?view=current"
        />
      ),
    },
    {
      key: 'followups',
      show: demos !== null,
      card: (
        <StatCard
          label="Demo follow-ups due"
          value={figure(demos, (d) => d.kpis.followUpsDue)}
          note="Overdue or due today"
          href="/ops/admissions?followUp=due"
        />
      ),
    },
    {
      key: 'conversions',
      show: demos !== null,
      card: (
        <StatCard
          label="Conversions this month"
          value={figure(demos, (d) => d.kpis.conversions)}
          note="Demos converted to admission · line: last 30 days"
          trend={series?.ok ? series.data.conversionsPerDay.map((p) => p.count) : undefined}
          href="/ops/admissions?view=previous&outcome=converted"
        />
      ),
    },
    {
      key: 'students',
      show: students !== null,
      card: (
        <StatCard
          label="Active students"
          value={figure(students, (d) => d.total)}
          note="Enrolment confirmed by Academic OS"
          href="/ops/students"
        />
      ),
    },
  ];

  return (
    <div className="el-stack">
      <ul className="el-grid ops-kpis" aria-label="What needs you today">
        {mine.map(({ key, ...k }) => (
          <li key={key}>
            <StatCard {...k} />
          </li>
        ))}
      </ul>

      <Segment
        id="today-classes"
        title="Classes and meetings today"
        description="In time order. Record attendance with one tap once a class has started."
        flush
        actions={<a href="/ops/meetings?view=week">This week's meetings</a>}
      >
        {demosToday === null && meetings === null ? (
          notForRole
        ) : todayFailed ? (
          todayFailed.view
        ) : (
          <RecordTable
            caption={`${todayRows.length} today${demosToday?.ok && demosToday.data.total > demosToday.data.pageSize ? ` · classes of the first ${demosToday.data.pageSize} current demos; see the demo list for the rest` : ''}`}
            rows={todayRows}
            rowKey={(r) => r.id}
            rowHref={(r) => r.href}
            linkColumn="who"
            empty="No demo classes or meetings today."
            columns={[
              { key: 'at', header: 'Time (IST)', render: (r) => time.format(r.at) },
              { key: 'who', header: 'Student' },
              { key: 'what', header: 'What' },
              { key: 'with', header: 'With' },
              { key: 'status', header: 'Attendance or status' },
            ]}
          />
        )}
      </Segment>

      <Segment
        id="my-follow-ups"
        title="Your follow-ups due"
        description="Follow-ups you own that are overdue or due today, oldest first."
        flush
        actions={<a href="/ops/leads?flag=overdue">Leads with an overdue follow-up</a>}
      >
        <Panel r={followUps}>
          {(rows) => (
            <RecordTable
              caption={`${rows.length} due${rows.length > 10 ? ' · showing the 10 oldest' : ''}`}
              rows={rows.slice(0, 10)}
              rowKey={(f) => f.id}
              rowHref={(f) => `/ops/leads/${f.leadId}`}
              linkColumn="studentName"
              empty="Nothing due. Follow-ups you own appear here on their due day."
              columns={[
                { key: 'studentName', header: 'Student' },
                { key: 'title', header: 'Next step' },
                { key: 'dueDate', header: 'Due', render: (f) => followUpAge(f.dueDate, today) },
                ...(write
                  ? [
                      {
                        key: 'done',
                        header: 'Action',
                        render: (f: (typeof rows)[number]) => (
                          <FollowUpDone id={f.id} title={f.title} />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </Panel>
      </Segment>

      <div className="ops-panels">
        <Segment
          id="my-approvals"
          title="Approvals waiting for you"
          flush
          actions={<a href="/ops/operations/approvals">Open approvals</a>}
        >
          <Panel r={approvals}>
            {(d) => {
              const items = d.sources.flatMap((s) => s.items);
              return d.sources.length === 0 ? (
                <p className="el-field-hint">Your role does not decide approvals.</p>
              ) : (
                <RecordTable
                  caption={`${items.length} waiting${items.length > 5 ? ' · showing 5' : ''}${d.unavailable ? ' · some lists could not be loaded' : ''}`}
                  rows={items.slice(0, 5)}
                  rowKey={(i) => i.id}
                  rowHref={(i) => i.link}
                  empty="Nothing is waiting for your decision."
                  columns={[
                    { key: 'title', header: 'Request' },
                    {
                      key: 'requestedByName',
                      header: 'From',
                      render: (i) => i.requestedByName ?? 'Not recorded',
                    },
                    {
                      key: 'requestedAt',
                      header: 'Asked',
                      render: (i) => fmtDateTime(i.requestedAt),
                    },
                  ]}
                />
              );
            }}
          </Panel>
        </Segment>
        <Segment
          id="my-tasks"
          title="Your tasks today"
          flush
          actions={<a href="/ops/tasks">Open My day</a>}
        >
          <Panel r={tasks}>
            {(d) =>
              d ? (
                <RecordTable
                  caption={`${openTasks(d).length} open · ${d.counts.done} done today`}
                  rows={openTasks(d)}
                  rowKey={(t) => t.id}
                  rowHref={(t) => `/ops/tasks?open=${t.id}`}
                  empty="Nothing open. Log work on My day as it comes in."
                  columns={[
                    { key: 'title', header: 'Task' },
                    { key: 'due', header: 'Due', render: dueText },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (t) => <TaskBadge status={t.status} overdue={t.overdue} />,
                    },
                  ]}
                />
              ) : (
                <p className="el-field-hint">{NO_STAFF_RECORD}</p>
              )
            }
          </Panel>
        </Segment>
      </div>

      <Segment
        title="Admissions figures"
        description={`As of ${fmtDateTime(now)}. Charts cover the last 30 days. Missing data shows as missing, never as zero${own ? '; limited to your own leads, demos and follow-ups' : ''}.`}
        actions={<a href="/ops/reports/admissions">Admissions report</a>}
      >
        <ul className="el-grid ops-kpis ops-kpis-dense" aria-label="Admissions figures">
          {kpis
            .filter((k) => k.show)
            .map((k) => (
              <li key={k.key}>{k.card}</li>
            ))}
        </ul>
      </Segment>

      <div className="ops-panels">
        <Segment
          title="Admissions funnel"
          description="Leads first received in the last 30 days, by the furthest stage reached."
          actions={<a href="/ops/reports/admissions#funnel">Open the report</a>}
        >
          <Panel r={funnel}>{(d) => <Funnel report={d} />}</Panel>
        </Segment>
        <Segment
          title="New leads per day"
          description="Leads received each day, last 30 days; merged duplicates excluded."
          actions={<a href="/ops/leads">Open leads</a>}
        >
          <Panel r={series}>
            {(d) => (
              <LineChart
                label="New leads per day, last 30 days"
                data={d.leadsPerDay.map((p) => ({ label: dayLabel(p.date), value: p.count }))}
                emptyText="No leads were received in the last 30 days."
              />
            )}
          </Panel>
        </Segment>
        <Segment
          title="Demos by outcome"
          description="Demos with a class in the last 30 days."
          actions={<a href={demoListHref(last30)}>Open demos</a>}
        >
          <Panel r={funnel}>{(d) => <OutcomeDonut report={d} />}</Panel>
        </Segment>
        <Segment
          title="Demo conversion by programme"
          description="Converted ÷ demos with an outcome, last 30 days."
          actions={<a href="/ops/reports/admissions#demo-conversion">Open the report</a>}
        >
          <Panel r={funnel}>
            {(d) => (
              <ConversionBreakdown
                title="By programme"
                rows={d.demoConversion.byProgramme}
                window={d.window}
                filter={(g) => (g.programmeCode ? { programme: g.programmeCode } : null)}
              />
            )}
          </Panel>
        </Segment>
        <Segment
          title="Follow-ups"
          description="Open follow-ups by due date, and those completed in the last 30 days."
          actions={<a href="/ops/leads?flag=overdue">Leads with an overdue follow-up</a>}
        >
          <Panel r={series}>
            {(d) => (
              <BarChart
                label="Follow-ups by status"
                data={[
                  { label: 'Overdue', value: d.followUps.overdue, href: '/ops/leads?flag=overdue' },
                  { label: 'Due today', value: d.followUps.dueToday },
                  { label: 'Due later', value: d.followUps.upcoming },
                  { label: 'Completed (30 days)', value: d.followUps.doneInWindow },
                ]}
              />
            )}
          </Panel>
        </Segment>
      </div>

      <Management r={mgmt} allStaff={allStaff} />
    </div>
  );
}

/** Defined KPIs, workload and the Academic/Marketing summaries (ops:dashboard:read only). */
function Management({
  r,
  allStaff,
}: {
  r: Loaded<Awaited<ReturnType<typeof buildDashboard>>>;
  allStaff: boolean;
}) {
  if (!r || !r.ok)
    return <Segment title="Team workload and other modules">{r ? r.view : notForRole}</Segment>;
  const d = r.data;
  const busy = d.workload.rows.filter((w) => w.totalOpenItems > 0);
  return (
    <>
      <Segment
        title="Defined KPIs"
        description={
          <>
            Week {fmtDate(d.window.from)} – {fmtDate(d.window.to)}. Conversion uses the cohort week{' '}
            {fmtDate(d.cohort.from)} – {fmtDate(d.cohort.to)} with a {d.cohort.windowDays}-day
            window{' '}
            <StatusBadge tone={decisionTone(d.cohort.setting.decisionState)}>
              {d.cohort.setting.decisionState}
            </StatusBadge>
            . All teams, not only yours.
          </>
        }
      >
        <div className="el-grid">
          <StatTile label="New leads" metric={d.kpis.newLeads} />
          <StatTile label="Lead → admission conversion" metric={d.kpis.conversion} />
          <StatTile
            label="Counselling & demo follow-up compliance"
            metric={d.kpis.followUpCompliance}
          />
          <StatTile label="Overdue follow-ups" metric={d.kpis.overdueWork} />
        </div>
      </Segment>
      <Segment
        title="Workload per staff member"
        description={`${allStaff ? 'All active staff' : 'Staff with at least one open item'}, sorted by name. A capacity view, not a performance score or a ranking.`}
        flush
        actions={
          busy.length < d.workload.rows.length ? (
            allStaff ? (
              <a href="/ops">Only staff with open items</a>
            ) : (
              <a href="/ops?staff=all">Show all {d.workload.rows.length} staff</a>
            )
          ) : null
        }
      >
        <DataTable
          rows={allStaff ? d.workload.rows : busy}
          rowKey={(w) => w.staffId}
          empty={
            <EmptyState
              title={d.workload.rows.length ? 'No open items assigned' : 'No active staff'}
            />
          }
          columns={[
            { key: 'fullName', header: 'Staff member' },
            { key: 'openFollowUps', header: 'Open follow-ups', numeric: true },
            { key: 'openAdmissions', header: 'Open admissions', numeric: true },
            { key: 'totalOpenItems', header: 'Total', numeric: true },
          ]}
        />
      </Segment>
      {d.workload.unassigned > 0 ? (
        <Alert tone="warning">{d.workload.unassigned} open item(s) have no owner.</Alert>
      ) : null}
      {d.crossModule ? (
        <details className="el-explain">
          <summary>Academic and Marketing summaries</summary>
          <div className="ops-panels">
            <CrossModulePanels summaries={d.crossModule} />
          </div>
        </details>
      ) : null}
    </>
  );
}
