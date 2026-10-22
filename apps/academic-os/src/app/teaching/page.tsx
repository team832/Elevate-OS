import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Button, Card, DataTable, EmptyState, Field, PageHeader, Select, TextInput } from '@elevate/shared-ui';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { getLogExceptions, listBatches, listClassRecords, listSessions, listStaff, todayIst } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { classRecordsQuery } from '../../server/schemas-teaching';
import { ApiButton, ApiForm } from '../../ui/api-form';
import { StateBadge, fmtDateTime } from '../../ui/badges';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';
import { ACTIVITY_OPTIONS, COMPLETION_OPTIONS, activityLabel } from './log-labels';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Teaching logs' };

type Params = Record<string, string | string[] | undefined>;
const STATES = ['draft', 'submitted', 'verified', 'superseded'];

export default async function TeachingPage({ searchParams }: { searchParams: Promise<Params> }) {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:classes:read', MODULE_PATHS.teaching);
  return (
    <AcademicShell access={access} active="teaching" loading="Loading teaching logs…">
      {access.status === 'allowed' ? <Body access={access} params={await searchParams} /> : null}
    </AcademicShell>
  );
}

async function Body({ access, params }: { access: PageAccess; params: Params }) {
  const db = getDb();
  const actor = actorFor(access.user);
  const today = todayIst();
  const canRecord = can(access.user, 'academic:classes:record');
  const canVerify = can(access.user, 'academic:classes:verify');
  const filter = classRecordsQuery.safeParse(Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'string' && v !== '')));
  const query = filter.success ? filter.data : {};
  const data = await load(async () => {
    const records = await listClassRecords(db, actor, query);
    const mine = canRecord ? (await listSessions(db, actor, { from: addDays(today as IsoDate, -14), to: today })).filter((s) => s.status === 'scheduled' || s.status === 'held') : [];
    const ownRecords = canRecord ? await listClassRecords(db, actor, { from: addDays(today as IsoDate, -14), to: today }) : [];
    return {
      records,
      mine,
      ownRecords,
      exceptions: await getLogExceptions(db, actor, { from: query.from, to: query.to, batchId: query.batchId, teacherStaffId: query.teacherStaffId }),
      batches: await listBatches(db, actor),
      staff: canVerify ? await listStaff(db, { teachingOnly: true }) : [],
    };
  });
  if (!data.ok) return <LoadError error={data.error} />;
  const { records, mine, ownRecords, exceptions, batches, staff } = data.data;
  const logState = (sessionId: string) => {
    const states = ownRecords.filter((r) => r.sessionId === sessionId && r.state !== 'superseded').map((r) => r.state);
    return states.includes('draft') ? 'draft' : states.length ? 'submitted' : null;
  };
  return (
    <>
      <PageHeader title="Teaching logs" description="What was actually taught in each delivered class. Teaching minutes count as verified minutes once a coordinator verifies the log; saving or submitting a log never marks anyone present in HR." />
      <div className="el-stack">
        {canRecord ? (
          <Card title="Classes (last 14 days)" description="Write the log after the class. Submitting needs the class marked delivered first.">
            <DataTable compact
              rows={mine}
              rowKey={(s) => s.id}
              empty={<EmptyState title="No classes in the last 14 days" description="Classes you teach appear here once they are on the timetable." />}
              columns={[
                { key: 'when', header: 'Class', render: (s) => `${s.date} ${s.startTime} · ${s.batchCode}` },
                { key: 'planned', header: 'Planned topic', render: (s) => s.chapterTitle ?? 'None planned' },
                { key: 'delivered', header: 'Delivery', render: (s) => (s.status === 'held' ? <StateBadge state="held" /> : 'Not marked delivered') },
                { key: 'log', header: 'Log', render: (s) => (logState(s.id) ? <StateBadge state={logState(s.id)} /> : 'Not written') },
                { key: 'open', header: '', render: (s) => <><a href={MODULE_PATHS.teachingLog(s.id)}>{logState(s.id) ? 'Open log' : 'Write log'}</a> · <a href={MODULE_PATHS.attendance(s.id)}>Attendance</a></> },
              ]}
            />
          </Card>
        ) : null}
        <Card title={`Delivered without a submitted log (${exceptions.missingLogs.length})`} description={`${exceptions.window.from} to ${exceptions.window.to}. Drafts do not count as submitted.`}>
          <DataTable compact
            rows={exceptions.missingLogs}
            rowKey={(s) => s.id}
            empty={<EmptyState title="Every delivered class has a submitted log" description="Nothing to chase in this period." />}
            columns={[
              { key: 'when', header: 'Class', render: (s) => <a href={MODULE_PATHS.teachingLog(s.id)}>{`${s.date} ${s.startTime} · ${s.batchCode}`}</a> },
              { key: 'teacher', header: 'Teacher', render: (s) => s.teacherName ?? 'No teacher' },
              { key: 'planned', header: 'Planned topic', render: (s) => s.chapterTitle ?? 'None planned' },
            ]}
          />
        </Card>
        <Card title={`Planned topic not logged (${exceptions.discrepancies.length})`} description="Delivered classes whose submitted logs name other chapters than the one planned.">
          <DataTable compact
            rows={exceptions.discrepancies}
            rowKey={(s) => s.id}
            empty={<EmptyState title="No differences between plan and logs" description="Logged chapters match the planned ones in this period." />}
            columns={[
              { key: 'when', header: 'Class', render: (s) => `${s.date} ${s.startTime} · ${s.batchCode}` },
              { key: 'teacher', header: 'Teacher', render: (s) => s.teacherName ?? 'No teacher' },
              { key: 'planned', header: 'Planned', render: (s) => s.chapterCode },
              { key: 'logged', header: 'Logged', render: (s) => s.loggedChapters.join(', ') },
            ]}
          />
        </Card>
        <Card title="Logs">
          <form method="get" className="el-form-grid">
            <Field id="f-batch" label="Batch">
              <Select id="f-batch" name="batchId" defaultValue={query.batchId ?? ''}>
                <option value="">All batches</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
              </Select>
            </Field>
            {canVerify ? (
              <Field id="f-teacher" label="Teacher">
                <Select id="f-teacher" name="teacherStaffId" defaultValue={query.teacherStaffId ?? ''}>
                  <option value="">All teachers</option>
                  {staff.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field id="f-state" label="Status">
              <Select id="f-state" name="state" defaultValue={query.state ?? ''}>
                <option value="">Any status</option>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field id="f-from" label="Class from"><TextInput id="f-from" name="from" type="date" defaultValue={query.from} /></Field>
            <Field id="f-to" label="Class to"><TextInput id="f-to" name="to" type="date" defaultValue={query.to} /></Field>
            <div className="el-form-actions"><Button type="submit" variant="secondary">Apply filters</Button></div>
          </form>
          {!filter.success ? <Alert tone="warning">Some filters were not valid and were ignored.</Alert> : null}
          <DataTable compact
            rows={records}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No logs match" description="Change the filters, or wait for teachers to submit logs for delivered classes." />}
            columns={[
              { key: 'session', header: 'Class', render: (r) => <a href={MODULE_PATHS.teachingLog(r.sessionId)}>{`${r.sessionDate} ${r.sessionStart} · ${r.batchCode}`}</a> },
              { key: 'chapter', header: 'Topic', render: (r) => `${r.chapterCode} ${r.chapterTitle}` },
              { key: 'teacher', header: 'Teacher', render: (r) => r.teacherName },
              { key: 'type', header: 'Teaching type', render: (r) => `${activityLabel(r.activity)} · ${r.completion}` },
              { key: 'minutes', header: 'Actual / planned min', numeric: true, render: (r) => `${r.actualMinutes} / ${r.plannedMinutes}` },
              { key: 'state', header: 'Status', render: (r) => <StateBadge state={r.state} /> },
              {
                key: 'history',
                header: 'History',
                render: (r) => [
                  r.submittedAt ? `Submitted by ${r.recordedByName}, ${fmtDateTime(r.submittedAt)}` : `Draft saved by ${r.recordedByName}, ${fmtDateTime(r.recordedAt)}`,
                  r.correctionReason ? `Corrects an earlier log: ${r.correctionReason}` : null,
                  r.replacedBy === 'draft' ? 'Correction requested, waiting for the teacher' : r.replacedBy ? 'Replaced by a corrected log' : null,
                  r.verifiedAt ? `Verified ${fmtDateTime(r.verifiedAt)}` : null,
                ].filter(Boolean).join(' · '),
              },
              {
                key: 'actions',
                header: '',
                render: (r) =>
                  canVerify && (r.state === 'submitted' || r.state === 'verified') ? (
                    <div className="el-stack">
                      {r.state === 'submitted' ? <ApiButton action={MODULE_PATHS.api(`class-records/${r.id}/verify`)} label="Verify" successMessage="Verified." /> : null}
                      <details>
                        <summary>Send back to the teacher</summary>
                        <ApiForm action={MODULE_PATHS.api(`class-records/${r.id}/request-correction`)} submitLabel="Request correction" successMessage="Sent back; the original is kept." idPrefix={`req-${r.id}`} fields={[{ name: 'reason', label: 'What needs correcting', required: true, type: 'textarea' }]} />
                      </details>
                      <details>
                        <summary>Correct it yourself</summary>
                        <ApiForm
                          action={MODULE_PATHS.api(`class-records/${r.id}/correct`)}
                          submitLabel="Save correction"
                          successMessage="Corrected; the original is kept as superseded."
                          idPrefix={`cor-${r.id}`}
                          fields={[
                            { name: 'actualMinutes', label: 'Actual minutes', type: 'number' },
                            { name: 'completion', label: 'Coverage of this topic', type: 'select', options: COMPLETION_OPTIONS },
                            { name: 'activity', label: 'Teaching type', type: 'select', options: ACTIVITY_OPTIONS },
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
    </>
  );
}
