/**
 * The Overview's period blocks (owner brief 22 Oct 2026 §5, §9). Each block: the figures, a
 * one-line definition, freshness ("As of …" or "Source unavailable (checked …)") and a link to
 * the records. A block the reader may not see is not rendered (its part is null).
 */
import type { ReactNode } from 'react';
import { MetricStrip, type MetricStripItem } from '@elevate/shared-ui';
import type { Metric } from '@elevate/shared-contracts';
import type { Overview } from '../../server/overview';
import { HR_UNAVAILABLE } from '../../server/teacher-ops';
import { StatCard } from '../../ui/charts';
import { ACADEMIC_LABELS, MARKETING_LABELS, Unavailable } from '../../ui/cross-module';
import { fmtDateTime, fmtPaise, humanise } from '../../ui/format';
import { listHref } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';
import { demoListHref } from '../reports/_components/admissions-charts';

type Part<T> = { ok: true; data: T } | { ok: false; reason?: string } | null;
type Figure = {
  label: string;
  value: number | string | null;
  note?: ReactNode;
  href?: string;
  missingLabel?: string;
};

const COULD_NOT_LOAD = 'Could not load these figures. Reload the page to try again.';
const asOf = (iso: string) => `As of ${fmtDateTime(iso)}.`;
const checked = (r: { fetchedAt: string }) =>
  `Source unavailable (checked ${fmtDateTime(r.fetchedAt)}).`;

/** A part's figure: the value, or "Could not load" when its own read failed. */
const val = <T,>(p: Part<T>, pick: (d: T) => number | string | null) =>
  p === null ? null : p.ok ? pick(p.data) : 'Could not load';

function Block(props: {
  id: string;
  title: string;
  definition: string;
  freshness: string;
  href: string;
  link: string;
  children: ReactNode;
}) {
  return (
    <Segment
      id={props.id}
      title={props.title}
      description={`${props.definition} ${props.freshness}`}
      actions={<a href={props.href}>{props.link}</a>}
    >
      {props.children}
    </Segment>
  );
}

function Figures({ label, items }: { label: string; items: Figure[] }) {
  return (
    <ul className="el-grid ops-kpis ops-kpis-dense" aria-label={label}>
      {items.map((f) => (
        <li key={f.label}>
          <StatCard {...f} />
        </li>
      ))}
    </ul>
  );
}

const strip = <K extends string>(
  metrics: Record<K, Metric>,
  labels: Record<K, string>,
  keys: K[],
) => keys.map((k): MetricStripItem => ({ label: labels[k], metric: metrics[k] }));

