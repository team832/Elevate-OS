/** Sections of the assessment page: scoring rule, validation issues, results, analysis. */
import { Alert, Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import type {
  getAssessment,
  getAssessmentAnalysis,
  getResults,
  validateAssessment,
} from '../server';
import { MODULE_PATHS } from '../server/paths';
import { StateBadge, fmtDateTime } from './badges';

type Assessment = Awaited<ReturnType<typeof getAssessment>>;
type Validation = Awaited<ReturnType<typeof validateAssessment>>;
type Results = Awaited<ReturnType<typeof getResults>>;
type Analysis = Awaited<ReturnType<typeof getAssessmentAnalysis>>;

const mark = (v: string | null) =>
  v === null ? <StatusBadge tone="neutral">unknown</StatusBadge> : String(Number(v));
const inherit = (v: string | null) =>
  v === null ? <span className="el-field-hint">inherits</span> : String(Number(v));

export function ScoringSection({ a }: { a: Assessment }) {
  return (
    <Card
      title="Scoring rule"
      description="Section values override the assessment default; ‘unknown’ values block finalisation."
    >
      <p>
        Default: +{mark(a.marksPerCorrect)} per correct, {mark(a.marksPerWrong)} per wrong,{' '}
        {mark(a.marksUnattempted)} per unattempted
        {a.patternRef ? ` · pattern: ${a.patternRef}` : ''}
      </p>
      <DataTable
        rows={a.sections}
        rowKey={(s) => s.id}
        empty={<EmptyState title="No sections configured" />}
        columns={[
          { key: 'code', header: 'Section', render: (s) => `${s.code} ${s.name}` },
          { key: 'q', header: 'Questions', numeric: true, render: (s) => s.questionCount },
          {
            key: 'format',
            header: 'Answers',
            render: (s) => (s.answerFormat === 'choice' ? s.options.join('/') : 'numeric'),
          },
          { key: 'c', header: 'Correct', render: (s) => inherit(s.marksPerCorrect) },
          { key: 'w', header: 'Wrong', render: (s) => inherit(s.marksPerWrong) },
          { key: 'u', header: 'Unattempted', render: (s) => inherit(s.marksUnattempted) },
          {
            key: 'cap',
            header: 'Cap',
            render: (s) => (s.capMarks === null ? '—' : String(Number(s.capMarks))),
          },
        ]}
      />
      <p className="el-field-hint">
        Answer keys:{' '}
        {a.answerKeys.length === 0 ? 'none' : a.answerKeys.map((k) => `v${k.version}`).join(', ')} ·
        attempts: {a.attempts.submitted ?? 0} submitted, {a.attempts.absent ?? 0} absent,{' '}
        {a.attempts.exempt ?? 0} exempt, {a.attempts.withheld ?? 0} withheld
      </p>
    </Card>
  );
}

export function ValidationSection({ v }: { v: Validation }) {
  return v.ok ? (
    <Alert tone="success" title="Ready to finalise">
      {v.attempts} attempt(s) for {v.enrolled} enrolled student(s), checked against key v
      {v.keyVersion}.
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

type Row = Results['results'][number];

export function ResultsSection({ r, assessmentId }: { r: Results; assessmentId: string }) {
  return (
    <Card
      title="Results"
      description="Finalised result versions are immutable. Re-scoring creates a new version; earlier versions stay readable. Absent, exempt and withheld students have no score (not zero)."
    >
      {r.versions.length > 0 ? (
        <p>
          Versions:{' '}
          {r.versions.map((v, i) => (
            <span key={v.version}>
              {i ? ' · ' : ''}
              <a href={`${MODULE_PATHS.assessment(assessmentId)}?version=${v.version}`}>
                v{v.version} <StateBadge state={v.status} />
              </a>
            </span>
          ))}
        </p>
      ) : null}
      {!r.run ? (
        <EmptyState title="No results yet" description="Results appear after finalisation." />
      ) : (
        <>
          <p className="el-field-hint">
            Version {r.run.version} ({r.run.status}) finalised {fmtDateTime(r.run.finalisedAt)} ·{' '}
            {r.run.studentsScored} scored, {r.run.studentsAbsent} absent
            {r.run.reason ? ` · re-score reason: ${r.run.reason}` : ''}
          </p>
          <DataTable
            rows={r.results}
            rowKey={(x) => x.id}
            columns={[
              ...(r.showRank
                ? [
                    {
                      key: 'rank',
                      header: 'Rank',
                      numeric: true,
                      render: (x: Row) => x.rank ?? '—',
                    },
                  ]
                : []),
              {
                key: 'student',
                header: 'Student',
                render: (x) => `${x.studentName} (${x.studentCode})`,
              },
              {
                key: 'score',
                header: 'Score',
                numeric: true,
                render: (x) =>
                  x.absent ? (
                    <StatusBadge tone="neutral">{x.state}</StatusBadge>
                  ) : (
                    `${Number(x.totalScore)} / ${Number(x.maxScore)}`
                  ),
              },
              ...(r.showRank
                ? [
                    {
                      key: 'pct',
                      header: 'Percentile',
                      numeric: true,
                      render: (x: Row) =>
                        x.percentile === null ? '—' : Number(x.percentile).toFixed(2),
                    },
                  ]
                : []),
              {
                key: 'sections',
                header: 'Sections (correct/wrong/unattempted)',
                render: (x) =>
                  (
                    x.sectionScores as {
                      sectionCode: string;
                      correct: number;
                      wrong: number;
                      unattempted: number;
                      score: string;
                    }[]
                  )
                    .map(
                      (s) =>
                        `${s.sectionCode}: ${s.score} (${s.correct}/${s.wrong}/${s.unattempted})`,
                    )
                    .join('; '),
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}

/** Analysis of the final version: scored-only average with its population, sections, comparison. */
export function AnalysisSection({ x }: { x: Analysis }) {
  if (!x.analysis || !x.comparison) {
    return (
      <Card title="Analysis">
        <EmptyState
          title="No analysis yet"
          description="Analysis appears once results are finalised."
        />
      </Card>
    );
  }
  const a = x.analysis;
  const t = x.comparison.trend;
  return (
    <Card
      title="Analysis"
      description="The average counts scored students only. Absent, exempt, withheld and pending students are counted beside it, never as 0."
    >
      <p>
        Scored {a.scored} of {a.eligible} eligible · absent {a.absent} · exempt {a.exempt} ·
        withheld {a.withheld} · pending {a.pending}
      </p>
      <p>
        {a.mean === null
          ? 'No average: nobody was scored.'
          : `Average ${a.mean} out of ${a.max}${a.meanPercent === null ? '' : ` (${a.meanPercent}%)`} · highest ${a.highest} · lowest ${a.lowest}`}
      </p>
      <DataTable
        compact
        caption="Sections"
        rows={x.sections}
        rowKey={(s) => s.sectionCode}
        empty={
          <EmptyState title="No section breakdown" description="Marks were entered as totals." />
        }
        columns={[
          { key: 'code', header: 'Section', render: (s) => s.sectionCode },
          { key: 'scored', header: 'Scored', numeric: true, render: (s) => s.scored },
          { key: 'mean', header: 'Average', numeric: true, render: (s) => `${s.mean} / ${s.max}` },
          {
            key: 'pct',
            header: '%',
            numeric: true,
            render: (s) => (s.meanPercent === null ? '—' : `${s.meanPercent}%`),
          },
        ]}
      />
      <p className="el-field-hint">{x.topics.note}</p>
      <DataTable
        compact
        caption="This batch's final assessments"
        rows={[
          ...x.comparison.comparable.map((c) => ({ ...c, comparable: true })),
          ...x.comparison.notComparable.map((c) => ({ ...c, comparable: false })),
        ]}
        rowKey={(c) => c.id}
        columns={[
          {
            key: 'code',
            header: 'Assessment',
            render: (c) =>
              c.id === x.assessmentId ? (
                `${c.code} (this one)`
              ) : (
                <a href={MODULE_PATHS.assessment(c.id)}>{c.code}</a>
              ),
          },
          { key: 'date', header: 'Date', render: (c) => c.date ?? 'Not recorded' },
          { key: 'kind', header: 'Kind', render: (c) => c.kind.replace(/_/g, ' ') },
          { key: 'max', header: 'Out of', numeric: true, render: (c) => c.max },
          {
            key: 'avg',
            header: 'Average %',
            numeric: true,
            render: (c) =>
              c.meanPercent === null ? 'Not enough data' : `${c.meanPercent}% (${c.scored} scored)`,
          },
          {
            key: 'cmp',
            header: 'Trend',
            render: (c) =>
              c.comparable ? (
                'comparable'
              ) : (
                <StatusBadge tone="neutral">not comparable</StatusBadge>
              ),
          },
        ]}
      />
      <p>
        Trend across comparable assessments (same kind, subject and maximum):{' '}
        {t.status === 'ok'
          ? `${t.direction} — ${t.slope > 0 ? '+' : ''}${t.slope} percentage points per assessment over ${t.pointsUsed} assessments`
          : `not shown — ${t.reason}`}
        {x.comparison.trendSetting === 'proposed'
          ? ' (trend rule proposed, not approved by the owner)'
          : ''}
      </p>
    </Card>
  );
}
