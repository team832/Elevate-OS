/** Teaching assignments as read from Academic OS (shared by the list and the staff record). */
import { Alert, EmptyState, StatusBadge } from '@elevate/shared-ui';
import type { listTeachingAssignments } from '../../../server/hr-assignments';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';

type Result = Awaited<ReturnType<typeof listTeachingAssignments>>;

const STATUS = {
  active: ['success', 'Active'],
  pending: ['warning', 'Pending — no batch yet'],
  ended: ['neutral', 'Ended'],
} as const;

export function AssignmentsTable({
  result,
  withTeacher,
}: {
  result: Result;
  withTeacher: boolean;
}) {
  if (result.status === 'unavailable')
    return (
      <Alert tone="warning">
        Source unavailable — Academic OS could not be read ({result.reason}, checked{' '}
        {fmtDateTime(result.fetchedAt)}). Assignments are not shown rather than shown as none.
      </Alert>
    );
  const d = result.data;
  return (
    <RecordTable
      caption={`${d.total} assignment${d.total === 1 ? '' : 's'}`}
      rows={d.items}
      rowKey={(a) => a.assignmentId}
      empty={
        <EmptyState
          title="No teaching assignments"
          description="Academic coordinators record assignments in Academic OS → Teachers."
        />
      }
      columns={[
        ...(withTeacher
          ? [
              {
                key: 'teacherName',
                header: 'Teacher',
                render: (a: (typeof d.items)[number]) => (
                  <a href={`/ops/hr/staff/${a.staffId}?tab=responsibilities`}>{a.teacherName}</a>
                ),
              },
            ]
          : []),
        { key: 'courseName', header: 'Course', render: (a) => a.courseName ?? 'Not recorded' },
        { key: 'subjectName', header: 'Subject' },
        { key: 'classLevel', header: 'Class level', render: (a) => a.classLevel ?? 'Not set' },
        { key: 'batchCode', header: 'Batch', render: (a) => a.batchCode ?? 'No batch yet' },
        {
          key: 'academicYear',
          header: 'Academic year',
          render: (a) => a.academicYear ?? 'Not recorded',
        },
        { key: 'branchName', header: 'Branch', render: (a) => a.branchName ?? 'Not recorded' },
        {
          key: 'startDate',
          header: 'Dates',
          render: (a) =>
            a.startDate || a.endDate
              ? `${a.startDate ? fmtDate(a.startDate) : 'Open start'} – ${a.endDate ? fmtDate(a.endDate) : 'no end date'}`
              : 'Not recorded',
        },
        { key: 'role', header: 'Primary or substitute', render: (a) => humanise(a.role) },
        {
          key: 'status',
          header: 'Status',
          render: (a) => (
            <StatusBadge tone={STATUS[a.status][0]}>{STATUS[a.status][1]}</StatusBadge>
          ),
        },
      ]}
    />
  );
}
