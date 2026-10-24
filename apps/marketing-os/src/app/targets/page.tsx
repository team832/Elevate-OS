import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { MARKETING_TARGET_SCOPES, getDb } from '@elevate/database';
import { Button, Card, DataTable, EmptyState, Field, Select, TextInput } from '@elevate/shared-ui';
import { isIsoDate, toIsoDate } from '@elevate/shared-types';
import { modulePath } from '../../domain';
import {
  TARGET_METRICS,
  TARGET_METRIC_KEYS,
  TARGET_SCOPE_LABELS,
  formatPeriod,
  monthRange,
} from '../../domain/metrics';
import { memberOptions } from '../../server/campaign-members';
import { listCampaigns } from '../../server/groups';
import { admissionAttribution, targetVsActual } from '../../server/targets';
import { MarketingPage, Section, param, type SearchParams } from '../../ui/shell';
import { createTargetAction } from './actions';
import { MetricDefinitions, TargetChart, actualText, whoOf } from './parts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Targets' };

/** Marketing targets vs actuals counted from records (brief 23 Oct 2026 §15). */
export default async function TargetsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const month = monthRange(toIsoDate().slice(0, 7))!;
  const pick = (k: string, d: string) => {
    const v = param(sp, k);
    return v && isIsoDate(v) ? v : d;
  };
  const from = pick('from', month.from);
  const to = pick('to', month.to);
  const period = formatPeriod(from, to);
  return (
    <MarketingPage
      permission="marketing:targets:read"
      path={modulePath('targets')}
      active="targets"
      title="Targets"
      description="Targets by person, team or campaign, against what the records show."
      searchParams={sp}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const rows = await targetVsActual(db, user, { from, to });
            const manage = can(user, 'marketing:targets:manage');
            const [people, campaigns, credit] = [
              manage ? await memberOptions(db) : [],
              manage ? await listCampaigns(db) : [],
              await admissionAttribution(db),
            ];
            return (
              <div className="el-stack">
                <form method="get" className="el-inline-form" aria-label="Period">
                  <Field id="from" label="From">
                    <TextInput id="from" name="from" type="date" defaultValue={from} />
                  </Field>
                  <Field id="to" label="To">
                    <TextInput id="to" name="to" type="date" defaultValue={to} />
                  </Field>
                  <Button type="submit" variant="secondary">
                    Show period
                  </Button>
                </form>
                <Card title={`Target vs actual, ${period}`}>
                  <TargetChart rows={rows} period={period} />
                  <details className="el-explain">
                    <summary>How this chart is counted</summary>
                    Each bar is one target whose period overlaps {period}: the actual over the
                    target&apos;s own period divided by the target, in per cent. Actuals are counted
                    from the records listed on each target&apos;s page, the same rows the bar uses.
                    A target whose source cannot be read is not drawn.
                  </details>
                </Card>
                <DataTable
                  caption={`Targets in ${period} (${rows.length})`}
                  rows={rows}
                  rowKey={(r) => r.target.id}
                  empty={
                    <EmptyState
                      title="No targets in this period"
                      description={
                        manage
                          ? 'Set the first one below.'
                          : 'A marketing manager sets targets. Yours will appear here.'
                      }
                    />
                  }
                  columns={[
                    {
                      key: 'metric',
                      header: 'Metric',
                      render: (r) => (
                        <a href={modulePath(`targets/${r.target.id}`)}>
                          {TARGET_METRICS[r.target.metricKey].label}
                        </a>
                      ),
                    },
                    { key: 'who', header: 'For', render: whoOf },
                    {
                      key: 'period',
                      header: 'Period',
                      render: (r) => formatPeriod(r.target.periodStart, r.target.periodEnd),
                    },
                    {
                      key: 'target',
                      header: 'Target',
                      numeric: true,
                      render: (r) => r.target.targetValue,
                    },
                    {
                      key: 'actual',
                      header: 'Actual',
                      numeric: true,
                      render: (r) => actualText(r.actual),
                    },
                    {
                      key: 'remaining',
                      header: 'Remaining',
                      numeric: true,
                      render: (r) => r.remaining ?? 'Not available',
                    },
                  ]}
                />
                <Card title="What each metric counts">
                  <MetricDefinitions credit={credit} />
                </Card>
                {manage ? (
                  <Card title="Set a target">
                    <form action={createTargetAction} className="el-grid">
                      <Field
                        id="scope"
                        label="For"
                        hint="Choose the person or campaign below when needed."
                      >
                        <Select id="scope" name="scope">
                          {MARKETING_TARGET_SCOPES.map((s) => (
                            <option key={s} value={s}>
                              {TARGET_SCOPE_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field id="staffId" label="Employee (employee targets)">
                        <Select id="staffId" name="staffId" defaultValue="">
                          <option value="">Choose a person</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field id="campaignId" label="Campaign (campaign targets)">
                        <Select id="campaignId" name="campaignId" defaultValue="">
                          <option value="">Choose a campaign</option>
                          {campaigns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} {c.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field id="metricKey" label="Metric">
                        <Select id="metricKey" name="metricKey">
                          {TARGET_METRIC_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {TARGET_METRICS[k].label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field id="targetValue" label="Target">
                        <TextInput
                          id="targetValue"
                          name="targetValue"
                          type="number"
                          min={1}
                          max={100000}
                          required
                        />
                      </Field>
                      <Field id="periodStart" label="Period starts">
                        <TextInput
                          id="periodStart"
                          name="periodStart"
                          type="date"
                          required
                          defaultValue={from}
                        />
                      </Field>
                      <Field id="periodEnd" label="Period ends">
                        <TextInput
                          id="periodEnd"
                          name="periodEnd"
                          type="date"
                          required
                          defaultValue={to}
                        />
                      </Field>
                      <Field id="note" label="Note">
                        <TextInput id="note" name="note" maxLength={500} />
                      </Field>
                      <div>
                        <Button type="submit">Set target</Button>
                      </div>
                    </form>
                  </Card>
                ) : null}
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
