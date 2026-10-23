/**
 * Teaching assignments (brief 23 Oct 2026 §4, R9): one table for every reader (a teacher's My day,
 * the teacher profile) and the coordinator's forms to record, edit, activate, end or withdraw.
 * Server components; the routes check `academic:assignments:write` again.
 */
import { DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import type { AssignmentRow, assignmentOptions, listBatches } from '../server';
import { assignmentPhase } from '../domain/placements';
import { MODULE_PATHS } from '../server/paths';
import { ApiForm, type FormField } from './api-form';
import { StateBadge } from './badges';

export const ROLE_LABEL: Record<string, string> = { primary: 'Primary', co_teacher: 'Co-teacher', substitute: 'Substitute' };
export const NO_BATCH = 'No batch yet — a coordinator will assign one';

const roleOptions = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));
const employmentOptions = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
];
const yearField: FormField = { name: 'academicYear', label: 'Academic year', placeholder: '2026-27', hint: 'Form 2026-27. Leave empty if not decided.' };

/** `placed`: students placed today per batch id (adds a column). */
export function AssignmentTable({ rows, today, placed, empty }: { rows: readonly AssignmentRow[]; today: string; placed?: Map<string, number>; empty: string }) {
  return (
    <DataTable
      compact
      rows={[...rows]}
      rowKey={(a) => a.id}
      empty={<EmptyState title={empty} />}
      columns={[
        { key: 'subject', header: 'Subject', render: (a) => <strong>{a.subjectName}</strong> },
        { key: 'course', header: 'Course', render: (a) => `${a.programmeName} · ${a.courseCode}` },
        { key: 'batch', header: 'Batch', render: (a) => (a.batchId ? <a href={MODULE_PATHS.batch(a.batchId)}>{a.batchCode}</a> : NO_BATCH) },
        ...(placed ? [{ key: 'placed', header: 'Students placed', numeric: true, render: (a: AssignmentRow) => (a.batchId ? (placed.get(a.batchId) ?? 'Not recorded') : 'None') }] : []),
        { key: 'role', header: 'Role', render: (a) => ROLE_LABEL[a.role] ?? a.role },
        { key: 'year', header: 'Academic year', render: (a) => a.academicYear ?? 'Not recorded' },
        { key: 'branch', header: 'Branch', render: (a) => a.branchName ?? 'Not recorded' },
        { key: 'dates', header: 'Dates', render: (a) => `${a.startDate ?? 'from the start'} to ${a.endDate ?? 'open'}` },
        {
          key: 'status',
          header: 'Now',
          render: (a) => (a.status === 'pending' ? <StatusBadge tone="info">Pending</StatusBadge> : <StateBadge state={assignmentPhase(a.startDate, a.endDate, today)} />),
        },
      ]}
    />
  );
}

type Options = Awaited<ReturnType<typeof assignmentOptions>>;
type Batch = Awaited<ReturnType<typeof listBatches>>[number];

const branchFieldOf = (options: Options): FormField => ({
  name: 'branchId',
  label: 'Branch',
  type: 'select',
  options: options.branches.map((b) => ({ value: b.id, label: b.status === 'provisional' ? `${b.name} (provisional)` : b.name })),
});

