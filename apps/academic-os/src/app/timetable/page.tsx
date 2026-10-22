import type { Metadata } from 'next';
import { can, scopeFor } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Button, Card, DataTable, EmptyState, PageHeader, Subnav } from '@elevate/shared-ui';
import { addDays, isIsoDate, type IsoDate } from '@elevate/shared-types';
import type { PageAccess } from '@elevate/server-kit/next';
import { eachDate, weekStart } from '../../domain';
import {
  checkTimetableFor,
  listBatches,
  listRooms,
  listSessions,
  listStaff,
  todayIst,
  type SessionListRow,
} from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { StateBadge } from '../../ui/badges';
import { ConflictList } from '../../ui/conflicts';
import { Filter } from '../../ui/filters';
import { PrintButton } from '../../ui/print-button';
import { AcademicShell, LoadError, TIMETABLE_TABS, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Timetable' };

type Search = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);
const UUID = /^[0-9a-f-]{36}$/i;
const STATUSES = ['scheduled', 'held', 'cancelled', 'rescheduled'] as const;
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
const statusLabel = (s: string) => (s === 'held' ? 'delivered' : s);

export default async function TimetablePage({ searchParams }: { searchParams: Search }) {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:timetable:read', MODULE_PATHS.timetable);
  return (
    <AcademicShell access={access} active="timetable" loading="Loading timetable…">
      {access.status === 'allowed' ? <Body access={access} searchParams={searchParams} /> : null}
    </AcademicShell>
  );
}

async function Body({ access, searchParams }: { access: PageAccess; searchParams: Search }) {
  const sp = await searchParams;
  const db = getDb();
  const actor = actorFor(access.user);
  const week = str(sp.view) === 'week';
  const fromRaw = str(sp.from) && isIsoDate(str(sp.from)) ? str(sp.from)! : todayIst();
  const from = week ? weekStart(fromRaw) : fromRaw;
  const toRaw =
    str(sp.to) && isIsoDate(str(sp.to)) ? str(sp.to)! : addDays(from as IsoDate, week ? 6 : 13);
  const to = week ? addDays(from as IsoDate, 6) : toRaw < from ? from : toRaw;
  const uuid = (k: string) => (str(sp[k]) && UUID.test(str(sp[k])!) ? str(sp[k]) : undefined);
  const filter = {
    batchId: uuid('batchId'),
    teacherId: uuid('teacherId'),
    roomId: uuid('roomId'),
    status: STATUSES.find((s) => s === str(sp.status)),
  };
  const canWrite = can(access.user, 'academic:timetable:write');
  const seesAll = scopeFor(access.user, 'academic:timetable:read') === 'all';
  const data = await load(async () => ({
    sessions: await listSessions(db, actor, { ...filter, from, to }),
    check: await checkTimetableFor(db, actor, {
      batchId: filter.batchId,
      from: from as IsoDate,
      to: to as IsoDate,
      candidates: [],
    }),
    batches: can(access.user, 'academic:batches:read') ? await listBatches(db, actor) : [],
    staff: seesAll ? await listStaff(db) : [],
    rooms: seesAll ? await listRooms(db) : [],
  }));
  const select = (
    name: string,
    label: string,
    options: { value: string; label: string }[],
    value?: string,
  ) => (
    <Filter
      id={`tt-${name}`}
      name={name}
      label={label}
      type="select"
      options={options}
      value={value}
    />
  );
  return (
    <>
      <PageHeader
        title="Timetable"
        description={`${week ? 'Week' : 'Agenda'} from ${from} to ${to} (IST). Clashes block scheduling; preferences only warn. Delivered means a teacher marked the class delivered.`}
        actions={<PrintButton label="Print timetable" />}
        tabs={
          <Subnav
            label="Timetable views"
            items={TIMETABLE_TABS}
            current={week ? `${MODULE_PATHS.timetable}?view=week` : MODULE_PATHS.timetable}
          />
        }
      />
      <form method="get" className="el-inline-form acd-no-print">
        {week ? <input type="hidden" name="view" value="week" /> : null}
        {data.ok
          ? select(
              'batchId',
              'Batch',
              data.data.batches.map((b) => ({ value: b.id, label: b.code })),
              filter.batchId,
            )
          : null}
        {data.ok && seesAll
          ? select(
              'teacherId',
              'Teacher',
              data.data.staff.map((s) => ({ value: s.id, label: s.fullName })),
              filter.teacherId,
            )
          : null}
        {data.ok && seesAll
          ? select(
              'roomId',
              'Room',
              data.data.rooms.map((r) => ({ value: r.id, label: r.code })),
              filter.roomId,
            )
          : null}
        {select(
          'status',
          'Status',
          STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
          filter.status,
        )}
        <Filter
          id="tt-from"
          name="from"
          label={week ? 'Week of' : 'From'}
          type="date"
          value={from}
        />
        {week ? null : <Filter id="tt-to" name="to" label="To" type="date" value={to} />}
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          {week ? (
            <WeekGrid from={from} sessions={data.data.sessions} />
          ) : (
            <Agenda sessions={data.data.sessions} canWrite={canWrite} />
          )}
          <Card title={`Conflict check ${from} to ${to}`}>
            <ConflictList
              verdict={data.data.check.verdict}
              hard={data.data.check.hard}
              preferences={data.data.check.preferences}
              notes={data.data.check.notes}
            />
          </Card>
          {canWrite ? (
            <ScheduleForms
              batches={data.data.batches}
              staff={data.data.staff}
              rooms={data.data.rooms}
            />
          ) : null}
        </div>
      )}
    </>
  );
}

