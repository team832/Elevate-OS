/** Small display pieces shared by the demo list, pop-up and full record (server components). */
import type { ReactNode } from 'react';
import { SourceBadge, StatusBadge, type Tone } from '@elevate/shared-ui';
import { istToday } from '../../../domain/dates';
import {
  ATTENDANCE_LABELS,
  DAY_STATE_LABELS,
  isPending,
  type Attendance,
  type DayState,
} from '../../../domain/demos';
import { REVIEW_STATE_LABELS, type ReviewState } from '../../../domain/feedback';
import { followUpAge } from '../../../domain/follow-up-age';
import type { DemoRecord } from '../../../server/demos';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { AttendanceControl } from '../../../ui/attendance-control';
import { fmtDateTime, humanise } from '../../../ui/format';
import '../admissions.css';

const TONES: Record<string, Tone> = {
  // attendance and day summary
  present: 'success',
  late: 'success',
  attended: 'success',
  absent: 'danger',
  excused: 'neutral',
  scheduled: 'info',
  rescheduled: 'warning',
  not_recorded: 'warning',
  // outcome
  open: 'info',
  converted: 'success',
  not_converted: 'warning',
  no_show: 'warning',
  // checklist
  complete: 'success',
  pending: 'warning',
  waived: 'info',
  // follow-up urgency
  overdue: 'danger',
  due_today: 'warning',
  upcoming: 'info',
  // demo fee
  paid: 'success',
  part_paid: 'warning',
  unpaid: 'warning',
  refunded: 'neutral',
  // teacher review ("No review submitted" stays neutral, never negative)
  submitted: 'success',
  draft: 'info',
};

export const Badge = ({ value, label }: { value: string; label?: string }) => (
  <StatusBadge tone={TONES[value] ?? 'neutral'}>{label ?? humanise(value)}</StatusBadge>
);

/** Teacher review state; anything not submitted stays neutral ("pending" is never a judgement). */
export const ReviewBadge = ({ state }: { state: ReviewState }) => (
  <StatusBadge tone={state === 'submitted' ? 'success' : 'neutral'}>
    {state === 'pending' ? 'No review submitted' : REVIEW_STATE_LABELS[state]}
  </StatusBadge>
);

/** Teachers per demo day with their review state (from server/feedback.ts demoFeedbackByDay). */
export const reviewTeachers = (d: DemoRecord) => d.feedback.flatMap((day) => day.teachers);

type Option = { value: string; label: string };
/** "CUET (UG) preparation" from the picker option "CUET — CUET (UG) preparation"; an unknown code stays. */
export const programmeName = (code: string, programmes: readonly Option[]) =>
  programmes.find((p) => p.value === code)?.label.replace(`${code} — `, '') ?? code;
export const programmeNames = (codes: readonly string[], programmes: readonly Option[]) =>
  codes.map((c) => programmeName(c, programmes)).join(', ');

export const SampleBadge = ({ show }: { show: boolean }) =>
  show ? <SourceBadge source="sample" note="Sample record (development data)." /> : null;

/** Day summary → the progress-mark shapes in ops.css (each mark also has hidden text). */
const MARK: Record<DayState, string> = {
  attended: 'present',
  absent: 'absent',
  excused: 'excused',
  scheduled: 'scheduled',
  not_recorded: 'not_recorded',
  cancelled: 'cancelled',
  not_scheduled: 'cancelled',
};

/** "2 of 3 days attended": one mark per demo day (shape differs by state) plus text, never colour alone. */
export function DayMarks({
  days,
  label,
  detail,
}: {
  days: readonly { day: number; state: DayState }[];
  label: string;
  /** Second line, e.g. "4 of 5 classes attended". */
  detail?: string;
}) {
  return (
    <div className="ops-progress">
      <ol>
        {days.map((d) => (
          <li key={d.day} data-state={MARK[d.state]}>
            <span className="el-visually-hidden">
              Day {d.day}: {DAY_STATE_LABELS[d.state]}
            </span>
          </li>
        ))}
      </ol>
      <span>
        {label}
        {detail ? <span className="el-field-hint"> · {detail}</span> : null}
      </span>
    </div>
  );
}

/** "Overdue · 29 days (22 Sept)" with its urgency tone, plus "Done" for staff who may close it. */
export function FollowUpCell({
  followUp,
  canClose,
}: {
  followUp: { id?: string; dueDate: string; state: string; title: string } | null;
  /** ops:leads:write — the server re-checks permission and scope. */
  canClose?: boolean;
}) {
  if (!followUp) return <span className="el-field-hint">No open follow-up</span>;
  return (
    <div className="ops-admissions-followup">
      <Badge value={followUp.state} label={followUpAge(followUp.dueDate, istToday(new Date()))} />
      {canClose && followUp.id ? <FollowUpDone id={followUp.id} title={followUp.title} /> : null}
    </div>
  );
}

/**
 * Close a follow-up from a list; the outcome stays required (completion needs evidence, BR-OPS-11).
 * Shown on the write permission alone; an own-scope user gets the server's refusal inline.
 */
export const FollowUpDone = ({ id, title }: { id: string; title: string }) => (
  <details className="ops-search-filters ops-done">
    <summary>
      Mark done<span className="el-visually-hidden">: {title}</span>
    </summary>
    <ActionForm
      compact
      action={`/ops/api/v1/follow-ups/${id}`}
      submitLabel="Done"
      variant="secondary"
      extra={{ action: 'complete' }}
      fields={[{ name: 'outcome', label: 'What happened', required: true }]}
      labelSuffix={` for ${title}`}
    />
  </details>
);

/**
 * A demo class's attendance: the one-tap control once the class has started and is still
 * unrecorded (and the user may write), otherwise the badge and who recorded it, when.
 */
export function AttendanceCell({
  action,
  label,
  s,
  recorder,
  write,
}: {
  action: string;
  label: string;
  s: { attendance: string; startsAt: Date; recordedAt: Date | null };
  recorder: string;
  write: boolean;
}) {
  return (
    <AttendanceControl
      action={action}
      label={label}
      canRecord={write && isPending(s) && s.startsAt <= new Date()}
    >
      <Badge value={s.attendance} label={ATTENDANCE_LABELS[s.attendance as Attendance]} />
      {s.recordedAt ? (
        <span className="el-field-hint">
          {' '}
          by {recorder}, {fmtDateTime(s.recordedAt)}
        </span>
      ) : null}
    </AttendanceControl>
  );
}

export const reasonField = (label = 'Reason', required = false): FieldSpec => ({
  name: 'reason',
  label,
  type: 'textarea',
  required,
});

/** A bordered disclosure holding small forms (never a pop-up on a pop-up). */
export const Disclosure = ({ summary, children }: { summary: string; children: ReactNode }) => (
  <details className="ops-search-filters">
    <summary>{summary}</summary>
    <div className="el-stack">{children}</div>
  </details>
);
