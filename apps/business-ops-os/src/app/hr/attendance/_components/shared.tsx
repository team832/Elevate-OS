/**
 * Pieces shared by HR attendance, the staff attendance page and My attendance: status badges,
 * the legend, the day table and the corrections table.
 */
import { StatusBadge, type Tone } from '@elevate/shared-ui';
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUSES,
  isNoScheduleDay,
  REVIEW_REASON_LABELS,
  SHOWN_STATUS_LABELS,
  SHOWN_STATUSES,
  type AttendanceStatus,
} from '../../../../domain/attendance';
import { LEAVE_DAY_PART_LABELS, type LeaveDayPart } from '../../../../domain/leave';
import type { AttendanceRow } from '../../../../server/attendance';
import type { listCorrections } from '../../../../server/attendance-corrections';
import { fmtDate, fmtDateTime } from '../../../../ui/format';
import { RecordTable } from '../../../../ui/record-table';
import type { Column } from '@elevate/shared-ui';
import type { ReactNode } from 'react';

const TONE: Record<AttendanceStatus, Tone> = {
  present: 'success',
  half_day: 'info',
  absent: 'danger',
  unmarked: 'warning',
  on_leave: 'info',
  holiday: 'neutral',
  weekly_off: 'neutral',
};

const MEANING: Record<AttendanceStatus, string> = {
  present:
    'Checked in and out for at least the full-day hours, or checked in with no check-out yet.',
  half_day: 'Checked in and out for at least the half-day hours but less than a full day.',
  absent: 'HR confirmed an absence. Never set automatically.',
  unmarked:
    'A working day with no check-in (or a very short day) and no HR decision yet. Not an absence.',
  on_leave: 'Approved leave: an application HR approved, or leave HR recorded.',
  holiday:
    'An approved staff holiday for everyone or for this branch. A proposed holiday does not change the day.',
  weekly_off: 'Not a working day in the work schedule.',
};

/** What HR may decide a day is: never On leave, which only a leave record sets (the server refuses it). */
export const statusOptions = ATTENDANCE_STATUSES.filter((s) => s !== 'on_leave').map((s) => ({
  value: s,
  label: ATTENDANCE_STATUS_LABELS[s],
}));
/** What the list can show: the words on its rows. */
export const statusFilterOptions = SHOWN_STATUSES.map((s) => ({
  value: s,
  label: SHOWN_STATUS_LABELS[s],
}));

export function AttendanceBadge({
  status,
  basis,
  scheduled,
  leavePart,
}: {
  status: AttendanceStatus;
  basis?: string;
  /** null = no work schedule is known, so nothing can be judged about an unrecorded day. */
  scheduled?: boolean | null;
  /** On leave for one half only (F4-12). */
  leavePart?: LeaveDayPart | null;
}) {
  if (scheduled !== undefined && isNoScheduleDay({ status, scheduled, basis: basis as never }))
    return <StatusBadge>{SHOWN_STATUS_LABELS.no_schedule}</StatusBadge>;
  const half = status === 'on_leave' && leavePart;
  return (
    <>
      <StatusBadge tone={TONE[status]}>
        {half ? SHOWN_STATUS_LABELS.half_day_leave : ATTENDANCE_STATUS_LABELS[status]}
      </StatusBadge>
      {half ? <span className="el-field-hint"> ({LEAVE_DAY_PART_LABELS[half]})</span> : null}
      {basis === 'hr_decision' ? <span className="el-field-hint"> Decided by HR</span> : null}
    </>
  );
}

const time = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
});
/** "4:42 pm" (IST). */
export const timeText = (d: Date | string | null | undefined) =>
  d ? time.format(new Date(d)).toLowerCase() : 'Not recorded';

export function Legend() {
  return (
    <details className="el-explain">
      <summary>What each status means</summary>
      <dl>
        {ATTENDANCE_STATUSES.map((s) => (
          <div key={s}>
            <dt>
              <AttendanceBadge status={s} />
            </dt>
            <dd>{MEANING[s]}</dd>
          </div>
        ))}
        <div>
          <dt>
            <AttendanceBadge status="on_leave" leavePart="first_half" />
          </dt>
          <dd>
            Approved leave for the first or second half of the day only: 0.5 of a day where HR set
            an allowance, and one of the days on leave in the totals.
          </dd>
        </div>
        <div>
          <dt>
            <AttendanceBadge status="unmarked" scheduled={null} />
          </dt>
          <dd>
            No work schedule is set for this person, so the system cannot say whether this was a
            working day. Nothing is wrong with the day. The Status filter lists them under No schedule.
          </dd>
        </div>
      </dl>
      <p>
        Statuses come from check-ins and check-outs (entered by HR or imported from a file), the
        work schedule, holidays and approved leave, using the HR settings for late grace and
        half-day and full-day hours. No biometric device is connected. Classes taught and teaching logs are separate records in Academic OS and never
        change attendance.
      </p>
    </details>
  );
}