export function OverviewBlocks({ o }: { o: Overview }) {
  const r = { ...o.range };
  const now = asOf(o.asOf);
  const { funnel, pipeline, collections, outstanding, crossModule, reviews, team, report, kpis } =
    o;
  const academic = crossModule?.ok ? crossModule.data.academic : null;
  const marketing = crossModule?.ok ? crossModule.data.marketing : null;
  const views = outstanding?.ok ? outstanding.data.views : null;
  return (
    <div className="el-stack">
      {funnel ? (
        <Block
          id="demos"
          title="Demos and conversion"
          definition="Leads first received in the period by the furthest stage they reached; demos with a class in the period and their outcome."
          freshness={now}
          href={listHref('/ops/reports/admissions', r)}
          link="Admissions report"
        >
          {funnel.ok ? (
            <Figures
              label="Demos and conversion"
              items={[
                ...funnel.data.funnel.map((s) => ({
                  label: s.label,
                  value: s.count,
                  note: s.of
                    ? s.ratePct === null
                      ? 'Not enough data'
                      : `${s.ratePct}% of the stage before`
                    : funnel.data.scope === 'own'
                      ? 'Your own leads only'
                      : 'All leads',
                  href: listHref('/ops/reports/admissions', r) + '#funnel',
                })),
                {
                  label: 'Demos converted',
                  value:
                    funnel.data.demoConversion.byOutcome.find((g) => g.group === 'converted')
                      ?.demos ?? 0,
                  note: `Of ${funnel.data.demoConversion.total} demo(s) with a class in the period`,
                  href: demoListHref(r),
                },
              ]}
            />
          ) : (
            <p className="el-field-hint">{COULD_NOT_LOAD}</p>
          )}
        </Block>
      ) : null}

      {pipeline ? (
        <Block
          id="confirmations"
          title="Admission confirmations"
          definition="Applications with both signatures waiting for the approver's password confirmation (right now), and admissions confirmed in the period."
          freshness={now}
          href="/ops/admissions/applications?status=signatures_confirmed"
          link="Applications awaiting approval"
        >
          <Figures
            label="Admission confirmations"
            items={[
              {
                label: 'Waiting for confirmation',
                value: val(pipeline, (d) => d.applications.awaiting.signatures_confirmed.value),
                note: 'Signed, right now',
                href: '/ops/admissions/applications?status=signatures_confirmed',
              },
              {
                label: 'Blocked by a missing item',
                value: val(pipeline, (d) => d.applications.approvalBlocked),
                note: pipeline.ok
                  ? `Of the ${pipeline.data.applications.approvalChecked} oldest checked`
                  : undefined,
                href: '/ops/admissions/applications?status=signatures_confirmed',
              },
              {
                label: 'Confirmed in the period',
                value: val(pipeline, (d) => d.confirmed.metric.value),
                href: `${listHref('/ops/admissions/overview', r)}#confirmed`,
              },
            ]}
          />
        </Block>
      ) : null}

      {collections || outstanding ? (
        <Block
          id="fees"
          title="Fee collections"
          definition="Manually recorded, not verified payments: payments minus refunds with a payment date in the period (voided and reversed entries never count), and tuition instalments of active agreements due by today with money still owed."
          freshness={now}
          href={listHref('/ops/fees/collections', r)}
          link="Collections"
        >
          <Figures
            label="Fee collections"
            items={[
              {
                label: 'Collected in the period',
                value: val(collections, (d) =>
                  d.collected ? fmtPaise(d.collected.netPaise) : null,
                ),
                missingLabel: 'No payment recorded yet',
                note: 'Payments minus refunds, INR',
                href: listHref('/ops/fees/collections', r),
              },
              {
                label: 'Instalments due and unpaid',
                value: val(outstanding, (d) => d.views.due.count),
                note: views ? `${fmtPaise(views.due.owedPaise)} still owed` : undefined,
                href: '/ops/fees/outstanding?status=due',
              },
              {
                label: 'Overdue instalments',
                value: val(outstanding, (d) => d.views.overdue.count),
                note: views ? `${fmtPaise(views.overdue.owedPaise)} past its due date` : undefined,
                href: '/ops/fees/outstanding?status=overdue',
              },
            ]}
          />
        </Block>
      ) : null}

      {pipeline ? (
        <Block
          id="onboarding"
          title="Student onboarding"
          definition="Checklist items of current students that are completed or not applicable, and items past their due date. Right now, not limited to the period."
          freshness={now}
          href="/ops/admissions/overview#overdue-onboarding"
          link="Overdue onboarding"
        >
          <Figures
            label="Student onboarding"
            items={[
              {
                label: 'Checklist items done',
                value: val(pipeline, ({ onboarding: { completion: c } }) =>
                  c.total ? `${c.done} of ${c.total}` : null,
                ),
                missingLabel: 'No checklist built yet',
                href: '/ops/students',
              },
              {
                label: 'Overdue items',
                value: val(pipeline, (d) => d.onboarding.items.value),
                missingLabel: 'No checklist built yet',
                note: pipeline.ok ? `${pipeline.data.onboarding.admissions} student(s)` : undefined,
                href: '/ops/admissions/overview#overdue-onboarding',
              },
            ]}
          />
        </Block>
      ) : null}

      {crossModule || reviews ? (
        <Block
          id="teaching"
          title="Teaching (Academic OS)"
          definition="Classes planned, delivered and cancelled, student attendance and syllabus progress from Academic OS; teacher reviews of students published in the period. Planned is never counted as delivered."
          freshness={
            academic?.status === 'available'
              ? asOf(academic.data.generatedAt)
              : academic
                ? checked(academic)
                : now
          }
          href={listHref('/ops/academic-summary', r)}
          link="Academic summary"
        >
          {academic?.status === 'available' ? (
            <MetricStrip
              label="Academic delivery"
              items={strip(academic.data.metrics, ACADEMIC_LABELS, [
                'classesPlanned',
                'classesDelivered',
                'classesCancelled',
                'attendanceRate',
                'syllabusCompletionRate',
                'studentsAtRisk',
              ])}
            />
          ) : academic ? (
            <Unavailable name="Academic OS" result={academic} />
          ) : null}
          {reviews ? (
            <Figures
              label="Teacher reviews"
              items={[
                {
                  label: 'Teacher reviews published',
                  value: val(reviews, (d) =>
                    d.status === 'available' ? d.total : 'Source unavailable',
                  ),
                  note:
                    reviews.ok && reviews.data.status === 'unavailable'
                      ? `Checked ${fmtDateTime(reviews.data.checkedAt)}`
                      : 'Latest version submitted in the period',
                  href: `${listHref('/ops/academic-summary', r)}#reviews`,
                },
              ]}
            />
          ) : null}
          {crossModule ? (
            <p className="el-field-hint">Teacher attendance: {HR_UNAVAILABLE}.</p>
          ) : null}
        </Block>
      ) : null}

      {team ? (
        <Block
          id="team"
          title="Tasks and EOD reports"
          definition="Submitted EOD reports against one expected per person per day up to today (staff with a sign-in; no working-days policy yet), and tasks overdue or blocked at the end of the period. Scope: everyone, or you and the people who report to you."
          freshness={team.ok ? asOf(team.data.asOf) : now}
          href={listHref('/ops/tasks/reports', r)}
          link="Task reports"
        >
          {team.ok ? (
            <Figures
              label="Tasks and EOD reports"
              items={[
                {
                  label: 'EOD reports submitted',
                  value: team.data.totals.eodSubmitted,
                  note: `Of ${team.data.people.reduce((n, p) => n + (p.eod.days ?? 0), 0)} expected`,
                  href: listHref('/ops/tasks/reports', r),
                },
                {
                  label: 'EOD reports missing',
                  value: team.data.totals.eodMissing,
                  href: listHref('/ops/tasks/reports', r),
                },
                {
                  label: 'Overdue tasks',
                  value: team.data.totals.overdue,
                  note: 'Open and past due at the cut-off',
                  href: '/ops/tasks?tab=all',
                },
                {
                  label: 'Blocked tasks',
                  value: team.data.totals.blocked,
                  href: listHref('/ops/tasks/reports', r),
                },
              ]}
            />
          ) : (
            <p className="el-field-hint">{team.reason ?? COULD_NOT_LOAD}</p>
          )}
        </Block>
      ) : null}

      {report || marketing ? (
        <Block
          id="marketing"
          title="Leads and marketing"
          definition="Leads first received in the period by the source of their first enquiry, outcomes of demos with a class in the period, and campaign figures from Marketing OS."
          freshness={
            marketing?.status === 'available'
              ? asOf(marketing.data.generatedAt)
              : marketing
                ? checked(marketing)
                : now
          }
          href={listHref('/ops/marketing-summary', r)}
          link="Marketing summary"
        >
          {report?.ok ? (
            <DetailTable
              caption="Leads by source"
              rows={[
                ...report.data.bySource
                  .slice(0, 6)
                  .map((s) => ({ label: s.label, value: `${s.count} lead(s)` })),
                report.data.bySource.length === 0 && {
                  label: 'Leads by source',
                  value: 'No leads were received in the period.',
                },
                funnel?.ok && {
                  label: 'Demo outcomes',
                  value:
                    funnel.data.demoConversion.byOutcome
                      .map((g) => `${humanise(g.group)} ${g.demos}`)
                      .join(' · ') || 'No demo class in the period.',
                },
              ]}
            />
          ) : report ? (
            <p className="el-field-hint">{COULD_NOT_LOAD}</p>
          ) : null}
          {marketing?.status === 'available' ? (
            <MetricStrip
              label="Campaign figures"
              items={strip(marketing.data.metrics, MARKETING_LABELS, [
                'postsPublished',
                'totalReach',
                'engagementRate',
                'leadsAttributed',
              ])}
            />
          ) : marketing ? (
            <Unavailable name="Marketing OS" result={marketing} />
          ) : null}
        </Block>
      ) : null}

      {kpis ? (
        <Block
          id="follow-ups"
          title="Leads, follow-ups and workload"
          definition="Defined KPIs (docs/KPI_DEFINITIONS.md); each figure states its own window. Workload is open items per person, a capacity view, not a score."
          freshness={kpis.ok ? asOf(kpis.data.asOf) : now}
          href="/ops/leads"
          link="Leads"
        >
          {kpis.ok ? (
            <>
              <MetricStrip
                label="Defined KPIs"
                items={[
                  { label: 'New leads', metric: kpis.data.kpis.newLeads, href: '/ops/leads' },
                  { label: 'Lead → admission conversion', metric: kpis.data.kpis.conversion },
                  { label: 'Follow-up compliance', metric: kpis.data.kpis.followUpCompliance },
                  {
                    label: 'Overdue follow-ups',
                    metric: kpis.data.kpis.overdueWork,
                    href: '/ops/leads?flag=overdue',
                  },
                ]}
              />
              <details className="el-explain">
                <summary>Open items per staff member</summary>
                <RecordTable
                  rows={kpis.data.workload.rows.filter((w) => w.totalOpenItems > 0)}
                  rowKey={(w) => w.staffId}
                  empty="No open follow-ups or admissions are assigned."
                  columns={[
                    { key: 'fullName', header: 'Staff member' },
                    { key: 'openFollowUps', header: 'Open follow-ups', numeric: true },
                    { key: 'openAdmissions', header: 'Open admissions', numeric: true },
                    { key: 'totalOpenItems', header: 'Total', numeric: true },
                  ]}
                />
                {kpis.data.workload.unassigned > 0 ? (
                  <p className="el-field-hint">
                    {kpis.data.workload.unassigned} open item(s) have no owner.
                  </p>
                ) : null}
              </details>
            </>
          ) : (
            <p className="el-field-hint">{COULD_NOT_LOAD}</p>
          )}
        </Block>
      ) : null}
    </div>
  );
}
