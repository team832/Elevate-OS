import type { Metadata } from 'next';
import { z } from 'zod';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  StatCard,
  TextInput,
} from '@elevate/shared-ui';
import { formatIst, modulePath } from '../../../domain';
import { TARGET_METRICS, formatPeriod } from '../../../domain/metrics';
import { targetDrilldown } from '../../../server/targets';
import { MarketingPage, Section, type SearchParams } from '../../../ui/shell';
import { deleteTargetAction, updateTargetAction } from '../actions';
import { whoOf } from '../parts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Target' };

/** One target: the records that make up its actual, and what remains (same query as the chart). */
export default async function TargetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  return (
    <MarketingPage
      permission="marketing:targets:read"
      path={modulePath(`targets/${id}`)}
      active="targets"
      title="Target"
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            if (!z.uuid().safeParse(id).success)
              return <EmptyState title="Target not found" description="Check the link." />;
            const d = await targetDrilldown(getDb(), user, id);
            const m = TARGET_METRICS[d.target.metricKey];
            const t = d.target;
            const hidden = <input type="hidden" name="id" value={t.id} />;
            return (
              <div className="el-stack">
                <Card
                  title={`${m.label}: ${whoOf(d)}`}
                  description={formatPeriod(t.periodStart, t.periodEnd)}
                  meta={
                    t.isSample ? (
                      <span className="el-badge el-badge-sample">Sample data</span>
                    ) : null
                  }
                >
                  <div className="el-grid">
                    <StatCard label="Target" value={t.targetValue} note={m.unit} />
                    <StatCard
                      label="Actual"
                      value={d.actual.value}
                      missingLabel="Not available"
                      note={m.unit}
                    />
                    <StatCard
                      label="Remaining"
                      value={d.remaining}
                      missingLabel="Not available"
                      note={m.unit}
                    />
                  </div>
                  <p>
                    {m.definition} Source: {m.sourceLabel}.
                  </p>
                  {t.note ? <p>Note: {t.note}</p> : null}
                </Card>
                {d.records.status === 'missing' ? (
                  <Alert tone="warning" title="Actual not available">
                    {d.records.reason} The actual is shown as not available, not as zero.
                  </Alert>
                ) : (
                  <DataTable
                    caption={`Records counted (${d.records.rows.length})`}
                    rows={d.records.rows}
                    rowKey={(r) => r.id}
                    empty={<p>No records count towards this target yet.</p>}
                    columns={[
                      {
                        key: 'title',
                        header: 'Record',
                        render: (r) => (
                          <>
                            {r.href ? <a href={r.href}>{r.title}</a> : r.title}
                            {r.note ? ` (${r.note})` : null}
                            {r.isSample ? (
                              <span className="el-badge el-badge-sample"> Sample data</span>
                            ) : null}
                          </>
                        ),
                      },
                      { key: 'at', header: 'Counted on', render: (r) => formatIst(r.at) },
                    ]}
                  />
                )}
                {can(user, 'marketing:targets:manage') ? (
                  <Card title="Change or remove">
                    <form action={updateTargetAction} className="el-inline-form">
                      {hidden}
                      <Field id="targetValue" label="Target">
                        <TextInput
                          id="targetValue"
                          name="targetValue"
                          type="number"
                          min={1}
                          max={100000}
                          defaultValue={t.targetValue}
                        />
                      </Field>
                      <Field id="periodStart" label="Period starts">
                        <TextInput
                          id="periodStart"
                          name="periodStart"
                          type="date"
                          defaultValue={t.periodStart}
                        />
                      </Field>
                      <Field id="periodEnd" label="Period ends">
                        <TextInput
                          id="periodEnd"
                          name="periodEnd"
                          type="date"
                          defaultValue={t.periodEnd}
                        />
                      </Field>
                      <Field id="note" label="Note">
                        <TextInput
                          id="note"
                          name="note"
                          maxLength={500}
                          defaultValue={t.note ?? ''}
                        />
                      </Field>
                      <Button type="submit" variant="secondary">
                        Save changes
                      </Button>
                    </form>
                    <form action={deleteTargetAction}>
                      {hidden}
                      <Button type="submit" variant="danger">
                        Remove target
                      </Button>
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
