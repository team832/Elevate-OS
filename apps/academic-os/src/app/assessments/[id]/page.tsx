import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, PageHeader } from '@elevate/shared-ui';
import { checkAssessmentScheduleFor, getAssessment, getResults, validateAssessment } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { ApiButton, ApiForm } from '../../../ui/api-form';
import { ResultsSection, ScoringSection, ValidationSection } from '../../../ui/assessment-sections';
import { StateBadge } from '../../../ui/badges';
import { ConflictList } from '../../../ui/conflicts';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';

export const dynamic = 'force-dynamic';

const SECTIONS_EXAMPLE = JSON.stringify(
  [
    { code: 'QA', name: 'Quantitative (MCQ)', questionCount: 20, answerFormat: 'choice', options: ['A', 'B', 'C', 'D'] },
    { code: 'SA', name: 'Short answer', questionCount: 5, answerFormat: 'numeric', marksPerWrong: '0' },
  ],
  null,
  2,
);

export default async function AssessmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const version = typeof sp.version === 'string' && /^\d+$/.test(sp.version) ? Number(sp.version) : undefined;
  const access = await gate('academic:assessments:read', MODULE_PATHS.assessment(id));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="assessments">{null}</AcademicShell>;
  const db = getDb();
  const actor = actorFor(access.user);
  const data = await load(async () => {
    const a = await getAssessment(db, actor, id);
    return {
      a,
      validation: await validateAssessment(db, actor, id),
      results: await getResults(db, actor, id, version),
      schedule: await checkAssessmentScheduleFor(db, actor, { batchId: a.batchId }),
    };
  });
  if (!data.ok) return <AcademicShell access={access} active="assessments"><LoadError error={data.error} /></AcademicShell>;
  const { a, validation, results, schedule } = data.data;
  const canWrite = can(access.user, 'academic:assessments:write') && a.status !== 'cancelled';
  const canFinalise = can(access.user, 'academic:assessments:finalise');
  const api = (p: string) => MODULE_PATHS.api(`assessments/${a.id}/${p}`);
  const mine = schedule.hard.filter((c) => c.candidateId === a.id || c.otherId === a.id);
  return (
    <AcademicShell access={access} active="assessments">
      <PageHeader
        title={`${a.code} — ${a.title}`}
        description={<>{a.kind.replace(/_/g, ' ')} · batch {a.batchCode} · {a.scheduledDate ?? 'not scheduled'} · {a.durationMinutes === null ? 'duration unknown' : `${a.durationMinutes} min`} · <StateBadge state={a.status} /></>}
        actions={<a href={MODULE_PATHS.assessments}>All assessments</a>}
      />
      <div className="el-stack">
        <ScoringSection a={a} />
        {canWrite && a.status !== 'finalised' ? (
          <Card title="Configure scoring" description="Sections cannot be restructured once responses exist. Marks are exact decimals (max 4 places).">
            <ApiForm
              action={api('scoring')}
              method="PUT"
              submitLabel="Save scoring rule"
              successMessage="Scoring rule saved."
              idPrefix="score"
              fields={[
                { name: 'marksPerCorrect', label: 'Marks per correct', defaultValue: a.marksPerCorrect ? String(Number(a.marksPerCorrect)) : undefined },
                { name: 'marksPerWrong', label: 'Marks per wrong (e.g. -0.25)', defaultValue: a.marksPerWrong ? String(Number(a.marksPerWrong)) : undefined },
                { name: 'marksUnattempted', label: 'Marks per unattempted', defaultValue: a.marksUnattempted ? String(Number(a.marksUnattempted)) : undefined },
                { name: 'sections', label: 'Sections (JSON)', type: 'json', required: true, hint: `Example: ${SECTIONS_EXAMPLE.replace(/\s+/g, ' ')}`, defaultValue: a.sections.length ? JSON.stringify(a.sections.map((s) => ({ code: s.code, name: s.name, questionCount: s.questionCount, answerFormat: s.answerFormat, options: s.options, ...(s.marksPerCorrect ? { marksPerCorrect: String(Number(s.marksPerCorrect)) } : {}), ...(s.marksPerWrong ? { marksPerWrong: String(Number(s.marksPerWrong)) } : {}), ...(s.marksUnattempted ? { marksUnattempted: String(Number(s.marksUnattempted)) } : {}), ...(s.capMarks ? { capMarks: String(Number(s.capMarks)) } : {}) })), null, 2) : SECTIONS_EXAMPLE },
              ]}
            />
          </Card>
        ) : null}
        {canWrite ? (
          <Card title="Answer key and responses">
            <ApiForm
              action={api('answer-keys')}
              submitLabel="Add answer-key version"
              successMessage="Answer key added (new version)."
              idPrefix="key"
              fields={[
                { name: 'answers', label: 'Answers (JSON: section code → answers by question; null = dropped)', type: 'json', required: true, placeholder: '{ "QA": ["A", "C", null, "D"] }' },
                { name: 'note', label: 'Note' },
              ]}
            />
            <ApiForm
              action={api('attempts')}
              submitLabel="Import responses"
              successMessage="Responses saved."
              idPrefix="resp"
              fields={[
                { name: 'csv', label: 'Responses (CSV)', type: 'textarea', required: true, hint: 'student_code,key_version,section_code,answers — answers separated by | (empty = unattempted); section ABSENT marks a student absent. Example: STU-1A2B3C4D,1,QA,A|B||D' },
              ]}
            />
          </Card>
        ) : null}
        <Card title="Validation before finalising">
          <ValidationSection v={validation} />
          {canFinalise && a.status !== 'finalised' && a.status !== 'cancelled' ? (
            <ApiButton action={api('finalise')} label="Finalise results" variant="primary" successMessage="Results finalised (immutable version 1)." />
          ) : null}
          {canFinalise && a.status === 'finalised' ? (
            <ApiForm action={api('rescore')} submitLabel="Re-score into a new version" successMessage="Re-scored; the previous version is kept." idPrefix="rescore" fields={[{ name: 'reason', label: 'Reason (audited)', required: true }]} />
          ) : null}
        </Card>
        <ResultsSection r={results} assessmentId={a.id} />
        <Card title={`Scheduling check for batch ${schedule.batch.code}`} description={`All dated assessments of the batch against its classes, other assessments, blackouts (target exam date, exam blackouts, closures) and the minimum gap (${schedule.minGap.minDays} days, ${schedule.minGap.status}).`}>
          {mine.length > 0 ? <p>This assessment has {mine.length} hard conflict(s).</p> : null}
          <ConflictList verdict={schedule.verdict} hard={schedule.hard} preferences={schedule.preferences} />
        </Card>
      </div>
    </AcademicShell>
  );
}
