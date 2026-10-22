/**
 * Teacher feedback tab (brief §5; owner answers 1 and 3, 21 Oct 2026): review state per demo day
 * per teacher (server/feedback.ts demoFeedbackByDay). Teachers write reviews in Academic OS; this
 * tab shows the submitted ones, the older Ops records as read-only history, and "Source
 * unavailable" when Academic cannot be read. "No review submitted" says nothing about the
 * student. Student and guardian feedback after the demo stay checklist items.
 */
import { can } from '@elevate/authorization';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import { AcademicReviewList } from '../../../ui/student-feedback-section';
import { ChecklistForm, ChecklistTable } from './demo-activity';
import { ReviewBadge } from './demo-bits';
import type { DemoTabProps } from './demo-record';

export function DemoFeedback({ d, user, level }: DemoTabProps) {
  const family = d.checklist.items.filter((i) => i.key.endsWith('_feedback'));
  const rows = d.feedback.flatMap((day) =>
    day.teachers.map((t) => ({ ...t, dayNumber: day.dayNumber })),
  );
  return (
    <>
      <Segment
        title="Teacher reviews"
        level={level}
        flush
        description="One review per teacher per demo day, about the classes they took (for a class linked to Academic OS, its actual teachers). A teacher whose class the student did not attend has no review due."
      >
        <RecordTable
          rows={rows}
          rowKey={(t) => `${t.dayNumber}-${t.staffId}`}
          empty="No teacher has taken a class on this demo yet."
          columns={[
            { key: 'day', header: 'Day', numeric: true, render: (t) => t.dayNumber },
            {
              key: 'teacher',
              header: 'Teacher',
              render: (t) => `${t.teacherName}${t.isSubstitute ? ' (substitute)' : ''}`,
            },
            { key: 'state', header: 'Review', render: (t) => <ReviewBadge state={t.state} /> },
          ]}
        />
      </Segment>
      <Segment title="Submitted reviews (Academic OS)" level={level}>
        <AcademicReviewList result={d.reviews} user={user} heading={level === 3 ? 'h4' : 'h3'} />
      </Segment>
      {d.legacyReviews.length ? (
        <Segment
          title="Earlier reviews — recorded in Business Ops before 21 Oct 2026"
          level={level}
          flush
          description="Read-only history."
        >
          <RecordTable
            rows={d.legacyReviews}
            rowKey={(r) => r.id}
            columns={[
              { key: 'subject', header: 'Subject' },
              { key: 'v', header: 'Version', numeric: true, render: (r) => r.version },
              {
                key: 'text',
                header: 'Observation, strengths, support, next step',
                render: (r) =>
                  [r.observations, r.strengths, r.areasToImprove, r.actionPlan]
                    .filter(Boolean)
                    .join(' · '),
              },
            ]}
          />
        </Segment>
      ) : null}
      <Segment
        title="Student and guardian feedback"
        level={level}
        flush
        description="Whether the family's view was taken after the demo (checklist items)."
      >
        <ChecklistTable d={d} items={family} />
      </Segment>
      {can(user, 'ops:leads:write') ? (
        <Segment title="Record family feedback" level={level}>
          <ChecklistForm d={d} items={family} />
        </Segment>
      ) : null}
    </>
  );
}
