/**
 * Admissions report pieces shared by the reports pages and the Ops dashboard: each chart is
 * drawn from buildAdmissionsFunnel output and comes with its table (denominators included).
 */
import { DataTable, EmptyState } from '@elevate/shared-ui';
import { DEMO_OUTCOMES } from '../../../domain/demos';
import type { ConversionGroup } from '../../../domain/admissions-funnel';
import type { buildAdmissionsFunnel } from '../../../server/reports/admissions';
import { BarChart, DonutChart, FunnelChart } from '../../../ui/charts';
import { fmtPercent } from '../../../ui/chart-math';
import { humanise } from '../../../ui/format';
import { listHref } from '../../../ui/list-controls';

export type FunnelReport = Awaited<ReturnType<typeof buildAdmissionsFunnel>>;
type Window = FunnelReport['window'];

/** The demo list filtered to demos with a class in the window (the report's own date rule). */
export const demoListHref = (w: Window, patch: Record<string, string | undefined> = {}) =>
  listHref('/ops/admissions', { from: w.from, to: w.to, ...patch });

const rateText = (pct: number | null) => (pct === null ? 'Not enough data' : `${pct}%`);

export function Funnel({ report }: { report: FunnelReport }) {
  return (
    <FunnelChart
      label="Admissions funnel: leads at each stage"
      // "Completed" and "Converted" both divide by "Attended" (FUNNEL_STAGES); skipping
      // "Completed" keeps every chart "of previous" equal to the domain's denominator.
      data={report.funnel
        .filter((s) => s.key !== 'completed')
        .map((s) => ({ label: s.label, value: s.count }))}
      emptyText="No leads were first received in this period."
    />
  );
}

/** Stage table with each stage's denominator. */
export function FunnelTable({ report }: { report: FunnelReport }) {
  const label = new Map(report.funnel.map((s) => [s.key, s.label.toLowerCase()]));
  return (
    <DataTable
      caption="Stages, each with its denominator"
      rows={report.funnel}
      rowKey={(s) => s.key}
      columns={[
        { key: 'label', header: 'Stage' },
        { key: 'count', header: 'Leads', numeric: true },
        {
          key: 'of',
          header: 'Out of',
          render: (s) => (s.of ? `${s.of.count} (${label.get(s.of.key)})` : '—'),
        },
        {
          key: 'rate',
          header: 'Rate',
          numeric: true,
          render: (s) => (s.of ? rateText(s.ratePct) : '—'),
        },
      ]}
    />
  );
}

/**
 * Conversion rate per group as bars labelled with their denominator, then the table
 * (demos, with an outcome, converted, rate). `filter` adds the demo-list filter for a group.
 */
export function ConversionBreakdown<G extends ConversionGroup>({
  title,
  rows,
  window,
  filter,
}: {
  title: string;
  rows: readonly G[];
  window: Window;
  filter?: (g: G) => Record<string, string> | null;
}) {
  const href = (g: G, patch: Record<string, string> = {}) => {
    const f = filter?.(g);
    return f ? demoListHref(window, { ...f, ...patch }) : undefined;
  };
  return (
    <>
      <BarChart
        label={`Demo conversion ${title.toLowerCase()}`}
        data={rows.map((g) => ({
          label: `${g.group} (${g.decided} with an outcome)`,
          value: g.ratePct,
          href: href(g),
        }))}
        format={(n) => fmtPercent(n)}
        emptyText="No demo classes in this period, or no demo has an outcome yet."
      />
      <DataTable
        caption={title}
        rows={rows}
        rowKey={(g) => g.group}
        empty={<EmptyState title="No demo classes in this period" />}
        columns={[
          { key: 'group', header: title.replace(/^By (\w)/, (_, c: string) => c.toUpperCase()) },
          { key: 'demos', header: 'Demos', numeric: true },
          { key: 'decided', header: 'With an outcome', numeric: true },
          {
            key: 'converted',
            header: 'Converted',
            numeric: true,
            render: (g) => {
              const to = href(g, { view: 'previous', outcome: 'converted' });
              return to ? <a href={to}>{g.converted}</a> : g.converted;
            },
          },
          {
            key: 'rate',
            header: 'Rate',
            numeric: true,
            render: (g) => rateText(g.ratePct),
          },
        ]}
      />
    </>
  );
}

/** Demos with a class in the window by outcome, in the fixed outcome order (stable colours). */
export function OutcomeDonut({ report }: { report: FunnelReport }) {
  const count = new Map(report.demoConversion.byOutcome.map((g) => [g.group, g.demos]));
  const rows = DEMO_OUTCOMES.map((o) => ({
    outcome: o,
    label: o === 'open' ? 'Open (no outcome yet)' : humanise(o),
    demos: count.get(o) ?? 0,
    href: demoListHref(report.window, {
      view: o === 'open' ? 'current' : 'previous',
      outcome: o,
    }),
  }));
  return (
    <>
      <DonutChart
        label="Demos by outcome"
        data={rows.map((r) => ({ label: r.label, value: r.demos }))}
        totalLabel="Demos"
        emptyText="No demo classes in this period."
      />
      <DataTable
        caption="Demos by outcome"
        rows={rows.filter((r) => r.demos > 0)}
        rowKey={(r) => r.outcome}
        empty={<EmptyState title="No demo classes in this period" />}
        columns={[
          { key: 'label', header: 'Outcome' },
          {
            key: 'demos',
            header: 'Demos',
            numeric: true,
            render: (r) => <a href={r.href}>{r.demos}</a>,
          },
        ]}
      />
    </>
  );
}

const POPULATIONS = [
  ['active', 'Active (admitted and enrolled)', '/ops/students'],
  ['on_hold', 'On hold', '/ops/students/past?tab=on_hold'],
  ['former', 'Former (left, completed or transferred)', '/ops/students/past?tab=former'],
] as const;

/** Students right now by population, with links to each student list. */
export function StudentSummary({ students }: { students: FunnelReport['students'] }) {
  const rows = POPULATIONS.map(([key, label, href]) => ({ key, label, href, n: students[key] }));
  return (
    <>
      <DonutChart
        label="Students right now"
        data={rows.map((r) => ({ label: r.label, value: r.n }))}
        totalLabel="Students"
        emptyText="No admitted students with a student record yet."
      />
      <DataTable
        caption="Students right now"
        rows={rows}
        rowKey={(r) => r.key}
        columns={[
          { key: 'label', header: 'Students' },
          {
            key: 'n',
            header: 'Count',
            numeric: true,
            render: (r) => <a href={r.href}>{r.n}</a>,
          },
        ]}
      />
    </>
  );
}
