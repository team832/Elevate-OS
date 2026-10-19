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
import {
  METRIC_KEYS,
  coverageLabel,
  formatIst,
  modulePath,
  type AggregatedMetric,
} from '../../../domain';
import { weeklyReport } from '../../../server';
import { IntegrationBadge } from '../../../ui/badges';
import { MarketingPage, Section, param, type SearchParams } from '../../../ui/shell';

export const dynamic = 'force-dynamic';

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

function MetricCell({ m }: { m: AggregatedMetric }) {
  if (m.status === 'not_applicable') return <span className="el-field-hint">n/a</span>;
  if (m.status === 'missing') return <StatusBadge tone="neutral">missing</StatusBadge>;
  return (
    <span title={coverageLabel(m)}>
      {m.status === 'estimated' ? '≈ ' : ''}
      {nf.format(m.value ?? 0)}
      {m.status === 'partial' ? (
        <span className="el-field-hint">
          {' '}
          ({m.withData}/{m.applicable} posts)
        </span>
      ) : null}
    </span>
  );
}

export default async function WeeklyReportPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const weekRaw = param(sp, 'week');
  const week = (weekRaw && isIsoDate(weekRaw) ? weekRaw : toIsoDate()) as IsoDate;
  const groupBy = param(sp, 'groupBy') === 'campaign' ? 'campaign' : 'account';
  return (
    <MarketingPage
      permission="marketing:metrics:read"
      path={modulePath('metrics/weekly')}
      active="weekly"
      title="Weekly report"
      description="IST Monday–Sunday. Numbers come only from imported exports and the labelled manual audit; missing values are shown as missing and never added as zero."
      searchParams={sp}
    >
      {() => (
        <Section
          load={async () => {
            const r = await weeklyReport(getDb(), { weekOf: week, groupBy });
            return (
              <div className="el-stack">
                <form method="get" className="el-grid">
                  <Field id="week" label="Any day in the week">
                    <TextInput id="week" name="week" type="date" defaultValue={r.window.from} />
                  </Field>
                  <Field id="groupBy" label="Group by">
                    <Select id="groupBy" name="groupBy" defaultValue={groupBy}>
                      <option value="account">Account</option>
                      <option value="campaign">Campaign</option>
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