/** Day rows; `staff` adds the name column (HR lists). */
export function DayTable({
  rows,
  caption,
  empty,
  staff,
  rowHref,
}: {
  rows: AttendanceRow[];
  caption: string;
  empty: ReactNode;
  staff?: boolean;
  rowHref?: (r: AttendanceRow) => string;
}) {
  const columns: Column<AttendanceRow>[] = [
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    ...(staff
      ? [
          {
            key: 'staff',
            header: 'Staff member',
            render: (r: AttendanceRow) =>
              r.staff.staffCode ? `${r.staff.name} (${r.staff.staffCode})` : r.staff.name,
          },
        ]
      : []),
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <AttendanceBadge
          status={r.status}
          basis={r.basis}
          scheduled={r.scheduled}
          leavePart={r.leavePart}
        />
      ),
    },
    { key: 'in', header: 'First in', render: (r) => (r.firstIn ? timeText(r.firstIn) : '—') },
    { key: 'out', header: 'Last out', render: (r) => (r.lastOut ? timeText(r.lastOut) : '—') },
    {
      key: 'late',
      header: 'Late',
      render: (r) =>
        r.lateMinutes ? `${r.lateMinutes} min late` : r.lateMinutes === 0 ? 'On time' : '—',
    },
    {
      key: 'review',
      header: 'Needs review',
      render: (r) =>
        [
          ...r.reasons.map((x) => REVIEW_REASON_LABELS[x]),
          r.proposedHoliday && 'Proposed holiday (not applied)',
          r.note,
        ]
          .filter(Boolean)
          .join('. '),
    },
  ];
  return (
    <RecordTable
      rows={rows}
      rowKey={(r) => `${r.staff.id}:${r.date}`}
      caption={caption}
      empty={empty}
      columns={columns}
      rowHref={rowHref}
      linkColumn={staff ? 'staff' : 'date'}
      pageScroll={!staff}
    />
  );
}

type Correction = Awaited<ReturnType<typeof listCorrections>>['items'][number];

/** What a request asks for, in words. */
export const requestedText = (c: Correction) =>
  [
    c.requestedStatus && `Status: ${ATTENDANCE_STATUS_LABELS[c.requestedStatus]}`,
    c.requestedIn && `Check-in ${timeText(c.requestedIn)}`,
    c.requestedOut && `Check-out ${timeText(c.requestedOut)}`,
  ]
    .filter(Boolean)
    .join(' · ');

const DECISION_TONE = { pending: 'info', approved: 'success', rejected: 'neutral' } as const;

export function CorrectionsTable({
  rows,
  staff,
  actions,
  empty,
}: {
  rows: Correction[];
  staff?: boolean;
  actions?: (c: Correction) => ReactNode;
  empty: string;
}) {
  return (
    <RecordTable<Correction>
      rows={rows}
      rowKey={(c) => c.id}
      caption={`${rows.length} correction ${rows.length === 1 ? 'request' : 'requests'}, newest first`}
      empty={empty}
      columns={[
        { key: 'day', header: 'Day', render: (c) => fmtDate(c.workDate) },
        ...(staff
          ? [{ key: 'staff', header: 'Staff member', render: (c: Correction) => c.staffName }]
          : []),
        { key: 'asks', header: 'Asks for', render: (c) => requestedText(c) },
        { key: 'reason', header: 'Reason', render: (c) => c.reason },
        { key: 'sent', header: 'Sent', render: (c) => fmtDateTime(c.createdAt) },
        {
          key: 'status',
          header: 'Decision',
          render: (c) => (
            <>
              <StatusBadge tone={DECISION_TONE[c.status]}>
                {c.status === 'pending'
                  ? 'Waiting for HR'
                  : c.status === 'approved'
                    ? 'Approved'
                    : 'Rejected'}
              </StatusBadge>
              {c.decisionNote ? <p className="el-field-hint">{c.decisionNote}</p> : null}
              {c.decidedAt ? <p className="el-field-hint">{fmtDateTime(c.decidedAt)}</p> : null}
            </>
          ),
        },
        ...(actions ? [{ key: 'action', header: 'Action', render: actions }] : []),
      ]}
    />
  );
}
