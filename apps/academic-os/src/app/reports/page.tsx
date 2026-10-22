import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { can, type Permission } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Button, Card, Field, PageHeader, Select, TextInput } from '@elevate/shared-ui';
import type { PageAccess } from '@elevate/server-kit/next';
import { listAssessments, listBatches, listStaff, resolveScope, todayIst } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reports' };

export default async function ReportsPage() {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:module:access', MODULE_PATHS.reports);
  return (
    <AcademicShell access={access} active="reports" loading="Loading reports…">
      {access.status === 'allowed' ? <Body access={access} /> : null}
    </AcademicShell>
  );
}

function ReportForm({ kind, title, description, children }: { kind: string; title: string; description: string; children: ReactNode }) {
  return (
    <Card title={title} description={description}>
      <form method="get" action={MODULE_PATHS.report(kind)} className="el-form-grid">
        {children}
        <div className="el-form-actions">
          <Button type="submit">Open print view</Button>
        </div>
      </form>
    </Card>
  );
}

async function Body({ access }: { access: PageAccess }) {
  const db = getDb();
  const actor = actorFor(access.user);
  const has = (p: Permission) => can(access.user, p);
  const today = todayIst();
  const data = await load(async () => ({
    batches: has('academic:batches:read') ? await listBatches(db, actor) : [],
    assessments: has('academic:assessments:read') ? (await listAssessments(db, actor)).filter((a) => a.status === 'finalised') : [],
    staff: has('academic:classes:read') && (await resolveScope(db, actor, 'academic:classes:read')).kind === 'all' ? await listStaff(db, { teachingOnly: true }) : null,
  }));
  if (!data.ok) return <LoadError error={data.error} />;
  const { batches, assessments, staff } = data.data;
  const batchField = (id: string) => (
    <Field id={id} label="Batch">
      <Select id={id} name="batchId" required>
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} — {b.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  const date = (id: string, name: string, label: string, value?: string) => (
    <Field id={id} label={label}>
      <TextInput id={id} name={name} type="date" defaultValue={value} />
    </Field>
  );
  return (
    <>
      <PageHeader title="Reports" description="Print views (A4) with a CSV download. Each report states how its figures are counted. Parent progress reports are prepared and reviewed in Business Ops." />
      <div className="el-stack">
        {batches.length === 0 && assessments.length === 0 && !has('academic:classes:read') ? <p>No reports are available for your role.</p> : null}
        {has('academic:attendance:read') && batches.length > 0 ? (
          <ReportForm kind="attendance" title="Batch attendance" description="Per student: delivered sessions within the placement dates, each mark, not recorded, and the attendance %.">
            {batchField('att-batch')}
            {date('att-from', 'from', 'From')}
            {date('att-to', 'to', 'To', today)}
          </ReportForm>
        ) : null}
        {batches.length > 0 ? (
          <ReportForm kind="coverage" title="Batch curriculum coverage" description="Per chapter: planned against verified teaching hours. What was taught, not what students have mastered.">
            {batchField('cov-batch')}
            {date('cov-to', 'to', 'As of', today)}
          </ReportForm>
        ) : null}
        {has('academic:assessments:read') ? (
          assessments.length === 0 ? (
            <Card title="Assessment analysis" description="No assessment has final results yet. Finalise one on its assessment page first." />
          ) : (
            <ReportForm kind="assessment" title="Assessment analysis" description="Final results with the scored-only average and the counts of absent, exempt, withheld and pending students.">
              <Field id="asm-id" label="Assessment">
                <Select id="asm-id" name="assessmentId" required>
                  {assessments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.title} ({a.batchCode})
                    </option>
                  ))}
                </Select>
              </Field>
            </ReportForm>
          )
        ) : null}
        {has('academic:classes:read') ? (
          <ReportForm kind="teacher-week" title="Teacher weekly summary" description="Sessions planned, delivered and cancelled, and teaching logs still pending, for one Monday-to-Sunday week. Operational only: not HR attendance.">
            {staff ? (
              <Field id="tw-staff" label="Teacher">
                <Select id="tw-staff" name="staffId" required>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="el-field-hint">Your own week.</p>
            )}
            {date('tw-from', 'from', 'Any day in the week', today)}
          </ReportForm>
        ) : null}
      </div>
    </>
  );
}
