import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { getCourse, getPlan } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { ApiForm } from '../../../../ui/api-form';
import { PlanBadge, StateBadge, fmtDateTime } from '../../../../ui/badges';
import { AcademicShell, LoadError, gate, load } from '../../../../ui/shell';

export const dynamic = 'force-dynamic';

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:courses:read', MODULE_PATHS.plan(id));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="curriculum">{null}</AcademicShell>;
  const db = getDb();
  const data = await load(async () => {
    const plan = await getPlan(db, id);
    return { ...plan, course: await getCourse(db, plan.plan.courseId) };
  });
  if (!data.ok) return <AcademicShell access={access} active="curriculum"><LoadError error={data.error} /></AcademicShell>;
  const { plan, items, totals, totalClasses, totalHours, approvals, supersededBy, course } = data.data;
  const canWrite = can(access.user, 'academic:courses:write');
  const canApprove = can(access.user, 'academic:curriculum:approve');
  const pending = approvals.find((a) => a.status === 'pending');
  return (
    <AcademicShell access={access} active="curriculum">
      <PageHeader
        title={`${plan.code} — ${plan.title}`}
        description={<>Course {course.code} · version {plan.version} · <PlanBadge status={plan.status} /> <PlanBadge status={plan.countsStatus} prefix="counts" /> <PlanBadge status={plan.datesStatus} prefix="dates" /></>}
        actions={<a href={MODULE_PATHS.curriculum}>All plans</a>}
      />
      <div className="el-stack">
        <Alert tone="info" title="This is a plan, not delivery">
          {totalClasses} planned classes / {totalHours} planned hours{plan.classMinutes ? ` at ${plan.classMinutes} minutes per class` : ''}. Completed hours come only from verified class records (see a batch’s coverage).
          {plan.supersedesPlanId ? ' This version supersedes an earlier plan.' : ''}
          {supersededBy ? ` Superseded by ${supersededBy.code} (${supersededBy.status}).` : ''}
        </Alert>
        {plan.scopeNote || plan.changeLog ? (
          <Card title="Scope and change log">
            {plan.scopeNote ? <p>{plan.scopeNote}</p> : null}
            {plan.changeLog ? <p>{plan.changeLog}</p> : null}
            {plan.sourceRef ? <p className="el-field-hint">Source: {plan.sourceRef}</p> : null}
          </Card>
        ) : null}
        <Card title="Planned classes by subject">
          <DataTable
            rows={totals}
            rowKey={(t) => t.subjectCode}
            empty={<EmptyState title="No items yet" />}
            columns={[
              { key: 'subjectCode', header: 'Subject' },
              { key: 'teaching', header: 'Teaching', numeric: true },
              { key: 'practice', header: 'Practice', numeric: true },
              { key: 'total', header: 'Total classes', numeric: true },
              { key: 'hours', header: 'Planned hours', numeric: true },
            ]}
          />
        </Card>
        <Card title="Approval history" description="Locking or making a plan provisional needs another academic coordinator’s approval (core approvals; no self-approval).">
          <DataTable
            rows={approvals}
            rowKey={(a) => a.id}
            empty={<EmptyState title="No approval requests" description={plan.legacyApprovedOn ? `Imported legacy status; recorded in the source as approved on ${plan.legacyApprovedOn}.` : undefined} />}
            columns={[
              { key: 'requestedAt', header: 'Requested', render: (a) => fmtDateTime(a.requestedAt) },
              { key: 'requestComment', header: 'Request', render: (a) => a.requestComment ?? '—' },
              { key: 'status', header: 'Decision', render: (a) => <StateBadge state={a.status} /> },
              { key: 'decidedAt', header: 'Decided', render: (a) => fmtDateTime(a.decidedAt) },
              { key: 'comment', header: 'Comment', render: (a) => a.comment ?? '—' },
            ]}
          />
          {canWrite && !pending && (plan.status === 'proposed' || plan.status === 'provisional') ? (
            <ApiForm
              action={MODULE_PATHS.api(`plans/${plan.id}/approval`)}
              submitLabel="Request approval"
              successMessage="Approval requested."
              idPrefix="req"
              fields={[
                { name: 'targetStatus', label: 'Make this plan', type: 'select', required: true, options: (plan.status === 'proposed' ? ['locked', 'provisional'] : ['locked']).map((v) => ({ value: v, label: v })) },
                { name: 'comment', label: 'Comment', type: 'textarea' },
              ]}
            />
          ) : null}
          {canApprove && pending ? (
            <ApiForm
              action={MODULE_PATHS.api(`plans/${plan.id}/approval/decision`)}
              submitLabel="Record decision"
              successMessage="Decision recorded."
              idPrefix="dec"
              fields={[
                { name: 'decision', label: `Decision (requested: ${plan.pendingTargetStatus})`, type: 'select', required: true, options: [{ value: 'approved', label: 'Approve' }, { value: 'rejected', label: 'Reject' }] },
                { name: 'comment', label: 'Comment (required to reject)', type: 'textarea' },
              ]}
            />
          ) : null}
        </Card>
        <Card title={`Lesson sequence (${items.length} items)`}>
          <DataTable
            rows={items}
            rowKey={(i) => i.id}
            empty={<EmptyState title="No items" />}
            columns={[
              { key: 'sequence', header: '#', numeric: true },
              { key: 'lessonCode', header: 'Lesson' },
              { key: 'subjectCode', header: 'Subject' },
              { key: 'chapter', header: 'Chapter', render: (i) => `${i.chapterCode} ${i.chapterTitle}` },
              { key: 'sessionType', header: 'Type' },
              { key: 'plannedClasses', header: 'Classes', numeric: true },
              { key: 'plannedMinutes', header: 'Minutes', numeric: true },
              { key: 'plannedDate', header: 'Planned date', render: (i) => i.plannedDate ?? 'undated' },
              { key: 'coverage', header: 'Coverage', render: (i) => i.coverage ?? '' },
            ]}
          />
        </Card>
        {canWrite && plan.status === 'proposed' ? (
          <Card title="Add an item" description="Only proposed plans accept items.">
            <ApiForm
              action={MODULE_PATHS.api(`plans/${plan.id}/items`)}
              wrapAs="items"
              submitLabel="Add item"
              successMessage="Item added."
              idPrefix="item"
              fields={[
                { name: 'chapterId', label: 'Chapter', type: 'select', required: true, options: course.chapters.filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: `${c.code} ${c.title}` })) },
                { name: 'lessonCode', label: 'Lesson code', required: true },
                { name: 'sessionType', label: 'Type', type: 'select', required: true, options: [{ value: 'teaching', label: 'teaching' }, { value: 'practice', label: 'practice' }] },
                { name: 'plannedClasses', label: 'Planned classes', type: 'number', defaultValue: 1 },
                { name: 'plannedMinutes', label: 'Planned minutes', type: 'number', hint: 'Leave empty to use classes × the plan’s class length.' },
                { name: 'plannedDate', label: 'Planned date', type: 'date' },
                { name: 'coverage', label: 'Coverage' },
              ]}
            />
          </Card>
        ) : null}
      </div>
    </AcademicShell>
  );
}
