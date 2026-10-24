import type { Metadata } from 'next';
import { z } from 'zod';
import { can, scopeFor } from '@elevate/authorization';
import { getDb } from '@elevate/database';
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
import { toIsoDate } from '@elevate/shared-types';
import { modulePath } from '../../../domain';
import { formatDay } from '../../../domain/metrics';
import {
  NO_GUARANTEE,
  ONE_OBSERVATION,
  OPTIMISATION_CHECKS,
  isEditable,
} from '../../../domain/optimisation';
import { getOptimisationItem, isMine, wroteEvidence } from '../../../server/optimisation';
import { MarketingPage, Section, type SearchParams } from '../../../ui/shell';
import {
  addObservationAction,
  reviewOptimisationAction,
  submitOptimisationAction,
  updateOptimisationAction,
} from '../actions';
import { ReviewStateBadge } from '../badges';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'SEO / AIO / GEO work item' };

/** One work item: facts, checklist and evidence, review, and the manual observation log. */
export default async function OptimisationItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  return (
    <MarketingPage
      permission="marketing:optimisation:read"
      path={modulePath(`optimisation/${id}`)}
      active="optimisation"
      title="SEO / AIO / GEO work item"
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            if (!z.uuid().safeParse(id).success)
              return <EmptyState title="Item not found" description="Check the link." />;
            const db = getDb();
            const item = await getOptimisationItem(db, id);
            const mine = await isMine(db, user, item);
            const canEdit =
              isEditable(item.reviewState) &&
              can(user, 'marketing:optimisation:write') &&
              (mine || scopeFor(user, 'marketing:optimisation:write') === 'all');
            const canReview =
              item.reviewState === 'submitted' &&
              can(user, 'marketing:optimisation:review') &&
              !mine &&
              !(await wroteEvidence(db, user, item.id));
            const applies = new Set(item.checklist.map((c) => c.key));
            const hidden = <input type="hidden" name="id" value={item.id} />;
            return (
              <div className="el-stack">
                <Card
                  title={item.topic}
                  meta={
                    <>
                      <ReviewStateBadge state={item.reviewState} />
                      {item.isSample ? (
                        <span className="el-badge el-badge-sample">Sample data</span>
                      ) : null}
                    </>
                  }
                >
                  <dl className="mkt-facts">
                    <dt>Page</dt>
                    <dd>
                      <a href={item.pageUrl} rel="noreferrer noopener" target="_blank">
                        {item.pageUrl}
                      </a>
                    </dd>
                    <dt>Category</dt>
                    <dd>{item.categoryLabel}</dd>
                    <dt>Target query</dt>
                    <dd>{item.targetQuery ?? 'Not recorded'}</dd>
                    <dt>Owner</dt>
                    <dd>{item.ownerName ?? 'No owner'}</dd>
                    <dt>Due</dt>
                    <dd>{formatDay(item.dueOn)}</dd>
                    <dt>Baseline observation</dt>
                    <dd>{item.baselineObservation ?? 'Not recorded'}</dd>
                    <dt>Required change</dt>
                    <dd>{item.requiredChange ?? 'Not recorded'}</dd>
                    <dt>Measurement source</dt>
                    <dd>{item.measurementSource ?? 'Not recorded'}</dd>
                    <dt>Observation date</dt>
                    <dd>{formatDay(item.observationOn)}</dd>
                    <dt>Evidence</dt>
                    <dd className="mkt-copy">{item.evidence ?? 'Not added yet'}</dd>
                    {item.reviewNote ? (
                      <>
                        <dt>Reviewer note</dt>
                        <dd>{item.reviewNote}</dd>
                      </>
                    ) : null}
                  </dl>
                </Card>
                <Card title="Checklist" description={NO_GUARANTEE}>
                  {canEdit ? (
                    <form action={updateOptimisationAction} className="el-grid">
                      {hidden}
                      <fieldset className="el-fieldset">
                        <legend>Checks that apply, and which are done</legend>
                        {OPTIMISATION_CHECKS.map((c) => (
                          <div key={c.key} className="el-inline-form">
                            <Checkbox
                              name="checks"
                              value={c.key}
                              label={c.label}
                              defaultChecked={applies.has(c.key)}
                            />
                            {applies.has(c.key) ? (
                              <Checkbox
                                name="done"
                                value={c.key}
                                label="Done"
                                aria-label={`${c.label}: done`}
                                defaultChecked={item.checklist.find((x) => x.key === c.key)?.done}
                              />
                            ) : null}
                          </div>
                        ))}
                      </fieldset>
                      <Field
                        id="evidence"
                        label="Evidence"
                        hint="A link, a screenshot reference or a short note that shows the change is live."
                      >
                        <TextArea
                          id="evidence"
                          name="evidence"
                          defaultValue={item.evidence ?? ''}
                          maxLength={4000}
                        />
                      </Field>
                      <Field id="requiredChange" label="Required change">
                        <TextArea
                          id="requiredChange"
                          name="requiredChange"
                          defaultValue={item.requiredChange ?? ''}
                          maxLength={2000}
                        />
                      </Field>
                      <Field id="dueOn" label="Due date">
                        <TextInput
                          id="dueOn"
                          name="dueOn"
                          type="date"
                          defaultValue={item.dueOn ?? ''}
                        />
                      </Field>
                      <Field id="observationOn" label="Observation date">
                        <TextInput
                          id="observationOn"
                          name="observationOn"
                          type="date"
                          defaultValue={item.observationOn ?? ''}
                        />
                      </Field>
                      <div className="el-inline-form">
                        <Button type="submit" variant="secondary">
                          Save checklist and evidence
                        </Button>
                      </div>
                    </form>
                  ) : item.checklist.length ? (
                    <ul>
                      {item.checklist.map((c) => (
                        <li key={c.key}>
                          {c.label}: {c.done ? 'done' : 'not done'}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No checks chosen.</p>
                  )}
                  {canEdit ? (
                    <form action={submitOptimisationAction}>
                      {hidden}
                      <Button type="submit">Submit for review</Button>
                    </form>
                  ) : null}
                </Card>
                {canReview ? (
                  <Card title="Review">
                    <form action={reviewOptimisationAction} className="el-grid">
                      {hidden}
                      <Field id="decision" label="Decision">
                        <Select id="decision" name="decision">
                          <option value="approved">Approve</option>
                          <option value="changes_requested">Ask for changes</option>
                        </Select>
                      </Field>
                      <Field id="note" label="Note" hint="Required when asking for changes.">
                        <TextArea id="note" name="note" maxLength={2000} />
                      </Field>
                      <div>
                        <Button type="submit">Save review</Button>
                      </div>
                    </form>
                  </Card>
                ) : null}
                <Card title="Observations" description={ONE_OBSERVATION}>
                  <DataTable
                    caption={`Observation log (${item.observations.length})`}
                    rows={item.observations}
                    rowKey={(o) => o.id}
                    empty={
                      <p>
                        No observations yet. Record what a search or AI answer showed when you check
                        it.
                      </p>
                    }
                    columns={[
                      { key: 'observedOn', header: 'Date', render: (o) => formatDay(o.observedOn) },
                      { key: 'platform', header: 'Platform' },
                      { key: 'query', header: 'Query' },
                      { key: 'result', header: 'Observed result' },
                      {
                        key: 'source',
                        header: 'Source',
                        render: (o) => (
                          <StatusBadge tone="neutral">
                            {o.source === 'manual' ? 'Manual' : 'Connected'}
                          </StatusBadge>
                        ),
                      },
                      { key: 'recordedByName', header: 'Recorded by' },
                    ]}
                  />
                  {can(user, 'marketing:optimisation:write') &&
                  (mine || scopeFor(user, 'marketing:optimisation:write') === 'all') ? (
                    <form action={addObservationAction} className="el-grid">
                      {hidden}
                      <Field
                        id="platform"
                        label="Platform"
                        hint="e.g. Google, ChatGPT, Perplexity."
                      >
                        <TextInput id="platform" name="platform" required maxLength={80} />
                      </Field>
                      <Field id="query" label="Query">
                        <TextInput
                          id="query"
                          name="query"
                          required
                          maxLength={300}
                          defaultValue={item.targetQuery ?? ''}
                        />
                      </Field>
                      <Field id="observedOn" label="Date">
                        <TextInput
                          id="observedOn"
                          name="observedOn"
                          type="date"
                          required
                          max={toIsoDate()}
                        />
                      </Field>
                      <Field id="result" label="What you saw">
                        <TextArea id="result" name="result" required maxLength={2000} />
                      </Field>
                      <div>
                        <Button type="submit" variant="secondary">
                          Log manual observation
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </Card>
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
