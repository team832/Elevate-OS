/** Sections of the assessment page: scoring rule, validation issues, results. */
import { Alert, Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import type { getAssessment, getResults, validateAssessment } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { StateBadge, fmtDateTime } from './badges';

type Assessment = Awaited<ReturnType<typeof getAssessment>>;
type Validation = Awaited<ReturnType<typeof validateAssessment>>;
type Results = Awaited<ReturnType<typeof getResults>>;

const mark = (v: string | null) => (v === null ? <StatusBadge tone="neutral">unknown</StatusBadge> : String(Number(v)));
const inherit = (v: string | null) => (v === null ? <span className="el-field-hint">inherits</span> : String(Number(v)));

export function ScoringSection({ a }: { a: Assessment }) {
  return (
    <Card title="Scoring rule" description="Section values override the assessment default; ‘unknown’ values block finalisation.">
      <p>
        Default: +{mark(a.marksPerCorrect)} per correct, {mark(a.marksPerWrong)} per wrong, {mark(a.marksUnattempted)} per unattempted
        {a.patternRef ? ` · pattern: ${a.patternRef}` : ''}
      </p>
      <DataTable
        rows={a.sections}
        rowKey={(s) => s.id}
        empty={<EmptyState title="No sections configured" />}
        columns={[
          { key: 'code', header: 'Section', render: (s) => `${s.code} ${s.name}` },
          { key: 'q', header: 'Questions', numeric: true, render: (s) => s.questionCount },
          { key: 'format', header: 'Answers', render: (s) => (s.answerFormat === 'choice' ? s.options.join('/') : 'numeric') },
          { key: 'c', header: 'Correct', render: (s) => inherit(s.marksPerCorrect) },
          { key: 'w', header: 'Wrong', render: (s) => inherit(s.marksPerWrong) },
          { key: 'u', header: 'Unattempted', render: (s) => inherit(s.marksUnattempted) },
          { key: 'cap', header: 'Cap', render: (s) => (s.capMarks === null ? '—' : String(Number(s.capMarks))) },
        ]}
      />
      <p className="el-field-hint">
        Answer keys: {a.answerKeys.length === 0 ? 'none' : a.answerKeys.map((k) => `v${k.version}`).join(', ')} · attempts: {a.attempts.submitted ?? 0} submitted, {a.attempts.absent ?? 0} absent
      </p>
    </Card>
  );
}

export function ValidationSection({ v }: { v: Validation }) {
  return v.ok ? (
    <Alert tone="success" title="Ready to finalise">
      {v.attempts} attempt(s) for {v.enrolled} enrolled student(s), checked against key v{v.keyVersion}.
    </Alert>
  ) : (
    <Alert tone="warning" title={`${v.issues.length} issue(s) must be fixed before finalising`}>
      <ul>
        {v.issues.slice(0, 50).map((i, n) => (
          <li key={n}>
            [{i.code}] {i.sectionCode ? `${i.sectionCode} ` : ''}
            {i.questionNo ? `Q${i.questionNo} ` : ''}
            {i.message}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

export function ResultsSection({ r, assessmentId }: { r: Results; assessmentId: string }) {
  return (
    <Card title="Results" description="Finalised result versions are immutable. Re-scoring creates a new version; earlier versions stay readable. Absent students have no score (not zero).">
      {r.versions.length > 0 ? (
        <p>
          Versions:{' '}
          {r.versions.map((v) => (
            <a key={v.version} href={`${MODULE_PATHS.assessment(assessmentId)}?version=${v.version}`} style={{ marginRight: '0.75rem' }}>
              v{v.version} <StateBadge state={v.status} />
            </a>
          ))}
        </p>
      ) : null}
      {!r.run ? (
        <EmptyState title="No results yet" description="Results appear after finalisation." />
      ) : (
        <>
          <p className="el-field-hint">
            Version {r.run.version} ({r.run.status}) finalised {fmtDateTime(r.run.finalisedAt)} · {r.run.studentsScored} scored, {r.run.studentsAbsent} absent
            {r.run.reason ? ` · re-score reason: ${r.run.reason}` : ''}
          </p>
          <DataTable
            rows={r.results}
            rowKey={(x) => x.id}
            columns={[
              { key: 'rank', header: 'Rank', numeric: true, render: (x) => x.rank ?? '—' },
              { key: 'student', header: 'Student', render: (x) => `${x.studentName} (${x.studentCode})` },
              { key: 'score', header: 'Score', numeric: true, render: (x) => (x.absent ? <StatusBadge tone="neutral">absent</StatusBadge> : `${Number(x.totalScore)} / ${Number(x.maxScore)}`) },
              { key: 'pct', header: 'Percentile', numeric: true, render: (x) => (x.percentile === null ? '—' : Number(x.percentile).toFixed(2)) },
              {
                key: 'sections',
                header: 'Sections (correct/wrong/unattempted)',
                render: (x) =>
                  (x.sectionScores as { sectionCode: string; correct: number; wrong: number; unattempted: number; score: string }[])
                    .map((s) => `${s.sectionCode}: ${s.score} (${s.correct}/${s.wrong}/${s.unattempted})`)
                    .join('; '),
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}
