/**
 * Dashboard head of a student list: a row of figure tiles that filter the table, and (Active)
 * two charts whose rows link to the filtered list. Counts come from studentListSummary
 * (every student of the view in the caller's scope, search filters not applied).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import type { ReactNode } from 'react';
import { STUDENT_FEE_STATUS_LABELS, STUDENT_FEE_STATUSES } from '../../../domain/fee-plans';
import {
  PAST_OUTCOME_LABELS,
  PAST_OUTCOME_STATUSES,
  PAST_OUTCOMES,
} from '../../../domain/student-lifecycle';
import { studentListSummary } from '../../../server/students';
import { BarChart, DonutChart, StatCard, type Datum } from '../../../ui/charts';
import { load } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { Segment } from '../../../ui/sections';
import { COHORT_LABELS } from './student-list';

type Params = Record<string, string | undefined>;
type Summary = Awaited<ReturnType<typeof studentListSummary>>;

/** A card or chart link that sets one filter (or clears it when already set), back to page 1. */
const toggle = (base: string, params: Params, key: string, value: string) =>
  listHref(base, params, { [key]: params[key] === value ? undefined : value, page: undefined });

/** The chart's values as a table, collapsed (the chart itself already labels each value). */
function AsTable({ label, data }: { label: string; data: readonly Datum[] }) {
  return (
    <details className="el-chart-table">
      <summary>Show as table</summary>
      <div className="el-table-wrap">
        <table className="el-table">
          <caption className="el-visually-hidden">{label}</caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col" className="el-num">
                Students
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row">{d.href ? <a href={d.href}>{d.label}</a> : d.label}</th>
                <td className="el-num">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ChartSegment({
  title,
  data,
  children,
}: {
  title: string;
  data: Datum[];
  children: ReactNode;
}) {
  return (
    <Segment title={title}>
      {children}
      <AsTable label={title} data={data} />
    </Segment>
  );
}

const byCount = (counts: Record<string, number>) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

async function summaryOf(user: AuthenticatedUser, view: 'active' | 'on_hold' | 'former') {
  return load((db) => studentListSummary(db, user, view));
}

function FeeChart({ s, base, params }: { s: Summary; base: string; params: Params }) {
  if (!s.fees) return null;
  const data = STUDENT_FEE_STATUSES.map((f) => ({
    label: STUDENT_FEE_STATUS_LABELS[f],
    value: s.fees?.[f] ?? 0,
    href: toggle(base, params, 'fee', f),
  }));
  return (
    <ChartSegment title="Fee status" data={data}>
      <BarChart
        label="Active students by fee status"
        data={data}
        emptyText="No active students yet."
      />
    </ChartSegment>
  );
}

/** Active students: cards (total, on hold, the three cohorts, overdue fees, meetings) and two charts. */
export async function ActiveDashboard({
  user,
  base,
  params,
}: {
  user: AuthenticatedUser;
  base: string;
  params: Params;
}) {
  const [r, held] = await Promise.all([summaryOf(user, 'active'), summaryOf(user, 'on_hold')]);
  if (!r.ok) return r.view;
  const s = r.data;
  const cohort = (key: 'CLASS_11' | 'CLASS_12' | 'DROPPER') => (
    <li key={key}>
      <StatCard
        label={COHORT_LABELS[key]}
        value={s.cohorts[key] ?? 0}
        href={toggle(base, params, 'cohort', key)}
        current={params.cohort === key}
      />
    </li>
  );
  const combinations = byCount(s.combinations).map(([label, value]) => ({ label, value }));
  return (
    <>
      <ul className="el-grid ops-kpis" aria-label="Active students at a glance">
        <li>
          <StatCard
            label="Active students"
            value={s.total}
            note="Confirmed admission"
            href={base}
            current={!Object.values(params).some(Boolean)}
          />
        </li>
        <li>
          <StatCard
            label="On hold"
            value={held.ok ? held.data.total : null}
            note={held.ok ? `${held.data.reviewsDue} to review in 7 days` : 'Not available'}
            href={toggle(base, params, 'view', 'on_hold')}
            current={params.view === 'on_hold'}
          />
        </li>
        {cohort('CLASS_11')}
        {cohort('CLASS_12')}
        {cohort('DROPPER')}
        {s.fees ? (
          <li>
            <StatCard
              label="Fees overdue"
              value={s.fees.overdue ?? 0}
              note="Instalment past due"
              href={toggle(base, params, 'fee', 'overdue')}
              current={params.fee === 'overdue'}
            />
          </li>
        ) : null}
        <li>
          <StatCard
            label="Meetings booked"
            value={s.meetings}
            note={`For ${s.studentsWithMeetings} student${s.studentsWithMeetings === 1 ? '' : 's'}`}
            href={toggle(base, params, 'meeting', 'upcoming')}
            current={params.meeting === 'upcoming'}
          />
        </li>
      </ul>
      <div className="ops-panels">
        <ChartSegment title="Programme combinations" data={combinations}>
          <DonutChart
            label="Active students by programme combination"
            data={combinations}
            totalLabel="Students"
            emptyText="No active students yet."
          />
        </ChartSegment>
        <FeeChart s={s} base={base} params={params} />
      </div>
    </>
  );
}

/** Past students head: one figure per outcome; each filters the list. */
export async function PastSummary({
  user,
  base,
  params,
}: {
  user: AuthenticatedUser;
  base: string;
  params: Params;
}) {
  const r = await summaryOf(user, 'former');
  if (!r.ok) return r.view;
  return (
    <ul className="el-grid ops-kpis" aria-label="Past students by outcome">
      <li>
        <StatCard
          label="Past students"
          value={r.data.total}
          note="Left every programme"
          href={listHref(base, { tab: params.tab })}
          current={!Object.entries(params).some(([k, v]) => v && k !== 'tab')}
        />
      </li>
      {PAST_OUTCOMES.map((o) => (
        <li key={o}>
          <StatCard
            label={PAST_OUTCOME_LABELS[o]}
            value={PAST_OUTCOME_STATUSES[o].reduce((n, st) => n + (r.data.statuses[st] ?? 0), 0)}
            href={toggle(base, params, 'outcome', o)}
            current={params.outcome === o}
          />
        </li>
      ))}
    </ul>
  );
}
