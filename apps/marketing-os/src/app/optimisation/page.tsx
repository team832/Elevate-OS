import { Fragment } from 'react';
import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { MARKETING_REVIEW_STATES, getDb } from '@elevate/database';
import {
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
} from '@elevate/shared-ui';
import { modulePath } from '../../domain';
import { formatDay } from '../../domain/metrics';
import { NO_GUARANTEE, OPTIMISATION_CHECKS } from '../../domain/optimisation';
import { memberOptions } from '../../server/campaign-members';
import { listOptimisationCategories, listOptimisationItems } from '../../server/optimisation';
import { MarketingPage, Section, param, type SearchParams } from '../../ui/shell';
import { createOptimisationAction } from './actions';
import { ReviewStateBadge } from './badges';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'SEO / AIO / GEO' };

/** SEO / AIO / GEO workspace (brief 23 Oct 2026 §14): concrete page work with evidence, never ranking claims. */
export default async function OptimisationPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const category = param(sp, 'category');
  const stateParam = param(sp, 'state');
  const state = MARKETING_REVIEW_STATES.find((s) => s === stateParam);
  return (
    <MarketingPage
      permission="marketing:optimisation:read"
      path={modulePath('optimisation')}
      active="optimisation"
      title="SEO / AIO / GEO"
      description="Page-by-page optimisation work, the evidence that it was done, and what searches showed on the day someone checked."
      searchParams={sp}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const [categories, rows] = [
              await listOptimisationCategories(db),
              await listOptimisationItems(db, { category, state }),
            ];
            const manager = can(user, 'marketing:optimisation:review');
            const people = manager ? await memberOptions(db) : [];
            return (
              <div className="el-stack">
                <Card title="What these mean here">
                  {categories.length ? (
                    <dl className="mkt-facts">
                      {categories.map((c) => (
                        <Fragment key={c.key}>
                          <dt>{c.label}</dt>
                          <dd>{c.meaning}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  ) : (
                    <EmptyState
                      title="No categories configured"
                      description="SEO, AIO and GEO are added with their meanings by the reference data set-up. Until then no work item can be filed."
                    />
                  )}
                  <p>{NO_GUARANTEE}</p>
                </Card>
                <Card
                  title="External analytics"
                  meta={<StatusBadge tone="neutral">Not connected</StatusBadge>}
                >
                  <p>
                    No search console, web analytics or AI-visibility tool is connected. Every
                    observation on this page was typed in by a person and is labelled Manual.
                  </p>
                </Card>
                <form method="get" className="el-inline-form" aria-label="Filter work items">
                  <Field id="category" label="Category">
                    <Select id="category" name="category" defaultValue={category ?? ''}>
                      <option value="">All categories</option>
                      {categories.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="state" label="Review state">
                    <Select id="state" name="state" defaultValue={state ?? ''}>
                      <option value="">All states</option>
                      {MARKETING_REVIEW_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button type="submit" variant="secondary">
                    Show
                  </Button>
                </form>
                <DataTable
                  caption={`Work items (${rows.length})`}
                  rows={rows}
                  rowKey={(r) => r.id}
                  empty={
                    <EmptyState
                      title="No work items"
                      description={
                        category || state
                          ? 'Nothing matches these filters.'
                          : 'Add the first page you are improving below.'
                      }
                    />
                  }
                  columns={[
                    {
                      key: 'topic',
                      header: 'Topic',
                      render: (r) => (
                        <>
                          <a href={modulePath(`optimisation/${r.id}`)}>{r.topic}</a>
                          {r.isSample ? (
                            <span className="el-badge el-badge-sample"> Sample data</span>
                          ) : null}
                        </>
                      ),
                    },
                    { key: 'categoryLabel', header: 'Category' },
                    { key: 'ownerName', header: 'Owner', render: (r) => r.ownerName ?? 'No owner' },
                    { key: 'dueOn', header: 'Due', render: (r) => formatDay(r.dueOn) },
                    {
                      key: 'checklist',
                      header: 'Checklist',
                      render: (r) =>
                        r.checklist.length
                          ? `${r.checklist.filter((c) => c.done).length} of ${r.checklist.length} done`
                          : 'No checks chosen',
                    },
                    {
                      key: 'reviewState',
                      header: 'Review',
                      render: (r) => <ReviewStateBadge state={r.reviewState} />,
                    },
                  ]}
                />
                {can(user, 'marketing:optimisation:write') && categories.length ? (
                  <Card title="New work item">
                    <form action={createOptimisationAction} className="el-grid">
                      <Field id="pageUrl" label="Website or page URL">
                        <TextInput
                          id="pageUrl"
                          name="pageUrl"
                          type="url"
                          required
                          placeholder="https://"
                        />
                      </Field>
                      <Field id="topic" label="Topic">
                        <TextInput id="topic" name="topic" required maxLength={200} />
                      </Field>
                      <Field id="targetQuery" label="Target query or audience question">
                        <TextInput id="targetQuery" name="targetQuery" maxLength={300} />
                      </Field>
                      <Field id="categoryKey" label="Category">
                        <Select id="categoryKey" name="categoryKey" required>
                          {categories.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {manager ? (
                        <Field id="ownerStaffId" label="Owner">
                          <Select id="ownerStaffId" name="ownerStaffId" defaultValue="">
                            <option value="">Me</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      ) : null}
                      <Field id="dueOn" label="Due date">
                        <TextInput id="dueOn" name="dueOn" type="date" />
                      </Field>
                      <Field id="baselineObservation" label="Baseline observation">
                        <TextArea
                          id="baselineObservation"
                          name="baselineObservation"
                          maxLength={2000}
                        />
                      </Field>
                      <Field id="requiredChange" label="Required change">
                        <TextArea id="requiredChange" name="requiredChange" maxLength={2000} />
                      </Field>
                      <Field
                        id="measurementSource"
                        label="Measurement source"
                        hint="Where the result will be checked, e.g. a manual Google search."
                      >
                        <TextInput
                          id="measurementSource"
                          name="measurementSource"
                          maxLength={300}
                        />
                      </Field>
                      <fieldset className="el-fieldset">
                        <legend>Checks that apply</legend>
                        {OPTIMISATION_CHECKS.map((c) => (
                          <Checkbox key={c.key} name="checks" value={c.key} label={c.label} />
                        ))}
                      </fieldset>
                      <div>
                        <Button type="submit">Add work item</Button>
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
