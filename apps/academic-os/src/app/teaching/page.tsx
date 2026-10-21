import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { getBatch, getCourse, listClassRecords, listSessions, todayIst } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiButton, ApiForm } from '../../ui/api-form';
import { StateBadge, fmtDateTime } from '../../ui/badges';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Teaching log' };

const COMPLETION = [{ value: 'completed', label: 'completed' }, { value: 'partial', label: 'partial' }];
const ACTIVITY = ['main', 'practice', 'catch_up', 'test', 'discussion'].map((v) => ({ value: v, label: v }));

export default async function TeachingPage() {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:classes:read', MODULE_PATHS.teaching);
  return (
    <AcademicShell access={access} active="teaching" loading="Loading teaching log…">
      {access.status === 'allowed' ? <Body access={access} /> : null}
    </AcademicShell>
  );
}

async function Body({ access }: { access: PageAccess }) {
  const db = getDb();
  const actor = actorFor(access.user);
  const today = todayIst();
  const canRecord = can(access.user, 'academic:classes:record');
  const canVerify = can(access.user, 'academic:classes:verify');
  const data = await load(async () => {
    const sessions = canRecord && can(access.user, 'academic:timetable:read') ? await listSessions(db, actor, { from: addDays(today as IsoDate, -14), to: today }) : [];
    const loggable = sessions.filter((s) => s.status === 'scheduled' || s.status === 'held');
    // Chapters of each batch's course, for the "log class" chapter picker.
    const chaptersByBatch = new Map<string, { value: string; label: string }[]>();
    for (const batchId of new Set(loggable.map((s) => s.batchId))) {
      const batch = await load(() => getBatch(db, actor, batchId));
      if (!batch.ok) continue;
      const course = await getCourse(db, batch.data.courseId);
      chaptersByBatch.set(batchId, course.chapters.filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: `${c.code} ${c.title}` })));
    }
    return { loggable, chaptersByBatch, records: await listClassRecords(db, actor, {}) };
  });
  return (
    <>
      <PageHeader title="Teaching log" description="What was taught in each held session. Only verified records count as delivered hours." />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          {canRecord ? (
            <Card title="Your sessions (last 14 days)" description="Teachers see only the sessions they teach.">
              <DataTable compact
                rows={data.data.loggable}
                rowKey={(s) => s.id}
                empty={<EmptyState title="No sessions to log" description="Nothing held or scheduled for you in the last 14 days." />}
                columns={[
                  { key: 'when', header: 'Session', render: (s) => `${s.date} ${s.startTime} · ${s.batchCode} · ${s.durationMinutes} min` },
                  { key: 'planned', header: 'Planned chapter', render: (s) => s.chapterTitle ?? '—' },
                  { key: 'status', header: 'Status', render: (s) => <StateBadge state={s.status} /> },
                  { key: 'att', header: 'Attendance', render: (s) => <a href={MODULE_PATHS.attendance(s.id)}>Take attendance</a> },
                  {
                    key: 'log',
                    header: 'Log class',
                    render: (s) => (
                      <details>
                        <summary>Log what was taught</summary>
                        <ApiForm
                          action={MODULE_PATHS.api('class-records')}
                          extra={{ sessionId: s.id }}
                          submitLabel="Submit record"
                          successMessage="Recorded. It counts as delivered once a coordinator verifies it."
                          idPrefix={`log-${s.id}`}
                          fields={[
                            { name: 'chapterId', label: 'Chapter covered', type: 'select', required: true, options: data.data.chaptersByBatch.get(s.batchId) ?? [] },
                            { name: 'completion', label: 'Completion', type: 'select', required: true, options: COMPLETION },
                            { name: 'actualMinutes', label: 'Actual minutes', type: 'number', required: true, defaultValue: s.durationMinutes },
                            { name: 'activity', label: 'Activity', type: 'select', options: ACTIVITY },
                            { name: 'notes', label: 'Notes', type: 'textarea' },
                            { name: 'evidence', label: 'Evidence (link or note)' },
                          ]}
                        />
                      </details>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
          <Card title="Class records">
            <DataTable compact
              rows={data.data.records}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No class records yet" description="Nothing has been logged, so nothing counts as delivered." />}
              columns={[
                { key: 'session', header: 'Session', render: (r) => `${r.sessionDate} ${r.sessionStart} · ${r.batchCode}` },
                { key: 'chapter', header: 'Chapter', render: (r) => `${r.chapterCode} ${r.chapterTitle}` },
                { key: 'teacher', header: 'Teacher', render: (r) => r.teacherName },
                { key: 'minutes', header: 'Actual / planned min', numeric: true, render: (r) => `${r.actualMinutes} / ${r.plannedMinutes}` },
                { key: 'completion', header: 'Completion', render: (r) => r.completion },
                { key: 'state', header: 'State', render: (r) => <><StateBadge state={r.state} />{r.correctionReason ? ` correction: ${r.correctionReason}` : ''}</> },
                { key: 'verified', header: 'Verified', render: (r) => fmtDateTime(r.verifiedAt) },
                {
                  key: 'actions',
                  header: '',
                  render: (r) =>
                    canVerify && r.state !== 'superseded' ? (
                      <div className="el-stack">
                        {r.state === 'submitted' ? <ApiButton action={MODULE_PATHS.api(`class-records/${r.id}/verify`)} label="Verify" successMessage="Verified." /> : null}
                        <details>
                          <summary>Correct</summary>
                          <ApiForm
                            action={MODULE_PATHS.api(`class-records/${r.id}/correct`)}
                            submitLabel="Save correction"
                            successMessage="Corrected; the original is kept as superseded."
                            idPrefix={`cor-${r.id}`}
                            fields={[
                              { name: 'actualMinutes', label: 'Actual minutes', type: 'number' },
                              { name: 'completion', label: 'Completion', type: 'select', options: COMPLETION },
                              { name: 'activity', label: 'Activity', type: 'select', options: ACTIVITY },
                              { name: 'notes', label: 'Notes', type: 'textarea' },
                              { name: 'reason', label: 'Reason for correction', required: true },
                            ]}
                          />
                        </details>
                      </div>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}
