/**
 * Overview blocks (brief 23 Oct 2026 §10; server components, no data access). Every number comes
 * from loadOverview, whose queries also feed the lists the tiles open. Missing is said in words
 * ("Not available yet", "Could not be loaded"), never as 0; each block names its source.
 */
import type { ReactNode } from 'react';
import type { followUpDaySummary } from '@elevate/business-ops-os/leads';
import { STANDING_LABELS, type taskDaySummary } from '@elevate/business-ops-os/work';
import {
  BarChart,
  Button,
  ButtonLink,
  Card,
  DataTable,
  Field,
  FunnelChart,
  SourceBadge,
  StatCard,
  StatusBadge,
  TextInput,
} from '@elevate/shared-ui';
import { formatIst, modulePath } from '../domain';
import { TARGET_METRICS } from '../domain/metrics';
import { notFiltered, type DashboardFilters, type FilterKey } from '../server/dashboard-filters';
import type { LeadFigures, Overview } from '../server/dashboard-overview';
import { PickField, type Option } from './fields';

/** Figures, null without a staff record, or 'failed' when the summary could not load. */
export type FollowUpSummary = Awaited<ReturnType<typeof followUpDaySummary>> | 'failed';
export type TaskSummary = Awaited<ReturnType<typeof taskDaySummary>> | 'failed';
type TaskCount = Overview['tasks']['overdue'];

const words = (s: string) => s.replace('_', ' ');
const asOf = (at: Date) => `as of ${formatIst(at)}`;
const noStaff = (what: string) =>
  `No staff record is linked to your account, so your ${what} cannot be shown.`;
const missing = (label: string, note: string, missingLabel = 'Not available') => (
  <StatCard label={label} value={null} missingLabel={missingLabel} note={note} />
);

/** Where a block's numbers come from: Elevate OS records, a manual import, or sample data. */
export function Provenance({ manual, sample }: { manual?: boolean; sample?: boolean }) {
  return (
    <>
      <StatusBadge>{manual ? 'Manual import' : 'Elevate OS records'}</StatusBadge>
      {sample ? <SourceBadge source="sample" note="Includes fictional sample records" /> : null}
    </>
  );
}

/** How a block is counted, collapsed under its title (§24: definition, period, filters). */
export const Explain = ({ children }: { children: ReactNode }) => (
  <details className="el-explain">
    <summary>How this is counted</summary>
    {children}
  </details>
);

export const periodText = (f: Pick<DashboardFilters, 'from' | 'to'>) =>
  `${f.from} to ${f.to} (IST)`;

export function OverviewFilters({
  f,
  owners,
  campaigns,
  courses,
}: {
  f: DashboardFilters;
  owners: readonly Option[];
  campaigns: readonly Option[];
  courses: readonly Option[];
}) {
  return (
    <form
      method="get"
      action={modulePath()}
      className="el-card"
      aria-label="Reporting period and filters"
    >
      <div className="el-grid">
        <Field id="from" label="From (IST)">
          <TextInput id="from" name="from" type="date" defaultValue={f.from} required />
        </Field>
        <Field id="to" label="To (IST)">
          <TextInput id="to" name="to" type="date" defaultValue={f.to} required />
        </Field>
        <PickField
          id="owner"
          label="Owner"
          value={f.owner}
          options={owners}
          none="Everyone in my scope"
        />
        <PickField
          id="campaign"
          label="Campaign"
          value={f.campaign}
          options={campaigns}
          none="All campaigns"
        />
        <PickField
          id="course"
          label="Course"
          value={f.course}
          options={courses}
          none="All courses"
        />
      </div>
      <div className="el-inline-form">
        <Button type="submit">Apply filters</Button>
        <ButtonLink href={modulePath('settings/personal')}>Change my default filters</ButtonLink>
        <span className="el-field-hint">
          Period {periodText(f)}
          {f.fromDefaults ? ' · your default filters' : ''}
        </span>
      </div>
    </form>
  );
}

const taskTile = (label: string, r: TaskCount, note: string, href?: string) =>
  r === undefined ? null : r === 'failed' ? (
    missing(label, 'Task counts could not be loaded.')
  ) : (
    <StatCard label={label} value={r.total} href={href ?? r.href} note={note} />
  );

/** A tile's note plus, visibly, the active filters its count does not apply. */
const noteWith = (f: DashboardFilters, applied: readonly FilterKey[], text: string) =>
  [text, notFiltered(f, applied)].filter(Boolean).join(' · ');

/** The same line on a card, above its content. */
export function Unfiltered({ f, applied }: { f: DashboardFilters; applied: readonly FilterKey[] }) {
  const text = notFiltered(f, applied);
  return text ? <p className="el-field-hint">{text}.</p> : null;
}

