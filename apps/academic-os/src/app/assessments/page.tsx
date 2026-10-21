import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listAssessments, listBatches } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { StateBadge } from '../../ui/badges';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Assessments' };

const KINDS = ['chapter_test', 'sectional', 'full_mock', 'practice'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

export default async function AssessmentsPage() {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:assessments:read', MODULE_PATHS.assessments);
  return (
    <AcademicShell access={access} active="assessments" loading="Loading assessments…">
      {access.status === 'allowed' ? <Body access={access} /> : null}
    </AcademicShell>
  );
}

async function Body({ access }: { access: PageAccess }) {
  const db = getDb();
  const actor = actorFor(access.user);
  const canWrite = can(access.user, 'academic:assessments:write');
  const data = await load(async () => ({ assessments: await listAssessments(db, actor), batches: canWrite ? await listBatches(db, actor) : [] }));
  return (
    <>
      <PageHeader title="Assessments" description="Tests and mocks, each scored by its own rules. Unknown values stay unknown until entered." />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <Card>
            <DataTable compact
              rows={data.data.assessments}
              rowKey={(a) => a.id}
              empty={<EmptyState title="No assessments" />}
              columns={[
                { key: 'code', header: 'Code', render: (a) => <a href={MODULE_PATHS.assessment(a.id)}>{a.code}</a> },
                { key: 'title', header: 'Title' },
                { key: 'kind', header: 'Kind', render: (a) => a.kind.replace(/_/g, ' ') },
                { key: 'batch', header: 'Batch', render: (a) => a.batchCode },
                { key: 'date', header: 'Date', render: (a) => (a.scheduledDate ? `${a.scheduledDate}${a.startTime ? ` ${a.startTime}` : ''}` : 'not scheduled') },
                { key: 'duration', header: 'Minutes', render: (a) => (a.durationMinutes === null ? 'unknown' : a.durationMinutes) },
                { key: 'status', header: 'Status', render: (a) => <StateBadge state={a.status} /> },
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
                  { name: 'chapterIds', label: 'Chapter ids covered', type: 'csv-list', hint: 'Comma-separated chapter UUIDs (prerequisites for scheduling).' },
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