const sessionLine = (s: SessionListRow) =>
  `${s.startTime} · ${s.batchCode} · ${s.subjectName ?? s.sessionType}`;

/** The primary view: an accessible list grouped by day. */
function Agenda({ sessions, canWrite }: { sessions: SessionListRow[]; canWrite: boolean }) {
  if (sessions.length === 0)
    return (
      <EmptyState
        title="No classes in this range"
        description="Change the dates or filters, or schedule a class below."
      />
    );
  const days = [...new Set(sessions.map((s) => s.date))];
  return (
    <>
      {days.map((day) => (
        <Card key={day} title={dayLabel(day)}>
          <DataTable
            compact
            rows={sessions.filter((s) => s.date === day)}
            rowKey={(s) => s.id}
            columns={[
              {
                key: 'time',
                header: 'Time',
                render: (s) => (
                  <a href={MODULE_PATHS.attendance(s.id)}>
                    <strong>{s.startTime}</strong>
                    <span className="el-visually-hidden"> {s.batchCode}</span>
                  </a>
                ),
              },
              { key: 'dur', header: 'Minutes', numeric: true, render: (s) => s.durationMinutes },
              { key: 'batch', header: 'Batch', render: (s) => s.batchCode },
              {
                key: 'subject',
                header: 'Subject',
                render: (s) => s.subjectName ?? s.sessionType.replace('_', ' '),
              },
              {
                key: 'teacher',
                header: 'Planned teacher',
                render: (s) => s.teacherName ?? 'Not set',
              },
              {
                key: 'room',
                header: 'Room or link',
                render: (s) => s.roomCode ?? (s.onlineLink ? 'Online' : '—'),
              },
              {
                key: 'status',
                header: 'Delivery',
                render: (s) => (
                  <>
                    <StateBadge state={statusLabel(s.status)} />
                    {s.statusReason ? ` ${s.statusReason}` : ''}
                  </>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (s) =>
                  canWrite && s.status === 'scheduled' ? (
                    <details className="acd-no-print">
                      <summary>Cancel or reschedule</summary>
                      <ApiForm
                        action={MODULE_PATHS.api(`sessions/${s.id}/cancel`)}
                        submitLabel="Cancel class"
                        variant="danger"
                        successMessage="Class cancelled; the teacher was notified."
                        idPrefix={`c-${s.id}`}
                        fields={[{ name: 'reason', label: 'Reason', required: true }]}
                      />
                      <ApiForm
                        action={MODULE_PATHS.api(`sessions/${s.id}/reschedule`)}
                        submitLabel="Reschedule class"
                        successMessage="Rescheduled; the original is kept and linked."
                        idPrefix={`r-${s.id}`}
                        fields={[
                          { name: 'date', label: 'New date', type: 'date', required: true },
                          {
                            name: 'startTime',
                            label: 'Start (HH:MM)',
                            type: 'time',
                            required: true,
                          },
                          { name: 'reason', label: 'Reason', required: true },
                        ]}
                      />
                    </details>
                  ) : null,
              },
            ]}
          />
        </Card>
      ))}
    </>
  );
}

/** Read-only week grid; each block opens its class page. */
function WeekGrid({ from, sessions }: { from: string; sessions: SessionListRow[] }) {
  return (
    <div className="acd-week" role="list" aria-label={`Week of ${from}`}>
      {eachDate(from, addDays(from as IsoDate, 6)).map((day) => {
        const list = sessions.filter((s) => s.date === day);
        return (
          <section key={day} className="acd-week-day" role="listitem" aria-label={dayLabel(day)}>
            <h3>{dayLabel(day)}</h3>
            {list.length === 0 ? <p className="el-field-hint">No classes</p> : null}
            {list.map((s) => (
              <a
                key={s.id}
                href={MODULE_PATHS.attendance(s.id)}
                className="acd-week-block"
                data-status={s.status}
              >
                {sessionLine(s)}
                <br />
                {s.teacherName ?? 'Teacher not set'} ·{' '}
                {s.roomCode ?? (s.onlineLink ? 'Online' : 'No room')} · {statusLabel(s.status)}
              </a>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ScheduleForms({
  batches,
  staff,
  rooms,
}: {
  batches: Awaited<ReturnType<typeof listBatches>>;
  staff: Awaited<ReturnType<typeof listStaff>>;
  rooms: Awaited<ReturnType<typeof listRooms>>;
}) {
  return (
    <Card
      title="Schedule a single class"
      description="For a weekly series use Patterns. The server checks teacher, batch, room and student overlaps, closures, teacher availability, class length and workload before saving."
    >
      {batches.length === 0 ? (
        <Alert tone="info">Create a batch first.</Alert>
      ) : (
        <ApiForm
          action={MODULE_PATHS.api('sessions')}
          wrapAs="sessions"
          submitLabel="Schedule class"
          successMessage="Class scheduled."
          idPrefix="sched"
          fields={[
            {
              name: 'batchId',
              label: 'Batch',
              type: 'select',
              required: true,
              options: batches.map((b) => ({
                value: b.id,
                label: `${b.code}${b.classLength.minutes ? ` (${b.classLength.minutes} min classes)` : ''}`,
              })),
            },
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'startTime', label: 'Start (HH:MM)', type: 'time', required: true },
            {
              name: 'durationMinutes',
              label: 'Duration (minutes)',
              type: 'number',
              required: true,
            },
            {
              name: 'sessionType',
              label: 'Type',
              type: 'select',
              options: ['teaching', 'practice', 'catch_up', 'test', 'discussion'].map((v) => ({
                value: v,
                label: v.replace('_', ' '),
              })),
            },
            {
              name: 'teacherStaffId',
              label: 'Teacher',
              type: 'select',
              options: staff.map((s) => ({ value: s.id, label: s.fullName })),
            },
            {
              name: 'roomId',
              label: 'Room (optional)',
              type: 'select',
              options: rooms.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` })),
            },
            { name: 'onlineLink', label: 'Online link (optional)' },
          ]}
        />
      )}
      <details>
        <summary>Add a room</summary>
        <ApiForm
          action={MODULE_PATHS.api('rooms')}
          submitLabel="Add room"
          successMessage="Room added."
          idPrefix="room"
          fields={[
            { name: 'code', label: 'Room code', required: true },
            { name: 'name', label: 'Room name', required: true },
            { name: 'capacity', label: 'Capacity', type: 'number' },
          ]}
        />
      </details>
    </Card>
  );
}
