import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  Field,
  Select,
  StatusBadge,
  TextInput,
} from '@elevate/shared-ui';
import {
  COURSE_PREFIXES,
  IDEA_SCOPE_LABELS,
  IDEA_STATUS_LABELS,
  IDEA_STATUSES,
  isOneOf,
  modulePath,
} from '../../domain';
import { listIdeas, listQuarantine } from '../../server';
import { MarketingPage, Section, param, type SearchParams } from '../../ui/shell';
import { SampleBadge } from '../calendar/item-ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ideas' };

export default async function IdeasPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = param(sp, 'q');
  const course = param(sp, 'course');
  const status = param(sp, 'status');
  return (
    <MarketingPage
      permission="marketing:ideas:read"
      path={modulePath('ideas')}
      active="ideas"
      title="Ideas"
      description="Every idea gets a code (COURSE-NNN) that is never reused. Submit an idea for review; once approved, plan it onto the calendar."
      searchParams={sp}
      actions={
        <ButtonLink variant="primary" href={modulePath('ideas/new')}>
          New idea
        </ButtonLink>
      }
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const ideas = await listIdeas(db, {
              q,
              coursePrefix: isOneOf(COURSE_PREFIXES, course) ? course : undefined,
              status: isOneOf(IDEA_STATUSES, status) ? status : undefined,
            });
            const quarantine = await listQuarantine(db);
            return (
              <div className="el-stack">
                <form method="get" className="el-inline-form">
                  <Field id="q" label="Search title or code">
                    <TextInput id="q" name="q" defaultValue={q} />
                  </Field>
                  <Field id="course" label="Course">
                    <Select id="course" name="course" defaultValue={course ?? ''}>
                      <option value="">All</option>
                      {COURSE_PREFIXES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="status" label="Status">
                    <Select id="status" name="status" defaultValue={status ?? ''}>
                      <option value="">All</option>
                      {IDEA_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div>
                    <Button type="submit" variant="secondary">
                      Filter
                    </Button>
                  </div>
                </form>
                <DataTable
                  compact
                  caption={`${ideas.length} idea(s)`}
                  rows={ideas}
                  rowKey={(i) => i.id}
                  empty={
                    <EmptyState
                      title="No ideas match"
                      description={
                        q || course || status
                          ? 'Clear the filters to see everything.'
                          : 'Capture the first idea.'
                      }
                      action={
                        can(user, 'marketing:ideas:write') ? (
                          <ButtonLink href={modulePath('ideas/new')}>New idea</ButtonLink>
                        ) : undefined
                      }
                    />
                  }
                  columns={[
                    {
                      key: 'code',
                      header: 'Code',
                      render: (i) =>
                        i.code ?? (
                          <StatusBadge tone="warning">{i.legacyCode} quarantined</StatusBadge>
                        ),
                    },
                    {
                      key: 'title',
                      header: 'Title',
                      render: (i) => (
                        <>
                          <a href={modulePath(`ideas/${i.id}`)}>{i.title}</a>{' '}
                          <SampleBadge sample={i.isSample} />
                        </>
                      ),
                    },
                    { key: 'owner', header: 'Owner', render: (i) => i.ownerName ?? 'No owner yet' },
                    { key: 'pillar', header: 'Pillar', render: (i) => i.pillar ?? '—' },
                    {
                      key: 'scope',
                      header: 'Scope',
                      render: (i) =>
                        `${IDEA_SCOPE_LABELS[i.scope]}${i.scopePrefixes.length ? ` (${i.scopePrefixes.join(', ')})` : ''}`,
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (i) => (
                        <>
                          {IDEA_STATUS_LABELS[i.status]}
                          {i.legacyStatus && i.legacyStatus !== i.status ? (
                            <span className="el-field-hint"> (legacy: {i.legacyStatus})</span>
                          ) : null}
                        </>
                      ),
                    },
                    { key: 'source', header: 'Source', render: (i) => i.origin ?? '—' },
                  ]}
                />
                <Card
                  title={`Quarantine — duplicate legacy IDs (${quarantine.length} groups)`}
                  description="Each legacy ID below was used for two different ideas. Neither row has a live code; the proposed renumbering is shown but NOT applied (OD-003)."
                >
                  {quarantine.length === 0 ? (
                    <EmptyState title="No quarantined ideas" />
                  ) : (
                    <ul>
                      {quarantine.map((g) => (
                        <li key={g.legacyCode}>
                          <strong>{g.legacyCode}</strong>:{' '}
                          {g.ideas.map((i) => (
                            <span key={i.id}>
                              <a href={modulePath(`ideas/${i.id}`)}>“{i.title}”</a>
                              {i.proposedCode
                                ? ` to proposed ${i.proposedCode} (${i.proposedCodeStatus})`
                                : ' (would keep the ID?)'}
                              ;{' '}
                            </span>
                          ))}
                          {g.ambiguousPlacements.length ? (
                            <span className="el-field-hint">
                              Ambiguous placements:{' '}
                              {g.ambiguousPlacements.map((p) => p.placement.legacyCode).join(', ')}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
