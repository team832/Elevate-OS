import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
} from '@elevate/shared-ui';
import { CONTENT_FORMATS, IDEA_STATUSES, formatIst, modulePath } from '../../../domain';
import { getIdeaDetail } from '../../../server';
import { changeIdeaStatusAction, createContentItemAction } from '../../actions/ideas';
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
      active="calendar"
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
            const d = await getIdeaDetail(getDb(), id);
            const { idea } = d;
            const write = can(user, 'marketing:ideas:write');
            const contentWrite = can(user, 'marketing:content:write');
            return (
              <div className="el-stack">
                <Card title={`${idea.code ?? `${idea.legacyCode} (quarantined)`} — ${idea.title}`}>
                  {idea.quarantineState === 'quarantined' ? (
                    <Alert tone="warning" title="Quarantined (OD-003)">
                      {idea.quarantineReason}{' '}
                      {idea.proposedCode
                        ? `Proposed code: ${idea.proposedCode} (${idea.proposedCodeStatus}, not applied).`
                        : ''}
                    </Alert>
                  ) : null}
                  <dl>
                    <dt>Course</dt>
                    <dd>{idea.coursePrefix}</dd>
                    <dt>Status</dt>
                    <dd>
                      {idea.status.replace('_', ' ')}
                      {idea.statusReason ? ` — ${idea.statusReason}` : ''}
                      {idea.legacyStatus ? ` (legacy: ${idea.legacyStatus})` : ''}
                    </dd>
                    <dt>Scope</dt>
                    <dd>
                      {idea.scope.replace('_', ' ')} {idea.scopePrefixes.join(', ')}
                    </dd>
                    <dt>Pillar / series</dt>
                    <dd>
                      {idea.pillar ?? '—'} / {idea.series ?? '—'}
                    </dd>
                    <dt>Objective</dt>
                    <dd>{idea.objective ?? '—'}</dd>
                    <dt>Audience</dt>
                    <dd>{idea.audience ?? '—'}</dd>
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
                    empty={<EmptyState title="No content items yet" />}
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
                    empty={<EmptyState title="Not placed on any account yet" />}
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
                              {s.replace('_', ' ')}
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
