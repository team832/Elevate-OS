import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, ButtonLink, Card, DataTable, PageHeader } from '@elevate/shared-ui';
import { getReview } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { ApiButton, ApiForm } from '../../../ui/api-form';
import { StateBadge, fmtDateTime } from '../../../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';
import { TYPE_LABELS, VISIBILITY_LABELS, reviewFields } from '../review-fields';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Teacher review' };

const SHOWN = [
  ['strengths', 'Strengths seen in class'],
  ['areasForSupport', 'Areas needing support'],
  ['attendanceEvidence', 'Attendance and engagement evidence'],
  ['homeworkEvidence', 'Homework and practice evidence'],
  ['academicConcerns', 'Academic concerns'],
  ['suggestedAction', 'Suggested action'],
] as const;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:reviews:read', MODULE_PATHS.review(id));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="reviews">{null}</AcademicShell>;
  const data = await load(() => getReview(getDb(), actorFor(access.user), id));
  if (!data.ok) return <AcademicShell access={access} active="reviews"><LoadError error={data.error} /></AcademicShell>;
  const r = data.data;
  const canWrite = r.isAuthor && can(access.user, 'academic:reviews:write');
  const isLatest = r.versions.find((v) => v.status !== 'draft')?.id === r.id;
  return (
    <AcademicShell access={access} active="reviews">
      <PageHeader
        title={`${TYPE_LABELS[r.reviewType]} — ${r.studentName}`}
        meta={<><StateBadge state={r.status} /> <span>Version {r.version}</span></>}
        description={`By ${r.authorName}${r.subjectName ? ` · ${r.subjectName}` : ''}${r.sessionDate ? ` · class on ${r.sessionDate}` : ''}${r.periodFrom ? ` · ${r.periodFrom} to ${r.periodTo}` : ''} · ${VISIBILITY_LABELS[r.visibility]}`}
        actions={<ButtonLink href={MODULE_PATHS.reviews}>All reviews</ButtonLink>}
      />
      <div className="el-stack">
        {r.status === 'withdrawn' ? <Alert tone="warning" title="Withdrawn">{`${fmtDateTime(r.withdrawnAt)}: ${r.withdrawnReason}. Business Ops no longer shows it.`}</Alert> : null}
        {canWrite && r.status === 'draft' ? (
          <Card title="Your draft" description="Only you can see this draft.">
            <ApiForm action={MODULE_PATHS.api(`reviews/${r.id}`)} method="PATCH" extra={{ updatedAt: new Date(r.updatedAt).toISOString() }} fields={reviewFields(r)} submitLabel="Submit review" draftLabel="Save draft" successMessage="Submitted." stickyActions idPrefix={`r-${r.id}`} />
          </Card>
        ) : (
          <Card title={r.status === 'draft' ? 'Draft' : `Submitted ${fmtDateTime(r.submittedAt)}`}>
            <dl className="el-stack">
              {SHOWN.map(([k, label]) => (
                <div key={k}>
                  <dt className="el-field-hint">{label}</dt>
                  <dd>{r[k] ?? 'Not written'}</dd>
                </div>
              ))}
              <div>
                <dt className="el-field-hint">Follow up on</dt>
                <dd>{r.followUpOn ?? 'No date set'}</dd>
              </div>
            </dl>
          </Card>
        )}
        {canWrite && r.status === 'submitted' && isLatest ? (
          <Card title="Change this review" description="A submitted review is never edited. A revision becomes the next version; Business Ops then shows the new version and marks this one as superseded.">
            <ApiButton action={MODULE_PATHS.api(`reviews/${r.id}/revise`)} label="Revise as a new version" successMessage="Draft of the next version opened below in Versions." />
            <details>
              <summary>Withdraw this review</summary>
              <ApiForm action={MODULE_PATHS.api(`reviews/${r.id}/withdraw`)} submitLabel="Withdraw review" variant="danger" successMessage="Withdrawn." idPrefix={`w-${r.id}`} fields={[{ name: 'reason', label: 'Why are you withdrawing it?', required: true, type: 'textarea' }]} />
            </details>
          </Card>
        ) : null}
        <Card title="Versions">
          <DataTable compact
            rows={r.versions}
            rowKey={(v) => v.id}
            columns={[
              { key: 'v', header: 'Version', render: (v) => (v.id === r.id ? `${v.version} (this page)` : <a href={MODULE_PATHS.review(v.id)}>{v.version}</a>) },
              { key: 'status', header: 'Status', render: (v) => <StateBadge state={v.status} /> },
              { key: 'submitted', header: 'Submitted', render: (v) => fmtDateTime(v.submittedAt) },
              { key: 'withdrawn', header: 'Withdrawn', render: (v) => (v.withdrawnAt ? `${fmtDateTime(v.withdrawnAt)}: ${v.withdrawnReason}` : '—') },
            ]}
          />
        </Card>
      </div>
    </AcademicShell>
  );
}
