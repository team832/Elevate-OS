import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
} from '@elevate/shared-ui';
import {
  CONTENT_FORMATS,
  formatIst,
  IDEA_SCOPE_LABELS,
  IDEA_STATUS_LABELS,
  IDEA_STATUSES,
  modulePath,
} from '../../../domain';
import { contentFilter, getIdeaDetail, myStaffId } from '../../../server';
import {
  CALENDAR_ITEM_TYPES,
  CHANNEL_LABELS,
  EFFORT_LABELS,
  ITEM_TYPE_LABELS,
} from '../../../domain/calendar';
import { calendarOptions, listCalendarItems } from '../../../server/calendar';
import { changeIdeaStatusAction, createContentItemAction } from '../../actions/ideas';
import { CalendarStatusBadge, Choice, SampleBadge } from '../../calendar/item-ui';
import { planIdeaAction, updateIdeaAction } from '../actions';
import { IdeaBoardFields } from '../idea-fields';
import { IdeaReview } from '../idea-review';
import { ContentStateBadge, PlacementBadge } from '../../../ui/badges';
import { MarketingPage, Section, type SearchParams } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Idea' };

export default async function IdeaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  return (
    <MarketingPage
      permission="marketing:ideas:read"
      path={modulePath(`ideas/${id}`)}
      active="ideas"
      title="Idea"
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            if (!/^[0-9a-f-]{36}$/i.test(id))
              return (
                <ErrorState
                  title="Idea not found"
                  description="That address is not a valid idea."
                />
              );
            const db = getDb();
            const d = await getIdeaDetail(db, id, await contentFilter(db, user));
            const { idea } = d;
            const write = can(user, 'marketing:ideas:write');
            const contentWrite = can(user, 'marketing:content:write');
            const options = await calendarOptions(db);
            const [onCalendar] = await listCalendarItems(db, { ideaId: idea.id });
            const mine =
              idea.createdBy === user.id ||
              (idea.ownerStaffId !== null && idea.ownerStaffId === (await myStaffId(db, user.id)));
            const nameOf = (
              list: { id: string; name: string }[],
              id: string | null,
              none: string,
            ) => (id ? (list.find((x) => x.id === id)?.name ?? 'Not in the current list') : none);
            const hidden = <input type="hidden" name="ideaId" value={idea.id} />;
            return (
              <div className="el-stack">
                <Card
                  title={`${idea.code ?? `${idea.legacyCode} (quarantined)`} — ${idea.title}`}
                  meta={<SampleBadge sample={idea.isSample} />}
                >
                  {idea.quarantineState === 'quarantined' ? (
                    <Alert tone="warning" title="Quarantined (OD-003)">
                      {idea.quarantineReason}{' '}
                      {idea.proposedCode
                        ? `Proposed code: ${idea.proposedCode} (${idea.proposedCodeStatus}, not applied).`
                        : ''}
                    </Alert>
                  ) : null}
                  <dl className="mkt-facts">
                    <dt>Course</dt>
                    <dd>{idea.coursePrefix}</dd>
                    <dt>Status</dt>
                    <dd>
                      {IDEA_STATUS_LABELS[idea.status]}
                      {idea.statusReason ? ` — ${idea.statusReason}` : ''}
                      {idea.legacyStatus ? ` (legacy: ${idea.legacyStatus})` : ''}
                    </dd>
                    <dt>Scope</dt>
                    <dd>
                      {IDEA_SCOPE_LABELS[idea.scope]} {idea.scopePrefixes.join(', ')}
                    </dd>
                    <dt>Pillar / series</dt>
                    <dd>
                      {idea.pillar ?? '—'} / {idea.series ?? '—'}
                    </dd>
                    <dt>Objective</dt>
                    <dd>{idea.objective ?? '—'}</dd>
                    <dt>Problem or audience need</dt>
                    <dd>{idea.problemNeed ?? '—'}</dd>
                    <dt>Target audience</dt>
                    <dd>{idea.audience ?? '—'}</dd>
                    <dt>Relevant course</dt>
                    <dd>{nameOf(options.courses, idea.programmeId, 'Not tied to one course')}</dd>
                    <dt>Proposed format and channel</dt>
                    <dd>
                      {idea.proposedFormat
                        ? ITEM_TYPE_LABELS[idea.proposedFormat]
                        : 'Format not decided'}{' '}
                      ·{' '}
                      {idea.proposedChannel
                        ? CHANNEL_LABELS[idea.proposedChannel]
                        : 'channel not decided'}
                    </dd>
                    <dt>Hypothesis</dt>
                    <dd>{idea.hypothesis ?? '—'}</dd>
                    <dt>Effort estimate</dt>
                    <dd>{idea.effort ? EFFORT_LABELS[idea.effort] : 'Not estimated'}</dd>
                    <dt>Expected outcome</dt>
                    <dd>{idea.expectedOutcome ?? '—'}</dd>
                    <dt>Owner</dt>
                    <dd>{nameOf(options.owners, idea.ownerStaffId, 'No owner yet')}</dd>
                    <dt>Related campaign</dt>
                    <dd>
                      {nameOf(
                        options.campaigns.map((c) => ({ id: c.id, name: `${c.code} · ${c.name}` })),
                        idea.campaignId,
                        'No campaign',
                      )}
                    </dd>
                    <dt>Brief</dt>
                    <dd>{idea.brief ?? '—'}</dd>
                    <dt>Source</dt>
                    <dd>{idea.origin ?? '—'}</dd>
                    <dt>Notes</dt>
                    <dd>{idea.notes ?? '—'}</dd>
                    <dt>Created</dt>
                    <dd>
                      {formatIst(idea.createdAt)}
                      {idea.legacyRef ? ` (imported from ${idea.legacyRef})` : ''}
                    </dd>
                  </dl>
                </Card>

                <IdeaReview
                  status={idea.status}
                  hidden={hidden}
                  canSubmit={write}
                  reviewer={can(user, 'marketing:content:approve') && !mine}
                  mine={mine}
                />

                {idea.status === 'approved' || onCalendar ? (
                  <Card
                    title="On the calendar"
                    description="Planning links one calendar item to this idea. The idea's history stays here; it is not copied."
                  >
                    {onCalendar ? (
                      <p>
                        <a href={modulePath(`calendar/${onCalendar.id}`)}>{onCalendar.title}</a>{' '}
                        <CalendarStatusBadge status={onCalendar.status} />{' '}
                        {formatIst(onCalendar.plannedAt)}
                      </p>
                    ) : can(user, 'marketing:calendar:write') ? (
                      <form action={planIdeaAction} className="el-stack">
                        {hidden}
                        <Field id="plannedAt" label="Planned date and time (IST, optional)">
                          <TextInput id="plannedAt" name="plannedAt" type="datetime-local" />
                        </Field>
                        {idea.proposedFormat ? null : (
                          <Choice
                            id="itemType"
                            label="Calendar item type"
                            value={null}
                            options={CALENDAR_ITEM_TYPES.map((t) => [t, ITEM_TYPE_LABELS[t]])}
                          />
                        )}
                        {can(user, 'ops:tasks:write') ? (
                          <Checkbox
                            name="createTask"
                            label="Also create a task for the owner in My Tasks"
                          />
                        ) : null}
                        <div>
                          <Button type="submit">Plan it</Button>
                        </div>
                      </form>
                    ) : (
                      <p>Not planned yet. A marketing manager or the idea's owner can plan it.</p>
                    )}
                  </Card>
                ) : null}

                {write && idea.status !== 'archived' ? (
                  <details className="el-explain">
                    <summary>Edit idea details</summary>
                    <form action={updateIdeaAction} className="el-stack">
                      {hidden}
                      <Field id="title" label="Title">
                        <TextInput
                          id="title"
                          name="title"
                          required
                          minLength={3}
                          maxLength={300}
                          defaultValue={idea.title}
                        />
                      </Field>
                      <IdeaBoardFields options={options} idea={idea} />
                      <Field id="brief" label="Brief">
                        <TextArea
                          id="brief"
                          name="brief"
                          rows={4}
                          maxLength={5000}
                          defaultValue={idea.brief ?? ''}
                        />
                      </Field>
                      <div>
                        <Button type="submit">Save idea</Button>
                      </div>
                    </form>
                  </details>
                ) : null}

                <Card
                  title="Possible duplicates"
                  description="Deterministic title-similarity check (normalised words, same-course aware). Warnings do not block."
                >
                  {d.duplicates.candidates.length === 0 ? (
                    <p>No similar ideas found.</p>
                  ) : (
                    <ul>
                      {d.duplicates.candidates.map((c) => (
                        <li key={c.id}>
                          <StatusBadge tone={c.kind.startsWith('exact') ? 'danger' : 'warning'}>
                            {c.kind.replaceAll('_', ' ')}
                          </StatusBadge>{' '}
                          <a href={modulePath(`ideas/${c.id}`)}>
                            {c.code ?? 'uncoded'} — {c.title}
                          </a>{' '}
                          <span className="el-field-hint">{c.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title={`Content items (${d.contentItems.length})`}>
                  <DataTable
                    compact
                    rows={d.contentItems}
                    rowKey={(i) => i.id}
                    empty={
                      <EmptyState
                        title="No content items yet"
                        description="Draft the copy as a content item: give it a title and a format below."
                      />
                    }
                    columns={[
                      {
                        key: 'title',
                        header: 'Title',
                        render: (i) => <a href={modulePath(`content/${i.id}`)}>{i.title}</a>,
                      },
                      {
                        key: 'format',
                        header: 'Format',
                        render: (i) => i.format.replace('_', ' '),
                      },
                      {
                        key: 'state',
                        header: 'State',
                        render: (i) => (
                          <>
                            <ContentStateBadge state={i.state} />
                            {i.holdReason ? <span className="el-field-hint"> on hold</span> : null}
                          </>
                        ),
                      },
                    ]}
                  />
                  {contentWrite &&
                  idea.code &&
                  idea.status !== 'archived' &&
                  idea.status !== 'rejected' ? (
                    <form action={createContentItemAction} className="el-stack">
                      <input type="hidden" name="ideaId" value={idea.id} />
                      <Field id="ci-title" label="New content item title">
                        <TextInput id="ci-title" name="title" required />
                      </Field>
                      <Field id="ci-format" label="Format">
                        <Select id="ci-format" name="format">
                          {CONTENT_FORMATS.map((f) => (
                            <option key={f} value={f}>
                              {f.replace('_', ' ')}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field id="ci-body" label="First version (optional)">
                        <TextArea id="ci-body" name="body" rows={4} />
                      </Field>
                      <div>
                        <Button type="submit">Create content item</Button>
                      </div>
                    </form>
                  ) : null}
                </Card>

                <Card title={`Placements (${d.placements.length})`}>
                  <DataTable
                    compact
                    rows={d.placements}
                    rowKey={(p) => p.id}
                    empty={
                      <EmptyState
                        title="Not placed on any account yet"
                        description="Open a content item of this idea and plan a placement on an account."
                      />
                    }
                    columns={[
                      {
                        key: 'code',
                        header: 'Code',
                        render: (p) =>
                          p.code ?? (
                            <StatusBadge tone="warning">{p.legacyCode} (ambiguous)</StatusBadge>
                          ),
                      },
                      { key: 'account', header: 'Account', render: (p) => p.accountCode },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (p) => (
                          <PlacementBadge status={p.status} mode={p.publicationMode} />
                        ),
                      },
                      {
                        key: 'when',
                        header: 'Time (IST)',
                        render: (p) =>
                          formatIst(p.scheduledAt ?? p.publishedAt ?? p.originalPublishAt),
                      },
                      {
                        key: 'legacy',
                        header: 'Legacy',
                        render: (p) =>
                          p.legacyStatus
                            ? `${p.legacyStatus}${p.legacyNotes ? ` — ${p.legacyNotes}` : ''}`
                            : '—',
                      },
                    ]}
                  />
                </Card>

                {write && idea.status !== 'archived' ? (
                  <Card title="Change status">
                    <form action={changeIdeaStatusAction} className="el-grid">
                      <input type="hidden" name="ideaId" value={idea.id} />
                      <Field id="st" label="New status">
                        <Select id="st" name="status">
                          {IDEA_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {IDEA_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field id="reason" label="Reason (needed for held / rejected)">
                        <TextInput id="reason" name="reason" />
                      </Field>
                      <div>
                        <Button type="submit" variant="secondary">
                          Change status
                        </Button>
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
