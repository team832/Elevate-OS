/**
 * Teacher feedback tab (brief §5): review state per demo day per teacher from the single
 * teacher-feedback store (server/feedback.ts demoFeedbackByDay; teachers write in their module).
 * Pending, draft and submitted differ; "No review submitted" says nothing about the student. Review text only for staff with ops:feedback:read.
 * Student and guardian feedback after the demo stay checklist items.
 */
import { can } from '@elevate/authorization';
import { fmtDateTime } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
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
        description="One review per teacher per demo day, about the classes they took. A teacher whose class the student did not attend has no review due."
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
            {
              key: 'text',
              header: 'Observation, strengths, support, next step',
              render: (t) => {
                const own = d.reviewTexts.filter((r) => t.reviewIds.includes(r.id));
                if (own.length === 0)
                  return t.state === 'submitted' || t.state === 'draft'
                    ? 'Shown to staff with feedback access'
                    : '—';
                return own.map((r) => (
                  <p key={r.id}>
                    <strong>
                      v{r.version} ({r.status}, {fmtDateTime(r.updatedAt)}):
                    </strong>{' '}
                    {[r.observations, r.strengths, r.areasToImprove, r.actionPlan]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ));
              },
            },
          ]}
        />
      </Segment>
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
