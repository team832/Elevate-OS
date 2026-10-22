import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { ButtonLink, Card, DataTable, EmptyState, PageHeader, Subnav } from '@elevate/shared-ui';
import { listReviews } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { reviewsQuery } from '../../server/schemas-teaching';
import { StateBadge, fmtDateTime } from '../../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';
import { TYPE_LABELS } from './review-fields';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Teacher reviews' };

type Params = Record<string, string | string[] | undefined>;
const TABS = [
  ['', 'All you can see'],
  ['?mine=1', 'Written by you'],
  ['?status=submitted', 'Submitted'],
  ['?mine=1&status=draft', 'Your drafts'],
] as const;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('academic:reviews:read', MODULE_PATHS.reviews);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="teaching">{null}</AcademicShell>;
  const p = await searchParams;
  const given = Object.entries(p).filter((e): e is [string, string] => typeof e[1] === 'string');
  const parsed = reviewsQuery.safeParse(Object.fromEntries(given));
  const query = parsed.success ? parsed.data : {};
  const data = await load(() => listReviews(getDb(), actorFor(access.user), query));
  if (!data.ok) return <AcademicShell access={access} active="teaching"><LoadError error={data.error} /></AcademicShell>;
  const qs = new URLSearchParams(given).toString();
  const current = `${MODULE_PATHS.reviews}${qs ? `?${qs}` : ''}`;
  const pendingStudent = query.academicStudentId && !data.data.some((r) => r.status === 'submitted');
  return (
    <AcademicShell access={access} active="teaching">
      <PageHeader
        title="Teacher reviews"
        description="Structured feedback on students from their teachers. Submitted reviews are shared with coordinators and authorised Business Ops staff; drafts stay with their author."
        actions={can(access.user, 'academic:reviews:write') ? <ButtonLink href={MODULE_PATHS.newReview} variant="primary">Write a review</ButtonLink> : null}
        tabs={<Subnav label="Review lists" items={TABS.map(([q, text]) => [`${MODULE_PATHS.reviews}${q}`, text] as const)} current={current} />}
      />
      <Card>
        {pendingStudent ? <p>No submitted review for this student yet: pending, not a negative signal.</p> : null}
        <DataTable compact
          rows={data.data}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No reviews here" description="Write a review from a class roster or with “Write a review”. Reviews of students outside your current classes are not listed." />}
          columns={[
            { key: 'student', header: 'Student', render: (r) => <a href={MODULE_PATHS.review(r.id)}>{r.studentName}</a> },
            { key: 'type', header: 'Type', render: (r) => TYPE_LABELS[r.reviewType] },
            { key: 'author', header: 'Teacher', render: (r) => r.authorName },
            { key: 'status', header: 'Status', render: (r) => <><StateBadge state={r.status} /> v{r.version}</> },
            { key: 'when', header: 'Submitted', render: (r) => fmtDateTime(r.submittedAt) },
            { key: 'follow', header: 'Follow up on', render: (r) => r.followUpOn ?? '—' },
          ]}
        />
      </Card>
    </AcademicShell>
  );
}
