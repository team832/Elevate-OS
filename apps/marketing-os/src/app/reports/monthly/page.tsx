import type { Metadata } from 'next';
import { scopeFor } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  Field,
  MetricStrip,
  Select,
  TextInput,
} from '@elevate/shared-ui';
import { toIsoDate } from '@elevate/shared-types';
import { formatIst, modulePath } from '../../../domain';
import { TARGET_METRICS, monthRange, type TargetMetricKey } from '../../../domain/metrics';
import { REVIEW_STATE_LABELS, type ReviewState } from '../../../domain/optimisation';
import { memberOptions } from '../../../server/campaign-members';
import { NO_SPEND_DATA, monthlySnapshotFor } from '../../../server/monthly-report';
import { myStaffId } from '../../../server/scope';
import { MarketingPage, Section, param, type SearchParams } from '../../../ui/shell';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Monthly marketing report' };

/**
 * Monthly marketing report (brief 23 Oct 2026 §15): facts counted from records for one person and
 * month. The explanation, submission for review, review, versions and PDF/CSV live on the monthly work
 * report (My Reports), which keeps each submitted version unchanged.
 */
export default async function MonthlyReportPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const monthParam = param(sp, 'month');
  const month = monthParam && monthRange(monthParam) ? monthParam : toIsoDate().slice(0, 7);
  const staffParam = param(sp, 'staff');
  return (
    <MarketingPage
      permission="marketing:reports:read"
      path={modulePath('reports/monthly')}
      active="reports"
      title="Monthly marketing report"
      description="What the records show for one person and one month. The person adds their explanation on the work report."
      searchParams={sp}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const everyone = scopeFor(user, 'marketing:reports:read') === 'all';
            const people = everyone ? await memberOptions(db) : [];
            const r = await monthlySnapshotFor(db, user, {
              month,
              staffId:
                everyone && staffParam && people.some((p) => p.id === staffParam)
                  ? staffParam
                  : undefined,
            });
            const s = r.snapshot;
            const [name] = await memberOptions(db, r.staffId);
            const own = r.staffId === (await myStaffId(db, user.id));
            const range = monthRange(r.month)!;
            const label = s.content.planned.window.label ?? r.month;
            return (
              <div className="el-stack">
                <form method="get" className="el-inline-form" aria-label="Report period and person">
                  <Field id="month" label="Month">
                    <TextInput id="month" name="month" type="month" defaultValue={r.month} />
                  </Field>
                  {everyone ? (
                    <Field id="staff" label="Person">
                      <Select id="staff" name="staff" defaultValue={r.staffId}>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                  <Button type="submit" variant="secondary">
                    Show report
                  </Button>
                  <PrintButton />
                </form>
                <Card
                  title={`${name?.name ?? 'Staff member'}, ${label}`}
                  description={`Facts counted from records as of ${formatIst(s.cutoffAt)}. Lifecycle: Draft, Submitted for review (goes to your reporting manager), then Reviewed or Changes requested.`}
                  meta={
                    s.isSample ? (
                      <span className="el-badge el-badge-sample">Sample data</span>
                    ) : null
                  }
                >
                  <p>
                    The explanation (incomplete work and reasons, blockers, next month&apos;s plan),
                    the submission for review, manager comments, earlier versions and the PDF or CSV
                    download are on the monthly work report. HR tasks submitted and approved are
                    listed there too, from Business Operations task records.
                  </p>
                  {own ? (
                    <ButtonLink
                      variant="primary"
                      href={modulePath(`my-reports?kind=month&date=${range.from}`)}
                    >
                      Write and submit your monthly report
                    </ButtonLink>
                  ) : (
                    <ButtonLink href={modulePath('tasks/inbox')}>Open the report inbox</ButtonLink>
                  )}
                </Card>
                <Card title="Targets and actuals">
                  <DataTable
                    caption={`Employee targets overlapping ${label}`}
                    rows={s.targets}
                    rowKey={(t) => t.targetId}
                    empty={<p>No employee targets were set for this month.</p>}
                    columns={[
                      {
                        key: 'metric',
                        header: 'Metric',
                        render: (t) => (
                          <a href={modulePath(`targets/${t.targetId}`)}>
                            {TARGET_METRICS[t.metricKey as TargetMetricKey]?.label ?? t.metricKey}
                          </a>
                        ),
                      },
                      { key: 'target', header: 'Target', numeric: true },
                      {
                        key: 'actual',
                        header: 'Actual',
                        numeric: true,
                        render: (t) => t.actual.value ?? 'Not available',
                      },
                    ]}
                  />
                </Card>
                <MetricStrip
                  label="Leads, funnel movement, calls and follow-ups"
                  items={[...s.funnel, ...s.callOutcomes].map((x) => ({
                    label: x.label,
                    metric: x.count,
                  }))}
                />
                <MetricStrip
                  label={`Content owned, ${label}`}
                  items={(['planned', 'approved', 'published'] as const).map((k) => ({
                    label: `Content ${k}`,
                    metric: s.content[k],
                    note: s.content[k].definition,
                  }))}
                />
                <Card title="Campaign activity">
                  <DataTable
                    caption="Calendar items in the campaigns this person works on"
                    rows={s.campaigns}
                    rowKey={(c) => c.campaignId}
                    empty={<p>Not a member of any campaign this month.</p>}
                    columns={[
                      {
                        key: 'name',
                        header: 'Campaign',
                        render: (c) => (
                          <a href={modulePath(`campaigns/${c.campaignId}`)}>
                            {c.code} {c.name}
                          </a>
                        ),
                      },
                      ...(['planned', 'approved', 'published'] as const).map((k) => ({
                        key: k,
                        header: k[0]!.toUpperCase() + k.slice(1),
                        numeric: true,
                        render: (c: (typeof s.campaigns)[number]) => c[k].value ?? 'Not available',
                      })),
                    ]}
                  />
                </Card>
                <Card title="SEO / AIO / GEO work with evidence">
                  <DataTable
                    caption="Work items owned, due or worked on this month"
                    rows={s.optimisation}
                    rowKey={(o) => o.itemId}
                    empty={<p>No SEO, AIO or GEO work this month.</p>}
                    columns={[
                      {
                        key: 'topic',
                        header: 'Topic',
                        render: (o) => (
                          <a href={modulePath(`optimisation/${o.itemId}`)}>{o.topic}</a>
                        ),
                      },
                      {
                        key: 'categoryKey',
                        header: 'Category',
                        render: (o) => o.categoryKey.toUpperCase(),
                      },
                      {
                        key: 'reviewState',
                        header: 'Review',
                        render: (o) =>
                          REVIEW_STATE_LABELS[o.reviewState as ReviewState] ?? o.reviewState,
                      },
                      {
                        key: 'evidence',
                        header: 'Evidence',
                        render: (o) => o.evidence ?? 'None yet',
                      },
                    ]}
                  />
                </Card>
                <Card title="Expenses and cost per outcome">
                  <p>{NO_SPEND_DATA}</p>
                </Card>
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
