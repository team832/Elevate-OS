import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert } from '@elevate/shared-ui';
import { REVIEW_STATE_LABELS } from '../../domain/feedback';
import { writeReviewHref } from '../../server/academic-reviews';
import { demoReviewsDue, REVIEWS_DUE_DAYS } from '../../server/feedback';
import { load } from '../../ui/frame';
import { fmtDateTime } from '../../ui/format';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { isTeacher } from '../../ui/student-feedback-section';
import { SampleBadge } from '../meetings/appointment-view';

/** Demo classes this teacher took where the student attended and no review is submitted yet. */
export async function DemoReviewsDue({
  staffId,
  user,
  level,
}: {
  staffId: string;
  user: AuthenticatedUser;
  level: 2 | 3;
}) {
  const r = await load((db) => demoReviewsDue(db, user, staffId));
  const write = isTeacher(user);
  return (
    <Segment
      title="Demo classes waiting for a review"
      level={level}
      flush
      description={`Demo classes in the last ${REVIEWS_DUE_DAYS} days. Pending is not a mark against anyone: it only means no review is submitted yet. Teachers write reviews in Academic OS.`}
    >
      {r.ok && !r.data.shared ? (
        <p className="el-field-hint">Not shared with you.</p>
      ) : r.ok ? (
        <>
          {r.data.unavailable ? (
            <Alert
              tone="warning"
              title="Academic OS unavailable — some of these may already be reviewed"
            >
              Checked {fmtDateTime(r.data.unavailable.checkedAt)} ({r.data.unavailable.reason}).
            </Alert>
          ) : null}
          <RecordTable
            rows={r.data.rows}
            rowKey={(x) => `${x.id}-${x.teacherStaffId}`}
            empty="No demo class is waiting for a review."
            columns={[
              {
                key: 'student',
                header: 'Student',
                render: (x) => (
                  <>
                    {x.studentName} <SampleBadge show={x.isSample} />
                  </>
                ),
              },
              { key: 'day', header: 'Demo day', numeric: true, render: (x) => x.dayNumber },
              { key: 'when', header: 'Class', render: (x) => fmtDateTime(x.startsAt) },
              { key: 'subject', header: 'Subject', render: (x) => x.subject ?? 'Not recorded' },
              {
                key: 'state',
                header: 'Review',
                render: (x) =>
                  x.onRoster === null ? (
                    'Source unavailable'
                  ) : !x.onRoster ? (
                    'Not on an Academic class roster — ask the academic coordinator to add the student.'
                  ) : write ? (
                    <a
                      href={writeReviewHref({ coreStudentId: x.studentId, opsDemoSessionId: x.id })}
                    >
                      Write review in Academic OS
                      <span className="el-visually-hidden">
                        {' '}
                        for {x.studentName}, day {x.dayNumber}
                      </span>
                    </a>
                  ) : (
                    REVIEW_STATE_LABELS.pending
                  ),
              },
            ]}
          />
        </>
      ) : (
        r.view
      )}
    </Segment>
  );
}
