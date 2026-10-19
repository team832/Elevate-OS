import type { AuthenticatedUser } from '@elevate/authentication';
import { Card, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, PIPELINE_ORDER, type AdmissionStatus } from '../../domain';
import { listAdmissions } from '../../server/admissions';
import { fmtDateTime } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function AdmissionsPage() {
  const access = await gate('ops:admissions:read', '/ops/admissions');
  return (
    <Frame access={access} active="admissions">
      <PageHeader
        title="Admissions pipeline"
        description="new → contacted → counselling → demo → admission pending → admitted → enrolment requested → enrolled (lost / on hold with a reason). “Enrolment requested” means awaiting Academic OS, never enrolled."
      />
      <Section>
        <Board user={access.user} />
      </Section>
    </Frame>
  );
}

async function Board({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listAdmissions(db, user));
  if (!r.ok) return r.view;
  if (r.data.length === 0)
    return (
      <EmptyState
        title="No admission cases yet"
        description="Creating a lead opens an admission case."
        action={<a href="/ops/leads">Go to leads</a>}
      />
    );
  const columns: AdmissionStatus[] = [...PIPELINE_ORDER, 'on_hold', 'lost'];
  return (
    <div className="el-board">
      {columns.map((status) => {
        const rows = r.data.filter((a) => a.status === status);
        return (
          <Card key={status} title={`${ADMISSION_STATUS_LABELS[status]} (${rows.length})`}>
            {rows.length === 0 ? (
              <p className="el-field-hint">None</p>
            ) : (
              <ul className="el-stack">
                {rows.map((a) => (
                  <li key={a.id}>
                    <a href={`/ops/admissions/${a.id}`}>{a.code}</a> — {a.studentName} ·{' '}
                    {a.programmeCode ?? 'no programme'}
                    <br />
                    <span className="el-field-hint">
                      {a.counsellorName ?? 'No counsellor'} · since {fmtDateTime(a.statusChangedAt)}
                    </span>
                    {a.handoffStatus === 'rejected' ? (
                      <StatusBadge tone="danger">
                        Enrolment rejected: {a.rejectionReason}
                      </StatusBadge>
                    ) : null}
                    {a.demoSkipped ? <StatusBadge tone="info">Demo skipped</StatusBadge> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
