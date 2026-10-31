import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, DataTable, ListEmpty, PageHeader, fmtDay } from '@elevate/shared-ui';
import { getCourse, listAssessments, listBatches } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { assessmentsQuery } from '../../server/schemas';
import { myAssessmentIds, TEACHER_ASSESSMENT_LISTS } from '../../server/services/teacher-assessment-counts';
import { ApiForm } from '../../ui/api-form';
import { StateBadge, wordOptions, words, fmtSlot } from '../../ui/badges';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Assessments' };

const KINDS = wordOptions(['chapter_test', 'sectional', 'full_mock', 'practice']);

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:assessments:read', MODULE_PATHS.assessments);
  return (
    <AcademicShell access={access} active="assessments" loading="Loading assessments…">
      {access.status === 'allowed' ? <Body access={access} {...(await filters(searchParams))} /> : null}
    </AcademicShell>
  );
}

/** The teacher home's tiles open these (RVB-010). */
const MINE_LABELS: Record<(typeof TEACHER_ASSESSMENT_LISTS)[number], string> = {
  assigned: 'Assigned to you',
  completed: 'Completed',
  awaitingMarking: 'Awaiting marking',
  published: 'Results published',
};

const filters = async (searchParams: Promise<Record<string, string | string[] | undefined>>) => {
  const sp = await searchParams;
  return { batchId: assessmentsQuery.safeParse(sp).data?.batchId, mine: TEACHER_ASSESSMENT_LISTS.find((l) => l === sp.mine) };
};

async function Body({ access, batchId, mine }: { access: PageAccess; batchId?: string | undefined; mine?: (typeof TEACHER_ASSESSMENT_LISTS)[number] | undefined }) {
  const db = getDb();
  const actor = actorFor(access.user);
  const canWrite = can(access.user, 'academic:assessments:write');
  const data = await load(async () => {
    const batches = canWrite ? await listBatches(db, actor) : [];
    const courses = [];
    for (const id of new Set(batches.map((b) => b.courseId))) courses.push(await getCourse(db, id));
    const rows = await listAssessments(db, actor, batchId ? { batchId } : {});
    const ids = mine ? await myAssessmentIds(db, actor, mine) : null;
    return { assessments: ids ? rows.filter((a) => ids.has(a.id)) : rows, filtered: Boolean(ids), batches, courses };
  });
  return (
    <>
      <PageHeader
        title="Assessments"
        description={mine && data.ok && data.data.filtered ? `${MINE_LABELS[mine]}: the assessments your home page counts.` : 'Tests and mocks, each scored by its own rules. Unknown values stay unknown until entered.'}
        actions={batchId ? <a href={MODULE_PATHS.assessments}>Show all batches</a> : mine ? <a href={MODULE_PATHS.assessments}>Show all assessments</a> : undefined}
      />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <Card>
            <DataTable compact
              rows={data.data.assessments}
              rowKey={(a) => a.id}
              sampleOf={(a) => a.isSample}
              empty={<ListEmpty noun="assessments" params={{ batchId, mine }} first={canWrite ? 'Create one below.' : 'Assessments of your batches appear here once a coordinator creates them.'} />}
              columns={[
                { key: 'code', header: 'Code', render: (a) => <a href={MODULE_PATHS.assessment(a.id)}>{a.code}</a> },
                { key: 'title', header: 'Title' },
                { key: 'kind', header: 'Kind', render: (a) => words(a.kind) },
                { key: 'batch', header: 'Batch', render: (a) => a.batchCode },
                { key: 'date', header: 'Date', render: (a) => (a.scheduledDate ? (a.startTime ? fmtSlot(a.scheduledDate, a.startTime) : fmtDay(a.scheduledDate)) : 'not scheduled') },
                { key: 'duration', header: 'Minutes', numeric: true, render: (a) => (a.durationMinutes === null ? 'unknown' : a.durationMinutes) },
                { key: 'status', header: 'Status', render: (a) => <><StateBadge state={a.status} />{a.publishedAt ? <> <StateBadge state={a.provisional ? 'provisional' : 'published'} /></> : null}</> },
              ]}
            />
          </Card>
          {canWrite ? (
            <Card title="Create an assessment" description="Marks are decimals (e.g. 1, -0.25, 0). Leave a mark empty when it is not known; configure sections on the assessment page.">
              <ApiForm
                action={MODULE_PATHS.api('assessments')}
                submitLabel="Create assessment"
                successMessage="Assessment created."
                idPrefix="asmt"
                fields={[
                  { name: 'code', label: 'Code', required: true, placeholder: 'QT01' },
                  { name: 'title', label: 'Title', required: true },
                  { name: 'kind', label: 'Kind', type: 'select', required: true, options: KINDS },
                  { name: 'batchId', label: 'Batch', type: 'select', required: true, options: data.data.batches.map((b) => ({ value: b.id, label: b.code })) },
                  { name: 'scheduledDate', label: 'Date', type: 'date' },
                  { name: 'startTime', label: 'Start (HH:MM)', type: 'time' },
                  { name: 'durationMinutes', label: 'Test minutes', type: 'number', hint: 'Empty = unknown (never zero).' },
                  { name: 'discussionMinutes', label: 'Discussion minutes', type: 'number' },
                  {
                    name: 'chapterIds',
                    label: 'Chapters covered',
                    type: 'multi-select',
                    hint: 'Chapters of the chosen batch’s course; Ctrl or Cmd + click picks more than one. The test date must fall after their planned completion.',
                    options: data.data.courses.flatMap((c) => c.chapters.filter((ch) => ch.status === 'active').map((ch) => ({ value: ch.id, label: `${c.code} · ${ch.code} — ${ch.title}` }))),
                  },
                  { name: 'patternRef', label: 'Exam pattern reference' },
                  { name: 'marksPerCorrect', label: 'Marks per correct' },
                  { name: 'marksPerWrong', label: 'Marks per wrong (negative = penalty)' },
                  { name: 'marksUnattempted', label: 'Marks per unattempted' },
                ]}
              />
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
