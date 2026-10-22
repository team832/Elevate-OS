/**
 * "Your day" on the Overview (OPS-024): the signed-in person's classes and meetings today, their
 * follow-ups, approvals and tasks. Every panel checks its own permission and scope.
 */
import type { ReactNode } from 'react';
import { can, type Permission } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { istToday } from '../../domain';
import { APPOINTMENT_TYPE_LABELS } from '../../domain/appointments';
import { followUpAge } from '../../domain/follow-up-age';
import { namesOf } from '../../server/admissions';
import { listApprovalInbox } from '../../server/approvals';
import { listAppointments } from '../../server/appointments';
import { listDemos } from '../../server/demos';
import { listFollowUps } from '../../server/follow-ups';
import { myDay, NO_STAFF_RECORD } from '../../server/staff-tasks';
import { StatCard } from '../../ui/charts';
import { fmtDateTime, humanise } from '../../ui/format';
import { load } from '../../ui/frame';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { AttendanceCell, FollowUpDone, linkOf } from '../admissions/_components/demo-bits';
import { dueText, TaskBadge } from '../tasks/_components/task-views';

const time = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
});

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

export async function Today({ user }: { user: AuthenticatedUser }) {
  const now = new Date();
  const today = istToday(now);
  const when = <T,>(permission: Permission, fn: Parameters<typeof load<T>>[0]) =>
    can(user, permission) ? load(fn) : null;
  const [demosToday, meetings, followUps, tasks, approvals] = await Promise.all([
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
    load((db) => listApprovalInbox(db, user)),
  ]);
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
                    linked={linkOf(r, s)}
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
    </div>
  );
}
