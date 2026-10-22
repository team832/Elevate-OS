/** Coverage and capacity sections of the batch page (server components). */
import { Alert, Card, DataTable, EmptyState } from '@elevate/shared-ui';
import type { getBatchCoverage, getBatchFeasibility } from '../server';
import { PlanBadge, StateBadge, fmtHours } from './badges';

type Coverage = Awaited<ReturnType<typeof getBatchCoverage>>;
type Feasibility = Awaited<ReturnType<typeof getBatchFeasibility>>;

const EVIDENCE_LABEL: Record<string, string> = { practice: 'practised', catch_up: 'catch-up', test: 'tested', discussion: 'discussed', revision: 'revised', doubt_solving: 'doubts solved' };
const TAUGHT_LABEL = { not_taught: 'not taught', partial: 'partly taught', completed: 'taught' } as const;
const evidence = (e: Record<string, number | undefined>) =>
  Object.entries(e).map(([k, n]) => `${EVIDENCE_LABEL[k] ?? k} ${n}`).join(', ') || 'None';
const chapters = (f: { chaptersPlanned: number; chaptersTaught: number; chaptersCompleted: number }) =>
  `${f.chaptersTaught} of ${f.chaptersPlanned} taught (${f.chaptersCompleted} completed)`;

export function CoverageSection({ data }: { data: Coverage }) {
  const { coverage, plan } = data;
  return (
    <Card
      title="Curriculum coverage — planned vs completed"
      description={<>{data.note} {plan ? <>Plan {plan.code} <PlanBadge status={plan.status} /> <PlanBadge status={plan.countsStatus} prefix="counts" /> <PlanBadge status={plan.datesStatus} prefix="dates" /></> : null}</>}
    >
      {!plan ? (
        <EmptyState title="Nothing planned" description="No locked or provisional plan applies to this batch." />
      ) : (
        <div className="el-stack">
          <Alert tone="info" title="Course total">
            Chapters: {chapters(coverage.course)} · planned {fmtHours(coverage.course.plannedMinutes)} ({coverage.course.plannedClasses} classes, planned) · delivered (verified) {fmtHours(coverage.course.verifiedMinutes)} · recorded, not yet verified {fmtHours(coverage.course.unverifiedMinutes)}
          </Alert>
          <DataTable
            caption="By subject"
            rows={coverage.subjects}
            rowKey={(s) => s.subjectId}
            columns={[
              { key: 'code', header: 'Subject' },
              { key: 'chapters', header: 'Chapters', render: (s) => chapters(s) },
              { key: 'planned', header: 'Planned hours', numeric: true, render: (s) => s.plannedHours },
              { key: 'verified', header: 'Delivered (verified) h', numeric: true, render: (s) => s.verifiedHours },
            ]}
          />
          <DataTable
            caption="By chapter"
            rows={coverage.chapters}
            rowKey={(c) => c.chapterId}
            columns={[
              { key: 'code', header: 'Chapter', render: (c) => `${c.code} ${c.title}` },
              { key: 'classes', header: 'Planned classes', numeric: true, render: (c) => c.plannedClasses },
              { key: 'taught', header: 'Taught', render: (c) => <StateBadge state={TAUGHT_LABEL[c.taught]} /> },
              { key: 'evidence', header: 'Other evidence', render: (c) => evidence(c.evidence) },
            ]}
          />
          {coverage.unplanned.length > 0 ? (
            <Alert tone="warning" title="Taught but not in the plan">
              {coverage.unplanned.length} chapter(s) have class records but no plan items.
            </Alert>
          ) : null}
        </div>
      )}
    </Card>
  );
}

export function FeasibilitySection({ data }: { data: Feasibility }) {
  const r = data.result;
  return (
    <Card title="Capacity feasibility" description="Gross slots from the calendar rules, minus exclusions, give net slots, compared with the classes the current plan requires.">
      {!r ? (
        <EmptyState title="Capacity not assessed" description={'message' in data ? data.message : 'Add calendar rules first.'} />
      ) : (
        <div className="el-stack">
          <p>
            Verdict: <StateBadge state={r.verdict} /> {'window' in data && data.window ? `· window ${data.window.from} to ${data.window.to}` : null}
          </p>
          {r.errors.length > 0 ? (
            <Alert tone="danger" title="The calendar input has problems">
              <ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </Alert>
          ) : null}
          <DataTable
            rows={[r]}
            rowKey={() => 'totals'}
            columns={[
              { key: 'teachingDays', header: 'Teaching days', numeric: true },
              { key: 'grossSlots', header: 'Gross slots', numeric: true, render: (x) => `${x.grossSlots} (${x.regularSlots} + ${x.extraSlots} extra)` },
              { key: 'excludedSlots', header: 'Excluded', numeric: true },
              { key: 'netSlots', header: 'Net slots', numeric: true },
              { key: 'requiredClasses', header: 'Required classes', numeric: true, render: (x) => x.requiredClasses ?? 'Unknown' },
              { key: 'headroom', header: 'Headroom', numeric: true, render: (x) => x.headroom ?? 'Unknown' },
            ]}
          />
          <ul>{r.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <Alert tone="warning">{r.caveat}</Alert>
          {r.months.length > 0 ? (
            <DataTable
              caption="By month"
              rows={r.months}
              rowKey={(m) => m.month}
              columns={[
                { key: 'month', header: 'Month' },
                { key: 'teachingDays', header: 'Days', numeric: true },
                { key: 'grossSlots', header: 'Gross', numeric: true },
                { key: 'excludedSlots', header: 'Excluded', numeric: true },
                { key: 'netSlots', header: 'Net', numeric: true },
                { key: 'planned', header: 'Planned', numeric: true, render: (m) => m.planned ?? '—' },
                { key: 'overBy', header: 'Relocation needed', numeric: true, render: (m) => (m.overBy > 0 ? m.overBy : '—') },
              ]}
            />
          ) : null}
        </div>
      )}
    </Card>
  );
}
