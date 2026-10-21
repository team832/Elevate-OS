/**
 * Search (UX idea 1): the top-bar box finds a person by name or reference, and by phone or email
 * with access to contact details, across leads, demo students, applications and students. Each
 * row opens the record in its own list (`?open=`). Plain GET page: works without JavaScript.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../../domain';
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from '../../domain/applications';
import { globalSearch, SEARCH_LIMIT } from '../../server/search';
import { statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { Badge, SampleBadge } from '../admissions/_components/demo-bits';
import { APP_TONE } from '../admissions/applications/_components/application-detail';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search' };

type Group = Awaited<ReturnType<typeof globalSearch>>['groups'][number];
type Hit = Group['hits'][number];

const caseBadge = (s: string | null) =>
  s ? (
    <StatusBadge tone={statusTone(s)}>{ADMISSION_STATUS_LABELS[s as AdmissionStatus]}</StatusBadge>
  ) : (
    'No case yet'
  );

const GROUPS: Record<
  Group['key'],
  { title: string; status: string; href: (h: Hit) => string; badge: (s: string) => ReactNode }
> = {
  leads: {
    title: 'Leads',
    status: 'Stage',
    href: (h) => `/ops/leads?open=${h.id}`,
    badge: caseBadge,
  },
  demos: {
    title: 'Demo students',
    status: 'Demo outcome',
    href: (h) => `/ops/admissions?open=${h.id}`,
    badge: (s) => <Badge value={s} />,
  },
  applications: {
    title: 'Applications',
    status: 'Status',
    href: (h) => `/ops/admissions/applications?open=${h.id}`,
    badge: (s) => (
      <StatusBadge tone={APP_TONE[s as ApplicationStatus]}>
        {APPLICATION_STATUS_LABELS[s as ApplicationStatus]}
      </StatusBadge>
    ),
  },
  students: {
    title: 'Students',
    status: 'Status',
    href: (h) => `/ops/students${h.past ? '/past' : ''}?open=${h.id}`,
    badge: caseBadge,
  },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const access = await gate('ops:module:access', '/ops/search');
  const q = (await searchParams).q?.trim() ?? '';
  return (
    <Frame access={access} active="search" query={q}>
      <PageHeader
        title={q.length < 2 ? 'Search' : `Results for “${q}”`}
        description="Leads, demo students, applications and students by name or reference; phone or email if you may see contacts."
      />
      {q.length < 2 ? (
        <EmptyState
          title="Type at least 2 characters"
          description="Use the search box at the top of the page (press / to jump to it): a name, a reference, or a phone number if you may see contact details."
        />
      ) : (
        <Section label="Searching…">
          <Results user={access.user} q={q} />
        </Section>
      )}
    </Frame>
  );
}

async function Results({ user, q }: { user: AuthenticatedUser; q: string }) {
  const r = await load((db) => globalSearch(db, user, q));
  if (!r.ok) return r.view;
  const { groups, contactDenied } = r.data;
  if (!groups.length)
    return (
      <EmptyState
        title="Nothing you can search here"
        description="Your roles do not open leads, applications or students."
      />
    );
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  return (
    <div className="el-stack">
      <p role="status" aria-live="polite">
        {total === 1 ? '1 match' : `${total}${groups.some((g) => g.more) ? '+' : ''} matches`}
      </p>
      {contactDenied ? (
        <Alert tone="info">
          Searching by phone number or email needs access to student contact details. These are name
          and reference matches only.
        </Alert>
      ) : null}
      {total === 0 ? (
        <EmptyState
          title={`No matches for “${q}”`}
          description="Try a name, phone number or reference, or fewer letters of the name."
        />
      ) : null}
      {(total ? groups : []).map((g) => {
        const spec = GROUPS[g.key];
        return (
          <Segment key={g.key} title={spec.title} flush>
            <RecordTable
              caption={
                g.more
                  ? `First ${SEARCH_LIMIT} matches. Type more of the name or number to narrow them.`
                  : `${g.hits.length} ${g.hits.length === 1 ? 'match' : 'matches'}`
              }
              rows={g.hits}
              rowKey={(h) => h.id}
              rowHref={spec.href}
              linkColumn="name"
              empty={
                <EmptyState
                  title={`No ${spec.title.toLowerCase()} match “${q}”`}
                  description="Try the phone number or reference, or fewer letters of the name."
                />
              }
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  render: (h) => (
                    <>
                      {h.name} <SampleBadge show={Boolean(h.isSample)} />
                    </>
                  ),
                },
                { key: 'code', header: 'Reference', render: (h) => h.code ?? '—' },
                ...(g.hits.some((h) => h.phone)
                  ? [
                      {
                        key: 'phone',
                        header: 'Phone',
                        render: (h: Hit) => h.phone ?? 'Not recorded',
                      },
                    ]
                  : []),
                {
                  key: 'status',
                  header: spec.status,
                  render: (h) => (h.status ? spec.badge(h.status) : caseBadge(null)),
                },
              ]}
            />
          </Segment>
        );
      })}
    </div>
  );
}
