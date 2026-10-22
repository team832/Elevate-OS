/** Batch profile tabs: details (Overview), Students (placements) and Teachers (assignment history). Server components. */
import { Alert, Card, DataTable, EmptyState, SourceBadge } from '@elevate/shared-ui';
import type { getBatch, listBatchPlacements, listStaff } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { assignmentPhase } from '../domain/placements';
import { todayIst } from '../server/context';
import { ApiForm } from './api-form';
import { StateBadge } from './badges';

type Batch = Awaited<ReturnType<typeof getBatch>>;
type Placement = Awaited<ReturnType<typeof listBatchPlacements>>[number];
type Staff = Awaited<ReturnType<typeof listStaff>>;

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
const ROLE_LABEL: Record<string, string> = { primary: 'Primary', co_teacher: 'Co-teacher', substitute: 'Substitute' };

/** Placement note: transfer marker plus reasons (reasons arrive only for coordinators; the server strips them for others). */
export function placementNote(p: { transferFromPlacementId: string | null; reason: string | null; endedReason: string | null }): string {
  return [p.transferFromPlacementId ? 'Transferred in' : null, p.reason, p.endedReason ? `Ended: ${p.endedReason}` : null].filter(Boolean).join(' · ') || '—';
}

/** Complete or withdraw ONE enrolment (explicit confirmation; the server refuses future dates). */
export function EndEnrolmentForm({ options, idPrefix, defaultEndDate }: { options: { value: string; label: string }[]; idPrefix: string; defaultEndDate?: string }) {
  return (
    <ApiForm
      action={MODULE_PATHS.api('placements/end')}
      submitLabel="End enrolment"
      successMessage="Enrolment ended. Its history and marks are kept."
      idPrefix={idPrefix}
      variant="danger"
      fields={[
        { name: 'enrolmentId', label: 'Enrolment', type: 'select', required: true, options },
        { name: 'outcome', label: 'Outcome', type: 'select', required: true, options: [{ value: 'completed', label: 'Completed' }, { value: 'withdrawn', label: 'Withdrawn' }] },
        { name: 'endDate', label: 'Last day in the batch', type: 'date', required: true, defaultValue: defaultEndDate, hint: 'Today or earlier.' },
        { name: 'reason', label: 'Reason', required: true },
        { name: 'confirm', label: 'I confirm this ends this one enrolment only', type: 'checkbox' },
      ]}
    />
  );
}

export function BatchDetails({ batch, staff, canWrite }: { batch: Batch; staff: Staff | null; canWrite: boolean }) {
  const { seats } = batch;
  const coordinator = staff?.find((s) => s.id === batch.coordinatorStaffId)?.fullName;
  return (
    <Card title="Batch details">
      <p>
        Coordinator: {coordinator ?? 'Not set'} · Campus: {batch.campus ?? 'Not set'} · Mode: {batch.mode ?? 'Not set'} · Dates: {batch.startDate ?? 'start not set'} to {batch.endDate ?? 'end not set'}
      </p>
      <p>
        Seats from today: {seats.placed} placed of {seats.capacity ?? 'no limit set'}. Demo students on upcoming classes: {seats.demoAttendeesUpcoming} (setting “demo students take a seat”: {seats.demoRule.counts ? 'yes' : 'no'}, {seats.demoRule.status}; shown for information, not used in placement checks).
      </p>
      {canWrite && staff ? (
        <details>
          <summary>Edit batch details</summary>
          <ApiForm
            action={MODULE_PATHS.api(`batches/${batch.id}`)}
            method="PATCH"
            submitLabel="Save batch details"
            successMessage="Batch details saved."
            idPrefix="batch-edit"
            fields={[
              { name: 'coordinatorStaffId', label: 'Coordinator', type: 'select', options: staff.map((s) => ({ value: s.id, label: s.fullName })) },
              { name: 'campus', label: 'Campus', defaultValue: batch.campus ?? undefined },
              { name: 'mode', label: 'Mode', type: 'select', options: opts(['offline', 'online', 'hybrid']) },
              { name: 'capacity', label: 'Seat limit', type: 'number', defaultValue: batch.capacity ?? undefined },
              { name: 'startDate', label: 'Start date', type: 'date', defaultValue: batch.startDate ?? undefined },
              { name: 'endDate', label: 'End date', type: 'date', defaultValue: batch.endDate ?? undefined },
              { name: 'status', label: 'Status', type: 'select', options: opts(['planning', 'active', 'completed', 'cancelled']), hint: 'Completing a batch does not complete its students. End each placement on the Students tab.' },
            ]}
          />
        </details>
      ) : null}
    </Card>
  );
}

