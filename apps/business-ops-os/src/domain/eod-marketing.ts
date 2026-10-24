/**
 * The marketing facts of a monthly work report as label/text rows for the report view, PDF and
 * CSV (brief 23 Oct 2026 §15). Counted by Marketing OS; missing stays "Not available", never 0.
 * Pure.
 */
import type { Metric } from '@elevate/shared-contracts';
import type { MarketingFacts } from './eod';

const count = (m: Metric) =>
  m.status === 'missing' ? `Not available (${m.reason})` : String(m.value);
const words = (key: string) => key.replaceAll('_', ' ');
const listOr = (items: string[], none: string) => (items.length ? items.join('; ') : none);

export function marketingRows(
  m: MarketingFacts,
  when: (iso: string) => string,
): [string, string][] {
  if (m.status === 'missing')
    return [['Marketing facts', `Source unavailable: Marketing OS (${m.reason}). Not counted.`]];
  const s = m.snapshot;
  const c = s.content;
  return [
    ...(s.isSample
      ? ([['SAMPLE DATA', 'These marketing facts include fictional sample records.']] as [
          string,
          string,
        ][])
      : []),
    [
      'Marketing targets',
      listOr(
        s.targets.map(
          (t) =>
            `${words(t.metricKey)}: ${count(t.actual)} of ${t.target} (${t.actual.window.from} to ${t.actual.window.to})`,
        ),
        'No employee targets for this month',
      ),
    ],
    ...[...s.funnel, ...s.callOutcomes].map((r): [string, string] => [r.label, count(r.count)]),
    [
      'Content owned',
      `${count(c.planned)} planned · ${count(c.approved)} approved · ${count(c.published)} published`,
    ],
    [
      'Campaign activity',
      listOr(
        s.campaigns.map(
          (x) =>
            `${x.code} ${x.name}: ${count(x.planned)} planned, ${count(x.approved)} approved, ${count(x.published)} published`,
        ),
        'Not a member of any campaign this month',
      ),
    ],
    [
      'SEO / AIO / GEO work',
      listOr(
        s.optimisation.map(
          (o) =>
            `${o.topic} (${o.categoryKey.toUpperCase()}, ${words(o.reviewState)}): ${o.evidence ?? 'no evidence yet'}`,
        ),
        'None this month',
      ),
    ],
    ['Expenses and cost per outcome', 'No verified spend data: not shown.'],
    ['Marketing facts as of', `${when(s.cutoffAt)} (Marketing OS)`],
  ];
}
