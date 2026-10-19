/** Coverage and capacity sections of the batch page (server components). */
import { Alert, Card, DataTable, EmptyState } from '@elevate/shared-ui';
import type { getBatchCoverage, getBatchFeasibility } from '../server';
import { PlanBadge, StateBadge, fmtHours } from './badges';

type Coverage = Awaited<ReturnType<typeof getBatchCoverage>>;
type Feasibility = Awaited<ReturnType<typeof getBatchFeasibility>>;

const pct = (v: number | null) => (v === null ? 'Missing' : `${v}%`);
const variance = (v: number | null) => (v === null ? 'Unknown (undated plan)' : `${v > 0 ? '+' : ''}${v} min`);

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
            Planned {fmtHours(coverage.course.plannedMinutes)} ({coverage.course.plannedClasses} classes, planned) · completed (verified) {fmtHours(coverage.course.verifiedMinutes)} · recorded but not yet verified {fmtHours(coverage.course.unverifiedMinutes)} · completion {pct(coverage.course.completionPercent)}
          </Alert>
          <DataTable
            caption="By subject"
            rows={coverage.subjects}
            rowKey={(s) => s.subjectId}
            columns={[
              { key: 'code', header: 'Subject' },
              { key: 'planned', header: 'Planned hours', numeric: true, render: (s) => s.plannedHours },
              { key: 'toDate', header: 'Planned to date', numeric: true, render: (s) => (s.plannedToDateMinutes === null ? 'Unknown' : fmtHours(s.plannedToDateMinutes)) },
              { key: 'verified', header: 'Completed (verified) h', numeric: true, render: (s) => s.verifiedHours },
              { key: 'unverified', header: 'Unverified min', numeric: true, render: (s) => s.unverifiedMinutes },
              { key: 'pct', header: 'Completion', numeric: true, render: (s) => pct(s.completionPercent) },
              { key: 'var', header: 'Variance vs plan to date', render: (s) => variance(s.varianceMinutes) },
            ]}
          />
          <DataTable
            caption="By chapter"
            rows={coverage.chapters}
            rowKey={(c) => c.chapterId}
            columns={[
              { key: 'code', header: 'Chapter', render: (c) => `${c.code} ${c.title}` },
              { key: 'classes', header: 'Planned classes', numeric: true, render: (c) => c.plannedClasses },
              { key: 'planned', header: 'Planned h', numeric: true, render: (c) => c.plannedHours },
              { key: 'verified', header: 'Completed (verified) h', numeric: true, render: (c) => c.verifiedHours },
              { key: 'unverified', header: 'Unverified min', numeric: true, render: (c) => c.unverifiedMinutes },
              { key: 'pct', header: 'Completion', numeric: true, render: (c) => pct(c.completionPercent) },
              { key: 'var', header: 'Variance', render: (c) => variance(c.varianceMinutes) },
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
