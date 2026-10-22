import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, ButtonLink, Card, DataTable, PageHeader } from '@elevate/shared-ui';
import { getSessionLog } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { ApiForm, type FormField } from '../../../../ui/api-form';
import { StateBadge, fmtDateTime } from '../../../../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../../ui/shell';
import { ACTIVITY_OPTIONS, COMPLETION_OPTIONS, activityLabel } from '../../log-labels';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Class log' };

type Log = Awaited<ReturnType<typeof getSessionLog>>;
type Draft = Log['records'][number];

/** No defaults from the timetable: the teacher states what actually happened. */
function fields(chapters: Log['chapters'], d?: Draft): FormField[] {
  return [
    { name: 'chapterId', label: 'Topic taught (chapter)', type: 'select', required: true, options: chapters.map((c) => ({ value: c.id, label: `${c.code} ${c.title}` })), defaultValue: d?.chapterId },
    { name: 'activity', label: 'Teaching type', type: 'select', required: true, options: ACTIVITY_OPTIONS, defaultValue: d?.activity },
    { name: 'completion', label: 'Coverage of this topic', type: 'select', required: true, options: COMPLETION_OPTIONS, defaultValue: d?.completion },
    { name: 'actualMinutes', label: 'Actual minutes taught', type: 'number', required: true, defaultValue: d?.actualMinutes },
    { name: 'materials', label: 'Materials used', type: 'textarea', defaultValue: d?.materials ?? undefined },
    { name: 'homework', label: 'Homework set', type: 'textarea', defaultValue: d?.homework ?? undefined },
    { name: 'homeworkDueOn', label: 'Homework due on', type: 'date', defaultValue: d?.homeworkDueOn ?? undefined },
    { name: 'difficulties', label: 'Difficulties students had', type: 'textarea', defaultValue: d?.difficulties ?? undefined },
    { name: 'nextPlan', label: 'Plan for the next class', type: 'textarea', defaultValue: d?.nextPlan ?? undefined },
    { name: 'catchUpNeeded', label: 'Catch-up needed (who, what)', type: 'textarea', defaultValue: d?.catchUpNeeded ?? undefined },
    { name: 'notes', label: 'Other notes', type: 'textarea', hint: 'Notes about one student belong in a teacher review, not here.', defaultValue: d?.notes ?? undefined },
    { name: 'evidence', label: 'Evidence link (board photo, worksheet)', defaultValue: d?.evidence ?? undefined },
  ];
}

export default async function ClassLogPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const access = await gate('academic:classes:read', MODULE_PATHS.teachingLog(sessionId));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="teaching">{null}</AcademicShell>;
  const data = await load(() => getSessionLog(getDb(), actorFor(access.user), sessionId));
  if (!data.ok) return <AcademicShell access={access} active="teaching"><LoadError error={data.error} /></AcademicShell>;
  const { session, batchCode, plannedChapterCode, plannedChapterTitle, chapters, records, delivered, deadlineHours } = data.data;
  const canRecord = can(access.user, 'academic:classes:record') && session.status !== 'cancelled' && session.status !== 'rescheduled';
  const drafts = records.filter((r) => r.state === 'draft');
  const done = records.filter((r) => r.state !== 'draft');
  const submitLabel = delivered ? 'Submit log' : 'Submit log (needs delivery first)';
  return (
    <AcademicShell access={access} active="teaching">
      <PageHeader
        title={`Class log — ${batchCode}, ${session.date} ${session.startTime}`}
        meta={<StateBadge state={session.status} />}
        description={`Planned: ${plannedChapterCode ? `${plannedChapterCode} ${plannedChapterTitle}` : 'no chapter planned'} · ${session.durationMinutes} min timetabled`}
        actions={<ButtonLink href={MODULE_PATHS.teaching}>All teaching logs</ButtonLink>}
      />
      <div className="el-stack">
        {!delivered ? (
          <Alert tone="warning" title="Not marked delivered yet">
            You can save a draft now. To submit, first <a href={MODULE_PATHS.attendance(session.id)}>mark the class delivered on the attendance page</a>.
          </Alert>
        ) : null}
        {deadlineHours !== null ? <Alert tone="info">Logs are due within {deadlineHours} hours of the class ending (Academic setting).</Alert> : null}
        {done.length > 0 ? (
          <Card title="Submitted for this class" description="Submitted logs are not edited. Ask the coordinator if something needs correcting.">
            <DataTable compact
              rows={done}
              rowKey={(r) => r.id}
              columns={[
                { key: 'chapter', header: 'Topic', render: (r) => chapters.find((c) => c.id === r.chapterId)?.code ?? 'Retired chapter' },
                { key: 'type', header: 'Teaching type', render: (r) => activityLabel(r.activity) },
                { key: 'completion', header: 'Coverage', render: (r) => r.completion },
                { key: 'minutes', header: 'Minutes', numeric: true, render: (r) => r.actualMinutes },
                { key: 'state', header: 'State', render: (r) => <StateBadge state={r.state} /> },
                { key: 'when', header: 'Submitted', render: (r) => fmtDateTime(r.submittedAt) },
              ]}
            />
          </Card>
        ) : null}
        {canRecord
          ? drafts.map((d) => (
              <Card key={`${d.id}-${d.version}`} title={d.correctionReason ? 'Correction requested' : 'Your draft'} description={d.correctionReason ? `Coordinator: ${d.correctionReason}` : `Saved ${fmtDateTime(d.recordedAt)} · only you can see it`}>
                <ApiForm action={MODULE_PATHS.api(`class-records/${d.id}`)} method="PATCH" extra={{ version: d.version }} fields={fields(chapters, d)} submitLabel={submitLabel} draftLabel="Save draft" successMessage="Submitted." stickyActions idPrefix={`d-${d.id}`} />
              </Card>
            ))
          : null}
        {canRecord ? (
          <Card title={records.length ? 'Log another topic from this class' : 'What was taught'} description="One log per topic. Combined lessons get one log each.">
            <ApiForm action={MODULE_PATHS.api('class-records')} extra={{ sessionId: session.id }} fields={fields(chapters)} submitLabel={submitLabel} draftLabel="Save draft" successMessage="Submitted. Its minutes become verified minutes once a coordinator verifies it." stickyActions idPrefix="new" />
          </Card>
        ) : null}
      </div>
    </AcademicShell>
  );
}