/** The decisions of the day, each tile opening the list it counts (with the filters it applies). */
export function DecisionTiles({ o }: { o: Overview }) {
  const f = o.filters;
  const owner = f.owner ? 'the chosen owner' : 'everyone in your scope';
  return (
    <section className="el-grid" aria-label="Needs a decision">
      {o.leads === undefined ? null : o.leads === 'failed' ? (
        missing('Leads awaiting first contact', 'Lead figures could not be loaded.')
      ) : (
        <StatCard
          label="Leads awaiting first contact"
          value={o.leads.awaitingContact}
          href={o.leads.awaitingHref}
          note={noteWith(f, [], 'Open leads nobody has reached two-way')}
        />
      )}
      <FollowUpTiles followUps={o.followUps} unfiltered={notFiltered(f, [])} />
      <StatCard
        label="Content awaiting review"
        value={o.awaitingReview.length}
        href="#awaiting"
        note={noteWith(f, ['campaign'], f.campaign ? 'In the chosen campaign' : 'All campaigns')}
      />
      {o.calendar === undefined ? null : o.calendar === 'failed' ? (
        missing('Calendar items', 'Calendar counts could not be loaded.')
      ) : (
        <>
          <StatCard
            label="Calendar items due"
            value={o.calendar.due}
            href={o.calendar.dueHref}
            note={noteWith(
              f,
              ['period', 'owner', 'campaign', 'course'],
              'Open items in the period',
            )}
          />
          <StatCard
            label="Calendar items awaiting review"
            value={o.calendar.awaitingReview}
            href={o.calendar.reviewHref}
            note={noteWith(
              f,
              ['period', 'owner', 'campaign', 'course'],
              'Submitted, in the period',
            )}
          />
        </>
      )}
      {taskTile(
        'Overdue tasks',
        o.tasks.overdue,
        noteWith(f, ['owner'], `Past their deadline · ${owner}`),
      )}
      {taskTile(
        'Tasks due in the period',
        o.tasks.dueInPeriod,
        noteWith(f, ['period', 'owner'], `${periodText(f)} · ${owner}`),
      )}
      {taskTile(
        'Blocked tasks',
        o.tasks.blocked,
        noteWith(f, ['owner'], `Open and flagged blocked · ${owner}`),
      )}
    </section>
  );
}

function FollowUpTiles({
  followUps,
  unfiltered,
}: {
  followUps?: FollowUpSummary | undefined;
  /** The Overview's "Not filtered by …" line; none on My Day. */
  unfiltered?: string;
}) {
  const tail = unfiltered ? ` · ${unfiltered}` : '';
  if (followUps === undefined) return null;
  if (followUps === 'failed' || followUps === null)
    return missing(
      'Follow-ups',
      followUps === null ? noStaff('follow-ups') : 'Follow-up counts could not be loaded.',
    );
  return (
    <>
      <StatCard
        label="Follow-ups due today"
        value={followUps.dueToday}
        href={modulePath('follow-ups?view=due_today')}
        note={`${followUps.upcoming} upcoming in the next ${followUps.upcomingWindowDays} days · ${asOf(followUps.asOf)}${tail}`}
      />
      <StatCard
        label="Missed follow-ups"
        value={followUps.overdue}
        href={modulePath('follow-ups?view=overdue')}
        note={`Open and due before today${tail}`}
      />
    </>
  );
}

/** Leads that reached each stage in the period; each row opens exactly those leads. */
export function LeadFunnel({ leads, f }: { leads: LeadFigures | 'failed'; f: DashboardFilters }) {
  return (
    <Card
      title="Leads by stage reached"
      meta={leads === 'failed' ? undefined : <Provenance sample={leads.hasSample} />}
      actions={<a href={modulePath('leads')}>All leads</a>}
    >
      <Explain>
        Leads that entered each stage for the first time between {periodText(f)}, whatever stage
        they are in now; a lead counts once per stage. Demo bookings and admission outcomes are the
        demo, converted and lost stages. Your lead scope.
      </Explain>
      <Unfiltered f={f} applied={['period']} />
      {leads === 'failed' ? (
        <p>Lead figures could not be loaded.</p>
      ) : leads.funnel.length === 0 ? (
        <p>
          Lead stages are not set up yet. A marketing manager sets them up under{' '}
          <a href={modulePath('leads/stages')}>Lead stages</a>.
        </p>
      ) : (
        <>
          <FunnelChart
            label="Leads by stage reached in the period"
            data={leads.funnel.map((s) => ({ label: s.label, value: s.count }))}
            emptyText="No lead reached a stage in this period."
          />
          <details className="el-chart-table">
            <summary>Show as table</summary>
            <DataTable
              compact
              rows={leads.funnel}
              rowKey={(s) => s.key}
              columns={[
                { key: 'stage', header: 'Stage', render: (s) => <a href={s.href}>{s.label}</a> },
                { key: 'n', header: 'Leads', numeric: true, render: (s) => s.count },
              ]}
            />
          </details>
        </>
      )}
    </Card>
  );
}

