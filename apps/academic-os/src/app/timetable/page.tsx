import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { addDays, isIsoDate, type IsoDate } from '@elevate/shared-types';
import { checkTimetableFor, listBatches, listRooms, listSessions, listStaff, todayIst } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { StateBadge } from '../../ui/badges';
import { ConflictList } from '../../ui/conflicts';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Timetable' };

type Search = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);
const UUID = /^[0-9a-f-]{36}$/i;

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
  const today = todayIst();
  const from = str(sp.from) && isIsoDate(str(sp.from)) ? str(sp.from)! : today;
  const toRaw = str(sp.to) && isIsoDate(str(sp.to)) ? str(sp.to)! : addDays(from as IsoDate, 13);
  const to = toRaw < from ? from : toRaw;
  const batchId = str(sp.batchId) && UUID.test(str(sp.batchId)!) ? str(sp.batchId) : undefined;
  const canWrite = can(access.user, 'academic:timetable:write');
  const data = await load(async () => ({
    sessions: await listSessions(db, actor, { batchId, from, to }),
    check: await checkTimetableFor(db, actor, { batchId, from: from as IsoDate, to: to as IsoDate, candidates: [] }),
    batches: can(access.user, 'academic:batches:read') ? await listBatches(db, actor) : [],
    staff: canWrite ? await listStaff(db) : [],
    rooms: canWrite ? await listRooms(db) : [],
  }));
  return (
    <>
      <PageHeader title="Timetable" description="Class sessions with conflict checks. Clashes block scheduling; preferences only warn." />
      <form method="get" className="el-grid" style={{ alignItems: 'end' }}>
        <label>
          Batch{' '}
          <select name="batchId" defaultValue={batchId ?? ''} className="el-select">
            <option value="">All batches</option>
            {data.ok ? data.data.batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>) : null}
          </select>
        </label>
        <label>
          From <input type="date" name="from" defaultValue={from} className="el-input" />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={to} className="el-input" />
        </label>
        <button type="submit" className="el-button el-button-secondary">Show</button>
      </form>
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <Card title={`Conflict check ${from} to ${to}`}>
            <ConflictList verdict={data.data.check.verdict} hard={data.data.check.hard} preferences={data.data.check.preferences} notes={data.data.check.notes} />
          </Card>
          <Card title="Sessions">
            <DataTable compact
              rows={data.data.sessions}
              rowKey={(s) => s.id}
              empty={<EmptyState title="No sessions in this range" />}
              columns={[
                { key: 'date', header: 'Date', render: (s) => `${s.date} ${s.startTime}` },
                { key: 'dur', header: 'Minutes', numeric: true, render: (s) => s.durationMinutes },
                { key: 'batch', header: 'Batch', render: (s) => s.batchCode },
                { key: 'type', header: 'Type', render: (s) => s.sessionType },
                { key: 'chapter', header: 'Planned chapter', render: (s) => s.chapterTitle ?? '—' },
                { key: 'teacher', header: 'Teacher', render: (s) => s.teacherName ?? 'unassigned' },
                { key: 'room', header: 'Room', render: (s) => s.roomCode ?? (s.onlineLink ? 'online' : '—') },
                { key: 'status', header: 'Status', render: (s) => <><StateBadge state={s.status} />{s.statusReason ? ` ${s.statusReason}` : ''}</> },
                {
                  key: 'actions',
                  header: '',
                  render: (s) =>
                    canWrite && s.status === 'scheduled' ? (
                      <details>
                        <summary>Cancel / reschedule</summary>
                        <ApiForm action={MODULE_PATHS.api(`sessions/${s.id}/cancel`)} submitLabel="Cancel session" variant="danger" successMessage="Session cancelled; the teacher was notified." idPrefix={`c-${s.id}`} fields={[{ name: 'reason', label: 'Reason', required: true }]} />
                        <ApiForm
                          action={MODULE_PATHS.api(`sessions/${s.id}/reschedule`)}
                          submitLabel="Reschedule"
                          successMessage="Rescheduled; the original is kept as rescheduled."
                          idPrefix={`r-${s.id}`}
                          fields={[
                            { name: 'date', label: 'New date', type: 'date', required: true },
                            { name: 'startTime', label: 'Start (HH:MM)', type: 'time', required: true },
                            { name: 'reason', label: 'Reason', required: true },
                          ]}
                        />
                      </details>
                    ) : null,
                },
              ]}
            />
          </Card>
          {canWrite ? (
            <Card title="Schedule a session" description="The server checks teacher, batch and room overlaps, closures, class length and workload before saving.">
              {data.data.batches.length === 0 ? (
                <Alert tone="info">Create a batch first.</Alert>
              ) : (
                <ApiForm
                  action={MODULE_PATHS.api('sessions')}
                  wrapAs="sessions"
                  submitLabel="Schedule"
                  successMessage="Session scheduled."
                  idPrefix="sched"
                  fields={[
                    { name: 'batchId', label: 'Batch', type: 'select', required: true, options: data.data.batches.map((b) => ({ value: b.id, label: `${b.code}${b.classLength.minutes ? ` (${b.classLength.minutes} min classes)` : ''}` })) },
                    { name: 'date', label: 'Date', type: 'date', required: true },
                    { name: 'startTime', label: 'Start (HH:MM)', type: 'time', required: true },
                    { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', required: true },
                    { name: 'sessionType', label: 'Type', type: 'select', options: ['teaching', 'practice', 'catch_up', 'test', 'discussion'].map((v) => ({ value: v, label: v })) },
                    { name: 'teacherStaffId', label: 'Teacher', type: 'select', options: data.data.staff.map((s) => ({ value: s.id, label: s.fullName })) },
                    { name: 'roomId', label: 'Room (optional)', type: 'select', options: data.data.rooms.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` })) },
                    { name: 'onlineLink', label: 'Online link (optional)' },
                  ]}
                />
              )}
              <ApiForm action={MODULE_PATHS.api('rooms')} submitLabel="Add room" successMessage="Room added." idPrefix="room" fields={[{ name: 'code', label: 'Room code', required: true }, { name: 'name', label: 'Room name', required: true }, { name: 'capacity', label: 'Capacity', type: 'number' }]} />
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
