import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Select,
  StatusBadge,
  TextInput,
} from '@elevate/shared-ui';
import { isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import { METRIC_KEYS, formatIst, modulePath } from '../../../domain';
import { teamWide, weeklyReport } from '../../../server';
import { IntegrationBadge, MetricCell } from '../../../ui/badges';
import { MarketingPage, Section, param, type SearchParams } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Weekly report' };

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export default async function WeeklyReportPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const weekRaw = param(sp, 'week');
  const week = (weekRaw && isIsoDate(weekRaw) ? weekRaw : toIsoDate()) as IsoDate;
  const byCampaign = param(sp, 'groupBy') === 'campaign';
  return (
    <MarketingPage
      permission="marketing:metrics:read"
      path={modulePath('metrics/weekly')}
      active="reports"
      title="Weekly report"
      description="Monday to Sunday (IST), from imported exports only. Missing values are never added as zero."
      searchParams={sp}
    >
      {(user) => (
        <Section
          load={async () => {
            // Per-campaign figures cover every campaign: team-wide readers only.
            const team = teamWide(user);
            const groupBy = byCampaign && team ? 'campaign' : 'account';
            const r = await weeklyReport(getDb(), { weekOf: week, groupBy });
            return (
              <div className="el-stack">
                <form method="get" className="el-inline-form">
                  <Field id="week" label="Any day in the week">
                    <TextInput id="week" name="week" type="date" defaultValue={r.window.from} />
                  </Field>
                  <Field id="groupBy" label="Group by">
                    <Select id="groupBy" name="groupBy" defaultValue={groupBy}>
                      <option value="account">Account</option>
                      {team ? <option value="campaign">Campaign</option> : null}
                    </Select>
                  </Field>
                  <div>
                    <Button type="submit" variant="secondary">
                      Show
                    </Button>
                  </div>
                </form>
                <p>
                  <strong>{r.window.label}</strong> ({r.window.from} to {r.window.to}) · as of{' '}
                  {formatIst(r.asOf)}
                </p>
                {r.aggregation.groups.length === 0 ? (
                  <EmptyState
                    title="No metric data for posts published this week"
                    description="Import an export on the Metrics import screen. No data is not the same as zero."
                  />
                ) : (
                  <DataTable
                    compact
                    caption={`By ${groupBy}`}
                    rows={r.aggregation.groups}
                    rowKey={(g) => g.key}
                    columns={[
                      {
                        key: 'key',
                        header: groupBy === 'account' ? 'Account' : 'Campaign',
                        render: (g) => <strong>{g.key}</strong>,
                      },
                      {
                        key: 'posts',
                        header: 'Posts with data',
                        render: (g) => (
                          <>
                            {g.posts}{' '}
                            {g.patternReliable ? null : (
                              <StatusBadge tone="warning">
                                fewer than 6 — pattern not reliable
                              </StatusBadge>
                            )}
                            <div className="el-field-hint">sources: {g.sources.join(', ')}</div>
                          </>
                        ),
                      },
                      ...METRIC_KEYS.map((k) => ({
                        key: k,
                        header: k.replace('_', ' '),
                        numeric: true,
                        render: (g: (typeof r.aggregation.groups)[number]) => (
                          <MetricCell m={g.metrics[k]} />
                        ),
                      })),
                      {
                        key: 'rate',
                        header: 'IG (saves+shares)/reach',
                        render: (g) =>
                          g.saveShareRate.value === null ? (
                            <StatusBadge>missing</StatusBadge>
                          ) : (
                            `${g.saveShareRate.value}% (${g.saveShareRate.withData}/${g.saveShareRate.posts})`
                          ),
                      },
                      {
                        key: 'median',
                        header: 'Median views',
                        render: (g) =>
                          g.medianViews.value === null ? (
                            <StatusBadge>missing</StatusBadge>
                          ) : (
                            nf.format(g.medianViews.value)
                          ),
                      },
                      {
                        key: 'best',
                        header: 'Best post',
                        render: (g) =>
                          g.bestPost
                            ? `${g.bestPost.title ?? g.bestPost.postKey} (${nf.format(g.bestPost.views)})`
                            : '—',
                      },
                    ]}
                  />
                )}
                <Card
                  title="Planned vs published (by account)"
                  description="Planned uses the ORIGINAL publish time. Sandbox publications are not real posts."
                >
                  <DataTable
                    compact
                    rows={r.accounts}
                    rowKey={(a) => a.accountCode}
                    columns={[
                      { key: 'code', header: 'Account', render: (a) => a.accountCode },
                      {
                        key: 'int',
                        header: 'Integration',
                        render: (a) => <IntegrationBadge status={a.integrationStatus} />,
                      },
                      {
                        key: 'planned',
                        header: 'Planned',
                        numeric: true,
                        render: (a) => a.plannedByOriginalTime,
                      },
                      {
                        key: 'pub',
                        header: 'Published (live link)',
                        numeric: true,
                        render: (a) => a.publishedReal,
                      },
                      {
                        key: 'legacy',
                        header: 'Reported by legacy tracker',
                        numeric: true,
                        render: (a) => a.publishedLegacyReported,
                      },
                      {
                        key: 'sandbox',
                        header: 'Sandbox (nothing posted)',
                        numeric: true,
                        render: (a) => a.publishedSandbox,
                      },
                      {
                        key: 'data',
                        header: 'Posts with metrics',
                        numeric: true,
                        render: (a) => a.postsWithData,
                      },
                    ]}
                  />
                </Card>
                {r.accountsWithNoData.length ? (
                  <Alert tone="warning" title="Accounts with no numbers this week">
                    {r.accountsWithNoData.join(', ')}
                  </Alert>
                ) : null}
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