/** Coordinator forms on a teacher's profile: record (with or without a batch), then per row edit/activate, end or withdraw. */
export function AssignmentForms({ staffId, rows, options, batches, today }: { staffId: string; rows: readonly AssignmentRow[]; options: Options; batches: readonly Batch[]; today: string }) {
  const branchField = branchFieldOf(options);
  const batchesOf = (courseId: string) => batches.filter((b) => b.courseId === courseId).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  return (
    <div className="el-stack">
      {rows.map((a) => {
        const name = `${a.subjectName} (${a.courseCode}${a.batchCode ? `, ${a.batchCode}` : ''})`;
        const pending = a.status === 'pending';
        const changeable = pending || (a.endDate ? a.endDate >= today : a.status === 'active');
        if (!changeable) return null;
        return (
          <details key={a.id}>
            <summary>{pending ? 'Set batch or edit' : 'Edit or end'}: {name}</summary>
            <ApiForm
              action={MODULE_PATHS.api(`assignments/${a.id}`)}
              method="PATCH"
              submitLabel={pending ? 'Save (a batch activates it)' : 'Save changes'}
              successMessage={pending ? 'Saved. With a batch set, the teacher now sees that batch and its students.' : 'Saved.'}
              idPrefix={`edit-${a.id}`}
              fields={[
                ...(pending
                  ? [{ name: 'batchId', label: 'Batch', type: 'select' as const, options: batchesOf(a.courseId), hint: batchesOf(a.courseId).length ? 'Batches of this course. Setting one activates the assignment.' : 'This course has no batch yet; create one first.' }]
                  : []),
                { name: 'role', label: 'Role', type: 'select', options: roleOptions, defaultValue: a.role },
                { ...yearField, defaultValue: a.academicYear ?? undefined },
                { ...branchField, defaultValue: a.branchId ?? undefined },
                { name: 'startDate', label: 'From', type: 'date', defaultValue: a.startDate ?? undefined },
              ]}
            />
            {pending ? (
              <ApiForm
                action={MODULE_PATHS.api(`assignments/${a.id}`)}
                method="DELETE"
                variant="danger"
                submitLabel="Withdraw pending assignment"
                successMessage="Withdrawn. The audit log keeps it."
                idPrefix={`withdraw-${a.id}`}
                fields={[{ name: 'reason', label: 'Reason', required: true }]}
              />
            ) : (
              <ApiForm
                action={MODULE_PATHS.api(`assignments/${a.id}/end`)}
                submitLabel={a.endDate ? 'Save end date' : 'End assignment'}
                successMessage="Assignment ended. History kept."
                idPrefix={`end-${a.id}`}
                fields={[{ name: 'endDate', label: 'Last day', type: 'date', required: true }]}
              />
            )}
          </details>
        );
      })}
      <RecordAssignmentForm staffId={staffId} options={options} batches={batches} />
    </div>
  );
}

/** Record an assignment for `staffId`, or for a teacher picked from `staff` (Teachers page: someone with no assignment yet). */
export function RecordAssignmentForm({ staffId, staff, options, batches }: { staffId?: string; staff?: readonly { id: string; fullName: string; title: string | null }[]; options: Options; batches: readonly Batch[] }) {
  return (
    <details>
      <summary>Record an assignment</summary>
      <ApiForm
        action={MODULE_PATHS.api('assignments')}
        extra={staffId ? { staffMemberId: staffId } : undefined}
        submitLabel="Record assignment"
        successMessage="Recorded."
        idPrefix={`assign-${staffId ?? 'any'}`}
        fields={[
          ...(staff ? [{ name: 'staffMemberId', label: 'Teacher', type: 'select' as const, required: true, options: staff.map((s) => ({ value: s.id, label: `${s.fullName}${s.title ? `, ${s.title}` : ''}` })) }] : []),
          { name: 'subjectId', label: 'Course and subject', type: 'select', required: true, options: options.subjects.map((s) => ({ value: s.id, label: `${s.courseCode} · ${s.name} (${s.programmeName})` })) },
          { name: 'batchId', label: 'Batch', type: 'select', options: batches.map((b) => ({ value: b.id, label: `${b.code} (${b.courseCode})` })), hint: 'Leave empty to record it pending: it opens no batch or student until a batch is set. The batch must run the chosen course.' },
          { name: 'role', label: 'Role', type: 'select', options: roleOptions },
          { name: 'employmentType', label: 'Employment', type: 'select', options: employmentOptions },
          yearField,
          branchFieldOf(options),
          { name: 'startDate', label: 'From', type: 'date' },
          { name: 'endDate', label: 'To (leave empty if open)', type: 'date' },
        ]}
      />
    </details>
  );
}