export function BatchStudents({ batch, placements, canDecide }: { batch: Batch; placements: Placement[]; canDecide: boolean }) {
  const open = placements.filter((p) => p.endDate === null);
  const finished = batch.status === 'completed' || batch.status === 'cancelled';
  return (
    <Card title="Students" description="Every placement in this batch with its dates. Transfers and withdrawals end a placement; nothing is deleted.">
      <div className="el-stack">
        {finished && open.length > 0 ? (
          <Alert tone="warning" title={`${open.length} student(s) still placed in this ${batch.status} batch`}>
            Nothing is closed automatically. Complete or withdraw each enrolment below, one at a time.
          </Alert>
        ) : null}
        <DataTable
          compact
          rows={placements}
          rowKey={(p) => p.id}
          empty={<EmptyState title="No students placed" description="Allocate students from the Enrolments page (Awaiting batch tab)." />}
          columns={[
            { key: 'student', header: 'Student', render: (p) => <><a href={MODULE_PATHS.student(p.studentId)}>{p.studentName}</a> <SourceBadge source={p.isSample ? 'sample' : 'live'} /></> },
            { key: 'from', header: 'From', render: (p) => p.startDate },
            { key: 'to', header: 'To', render: (p) => p.endDate ?? 'Current' },
            { key: 'why', header: 'Note', render: placementNote },
            { key: 'status', header: 'Enrolment', render: (p) => <StateBadge state={p.enrolmentStatus} /> },
          ]}
        />
        {canDecide && open.length > 0 ? (
          <details open={finished}>
            <summary>Complete enrolments</summary>
            <EndEnrolmentForm idPrefix="complete" options={open.map((p) => ({ value: p.enrolmentId, label: p.studentName }))} defaultEndDate={todayIst()} />
          </details>
        ) : null}
      </div>
    </Card>
  );
}

export function BatchTeachers({ batch, subjects, staff, canAssign }: { batch: Batch; subjects: { id: string; code: string; name: string }[]; staff: Staff | null; canAssign: boolean }) {
  const today = todayIst();
  const changeable = batch.assignments.filter((a) => (a.endDate ? a.endDate >= today : a.status === 'active'));
  return (
    <Card title="Teachers" description="Assignment history. Ending an assignment sets its last day; past classes keep the teacher who taught them.">
      <div className="el-stack">
        <DataTable
          compact
          rows={batch.assignments}
          rowKey={(a) => a.id}
          empty={<EmptyState title="No teachers assigned" description={canAssign ? 'Assign a teacher below.' : 'Ask the academic coordinator to assign teachers.'} />}
          columns={[
            { key: 'subject', header: 'Subject', render: (a) => a.subjectName },
            { key: 'staffName', header: 'Teacher' },
            { key: 'role', header: 'Role', render: (a) => ROLE_LABEL[a.role] ?? a.role },
            { key: 'from', header: 'From', render: (a) => a.startDate ?? 'Not set' },
            { key: 'to', header: 'To', render: (a) => a.endDate ?? 'Open' },
            { key: 'status', header: 'Now', render: (a) => <StateBadge state={assignmentPhase(a.startDate, a.endDate, today)} /> },
          ]}
        />
        {canAssign
          ? changeable.map((a) => (
              <details key={a.id}>
                <summary>{a.endDate ? 'Change end date' : 'End assignment'}: {a.staffName}, {a.subjectName}</summary>
                <ApiForm
                  action={MODULE_PATHS.api(`assignments/${a.id}/end`)}
                  submitLabel={a.endDate ? "Save end date" : "End assignment"}
                  successMessage="Assignment ended. History kept."
                  idPrefix={`end-${a.id}`}
                  fields={[{ name: 'endDate', label: 'Last day', type: 'date', required: true }]}
                />
              </details>
            ))
          : null}
        {canAssign && staff ? (
          <ApiForm
            action={MODULE_PATHS.api('assignments')}
            extra={{ batchId: batch.id }}
            submitLabel="Assign teacher"
            successMessage="Teacher assigned."
            idPrefix="assign"
            fields={[
              { name: 'subjectId', label: 'Subject', type: 'select', required: true, options: subjects.map((s) => ({ value: s.id, label: s.name })) },
              { name: 'staffMemberId', label: 'Teacher', type: 'select', required: true, options: staff.map((s) => ({ value: s.id, label: `${s.fullName}${s.title ? `, ${s.title}` : ''}` })) },
              { name: 'role', label: 'Role', type: 'select', options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })) },
              { name: 'employmentType', label: 'Employment', type: 'select', options: opts(['full_time', 'part_time']) },
              { name: 'startDate', label: 'From', type: 'date' },
              { name: 'endDate', label: 'To (leave empty if open)', type: 'date' },
            ]}
          />
        ) : null}
      </div>
    </Card>
  );
}
