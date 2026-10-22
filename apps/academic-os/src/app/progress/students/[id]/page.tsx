import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, ButtonLink, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import type { PageAccess } from '@elevate/server-kit/next';
import { getStudentProgress, listStaff } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { ApiForm } from '../../../../ui/api-form';
import { StateBadge } from '../../../../ui/badges';
import { InterventionsTable, PLAN_FIELDS } from '../../../../ui/interventions';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Student progress' };

const TRIGGERS = ['repeated_absence', 'declining_scores', 'low_scores', 'missed_assessments', 'overdue_catch_up', 'other'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
const pct = (total: string | null, max: string) => (total === null || Number(max) <= 0 ? null : Math.round((Number(total) / Number(max)) * 1000) / 10);

export default async function StudentProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:progress:read', MODULE_PATHS.studentProgress(id));
  return (
    <AcademicShell access={access} active="progress" loading="Loading progress…">
      {access.status === 'allowed' ? <Body access={access} id={id} /> : null}
    </AcademicShell>
  );
}

async function Body({ access, id }: { access: PageAccess; id: string }) {
  const db = getDb();
  const canWrite = can(access.user, 'academic:progress:write');
  const data = await load(async () => ({ p: await getStudentProgress(db, actorFor(access.user), id), staff: canWrite ? await listStaff(db) : [] }));
  if (!data.ok) return <LoadError error={data.error} />;
  const { p, staff } = data.data;
  return (
    <>
      <PageHeader
        title={p.student.fullName}
        meta={<span className="el-field-hint">{p.student.code}</span>}
        description={`Four separate views of progress as of ${p.asOf}. There is no combined score; each figure says how it is counted.`}
        actions={<ButtonLink href={MODULE_PATHS.student(p.student.id)}>Student record</ButtonLink>}
      />
      <div className="el-stack">
        <Card title="Support signals" description="Facts that may call for support. No thresholds are applied: staff decide whether to act.">
          {p.signals.length === 0 ? (
            <p>Nothing notable: no recent absence streak, no overdue catch-up, no declining comparable scores.</p>
          ) : (
            <ul>
              {p.signals.map((s) => (
                <li key={s.kind}>{s.text}</li>
              ))}
            </ul>
          )}
        </Card>
        {p.attendanceNotRecorded.map((x) => (
          <Alert key={x.enrolmentId} tone="info" title="Attendance not recorded">
            {x.reason}. These classes are left out, not counted as 0.
          </Alert>
        ))}
        {p.batches.length === 0 ? <EmptyState title="No active batch" description="Progress appears once the student is placed in a batch you can see." /> : null}
        {p.batches.map((b) => (
          <section key={`${b.enrolmentId}-${b.batchId}`} className="el-stack" aria-label={`Batch ${b.batchCode ?? ''}`}>
            <h2>Batch {b.batchCode ?? 'not recorded'}</h2>
            <Card title="1. Attendance" description={`${p.attendanceRule.definition}${p.attendanceRule.status === 'approved' ? '' : ' (Rule proposed, not approved by the owner.)'}`}>
              <p>
                {b.attendance.ratePercent === null ? 'No countable attendance recorded yet.' : `${b.attendance.ratePercent}%`} · {b.attendance.heldSessions} delivered in placement (
                {b.placements.map((w) => `${w.startDate} to ${w.endDate ?? 'now'}`).join(', ')}) · present {b.attendance.present}, late {b.attendance.late}, partial {b.attendance.partial}, absent {b.attendance.absent}, excused {b.attendance.excused} ·{' '}
                <strong>not recorded {b.attendance.notRecorded}</strong>
              </p>
              <DataTable
                compact
                caption="Missed classes"
                rows={b.missed.missed}
                rowKey={(m) => m.sessionId}
                empty={<p className="el-field-hint">No missed classes recorded.</p>}
                columns={[
                  { key: 'date', header: 'Date' },
                  { key: 'reason', header: 'Reason', render: (m) => m.reason.replace(/_/g, ' ') },
                ]}
              />
            </Card>
            <Card title="2. Curriculum coverage of the batch" description="What was taught in the batch (verified teaching logs against the plan). It is exposure, not the student's mastery.">
              {b.coverage ? (
                <p>
                  {b.coverage.completionPercent === null ? 'Nothing planned, so no completion figure.' : `${b.coverage.completionPercent}% of planned hours verified`} · {b.coverage.verifiedHours} of {b.coverage.plannedHours} hours · {b.coverage.note}{' '}
                  <a href={`${MODULE_PATHS.report('coverage')}?batchId=${b.batchId}`}>Chapter detail</a>
                </p>
              ) : (
                <p>Coverage is not available for your role.</p>
              )}
            </Card>
            <Card title="3. Published assessment results" description="Only published results. A trend is shown only across assessments of the same kind, subject and maximum with enough results; one assessment never shows improvement.">
              <DataTable
                compact
                rows={b.results.filter((r) => r.published)}
                rowKey={(r) => r.assessmentId}
                empty={<p className="el-field-hint">No published results yet.</p>}
                columns={[
                  { key: 'code', header: 'Assessment', render: (r) => <a href={MODULE_PATHS.assessment(r.assessmentId)}>{r.code}</a> },
                  { key: 'date', header: 'Date', render: (r) => r.date ?? 'Not recorded' },
                  { key: 'kind', header: 'Kind', render: (r) => r.kind.replace(/_/g, ' ') },
                  { key: 'score', header: 'Score', numeric: true, render: (r) => (r.total === null ? <StateBadge state={r.state} /> : `${Number(r.total)} / ${Number(r.max)}`) },
                  { key: 'pct', header: '%', numeric: true, render: (r) => pct(r.total, r.max) ?? '—' },
                  ...(p.showRank ? [{ key: 'rank', header: 'Rank', numeric: true, render: (r: (typeof b.results)[number]) => r.rank ?? '—' }] : []),
                ]}
              />
              {b.unpublished > 0 ? <p className="el-field-hint">{b.unpublished} final result(s) are not published yet and are not shown.</p> : null}
              <ul>
                {b.trends.length === 0 ? <li>No comparable published results yet.</li> : null}
                {b.trends.map((t) => (
                  <li key={t.label}>
                    {t.label}: {t.trend.status === 'ok' ? `${t.trend.direction}, ${t.trend.slope > 0 ? '+' : ''}${t.trend.slope} percentage points per assessment over ${t.trend.pointsUsed}` : `no trend (${t.trend.reason})`}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
        <Card title="4. Teacher observations and support" description="Submitted teacher reviews (drafts stay private to their author) and support plans.">
          <p>
            {p.observations.submittedReviews} submitted review(s){p.observations.lastSubmittedAt ? `, the latest on ${p.observations.lastSubmittedAt.toISOString().slice(0, 10)}` : ''}. <a href={MODULE_PATHS.reviews}>Teacher reviews</a>
          </p>
          <InterventionsTable rows={p.interventions} canWrite={canWrite} />
          {canWrite && staff.length === 0 ? <Alert tone="info">No staff records exist to make responsible.</Alert> : null}
          {canWrite && staff.length > 0 ? (
            <details>
              <summary>Open a support plan</summary>
              <ApiForm
                action={MODULE_PATHS.api('interventions')}
                extra={{ studentId: p.student.id }}
                submitLabel="Open support plan"
                successMessage="Support plan opened."
                idPrefix="newplan"
                fields={[
                  { name: 'trigger', label: 'Reason', type: 'select', required: true, options: TRIGGERS },
                  { name: 'description', label: 'Concern', type: 'textarea', required: true },
                  { name: 'action', label: 'Next action', type: 'textarea', required: true },
                  { name: 'responsibleStaffId', label: 'Responsible teacher or counsellor', type: 'select', required: true, options: staff.map((x) => ({ value: x.id, label: x.fullName })) },
                  ...PLAN_FIELDS,
                ]}
              />
            </details>
          ) : null}
          <DataTable
            compact
            caption="Catch-up tasks (completing one never changes attendance)"
            rows={p.catchupTasks}
            rowKey={(t) => t.id}
            empty={<p className="el-field-hint">No catch-up tasks.</p>}
            columns={[
              { key: 'reason', header: 'Reason', render: (t) => t.reason.replace(/_/g, ' ') },
              { key: 'due', header: 'Due', render: (t) => t.dueDate ?? 'No date' },
              { key: 'status', header: 'Status', render: (t) => <StateBadge state={t.status} /> },
              { key: 'note', header: 'Note', render: (t) => t.note ?? '' },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