/** My own monthly work reports (current and previous month) from Business Operations. */
export function MonthlyReports({ r, f }: { r: Overview['monthlyReports']; f: DashboardFilters }) {
  if (r === undefined) return null;
  return (
    <Card
      title="Monthly report status"
      meta={<Provenance />}
      actions={<a href={modulePath('my-reports?kind=month')}>My Work Updates</a>}
    >
      <Explain>
        Your own monthly report for this month and last month, as kept by Business Operations. Each
        team member&apos;s status is on HR&apos;s work-report list; the report&apos;s facts are on
        the <a href={modulePath('reports/monthly')}>monthly marketing report</a>.
      </Explain>
      <Unfiltered f={f} applied={[]} />
      {r === 'failed' ? (
        <p>Report status could not be loaded.</p>
      ) : r === null ? (
        <p>{noStaff('reports')}</p>
      ) : (
        <DataTable
          compact
          rows={r.recent}
          rowKey={(v) => v.label}
          columns={[
            { key: 'month', header: 'Month', render: (v) => v.label },
            {
              key: 'status',
              header: 'Status',
              render: (v) => `${STANDING_LABELS[v.standing]}${v.late ? ' (late)' : ''}`,
            },
          ]}
        />
      )}
    </Card>
  );
}

type TargetRows = Exclude<Overview['targets'], 'failed' | undefined>;

/** Progress of each target in the period; each bar opens the target with its records and gap. */
export function TargetsChart({
  targets,
  f,
}: {
  targets: TargetRows | 'failed';
  f: DashboardFilters;
}) {
  return (
    <Card
      title="Targets versus actual"
      meta={
        targets === 'failed' ? undefined : (
          <Provenance sample={targets.some((t) => t.target.isSample)} />
        )
      }
      actions={<a href={modulePath('targets')}>All targets</a>}
    >
      <Explain>
        Targets whose period overlaps the chosen period (and owner or campaign, when chosen). Each
        bar is the actual as a percentage of the target over the target&apos;s own period, counted
        from the source records; open a bar for those records and what remains. A missing source
        reads &quot;Not recorded&quot;, never 0%.
      </Explain>
      <Unfiltered f={f} applied={['period', 'owner', 'campaign']} />
      {targets === 'failed' ? (
        <p>Targets could not be loaded.</p>
      ) : (
        <BarChart
          label="Actual as a percentage of target"
          max={100}
          format={(n) => `${Math.round(n)}%`}
          data={targets.map((t) => ({
            label: `${TARGET_METRICS[t.target.metricKey].label} · ${t.staffName ?? t.campaignCode ?? 'Team'} · ${t.target.periodStart} to ${t.target.periodEnd}`,
            value:
              t.actual.value === null
                ? null
                : Math.min(100, (t.actual.value / t.target.targetValue) * 100),
            note: `${t.actual.value ?? 'not recorded'} of ${t.target.targetValue}; ${t.remaining ?? 'unknown'} remaining`,
            href: modulePath(`targets/${t.target.id}`),
          }))}
          emptyText="No target overlaps this period. Managers set targets on the Targets page."
        />
      )}
    </Card>
  );
}

/** The signed-in person's follow-ups, tasks and EOD status (My Day). */
export function PersonalTiles({
  followUps,
  tasks,
}: {
  /** Omitted when the person may not read leads / tasks: the tiles are not shown. */
  followUps?: FollowUpSummary | undefined;
  tasks?: TaskSummary | undefined;
}) {
  return (
    <>
      <FollowUpTiles followUps={followUps} />
      {tasks === undefined ? null : tasks === 'failed' || tasks === null ? (
        missing(
          'My tasks',
          tasks === null ? noStaff('tasks') : 'Your task status could not be loaded.',
        )
      ) : (
        <>
          <StatCard
            label="Open tasks"
            value={tasks.open}
            href={modulePath('tasks')}
            note={`${tasks.dueToday} due today · ${tasks.overdue} overdue · ${asOf(tasks.asOf)}`}
          />
          <StatCard
            label="EOD report"
            value={words(tasks.eod)}
            href={modulePath('tasks?tab=eod')}
            note={`For ${tasks.day}`}
          />
        </>
      )}
    </>
  );
}
