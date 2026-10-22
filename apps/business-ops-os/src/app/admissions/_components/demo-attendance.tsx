/**
 * Demo attendance tab (brief §5): each demo day with its classes (time, subject, teacher of record
 * and substitute, attendance, recorder), forms to record or correct a class, add a class to a
 * day, mock status and the append-only change history.
 */
import { can } from '@elevate/authorization';
import { EmptyState } from '@elevate/shared-ui';
import {
  ATTENDANCE_LABELS,
  DAY_STATE_LABELS,
  MOCK_LABELS,
  MOCK_STATUSES,
  type MockStatus,
} from '../../../domain/demos';
import type { DemoRecord } from '../../../server/demos';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import {
  AttendanceCell,
  Badge,
  Disclosure,
  linkOf,
  reasonField,
  ReviewBadge,
  reviewTeachers,
} from './demo-bits';
import { nameOf, type DemoTabProps } from './demo-record';

type Session = DemoRecord['sessions'][number];
const RECORD_OPTIONS = (
  ['present', 'late', 'absent', 'excused', 'not_recorded', 'scheduled'] as const
).map((a) => ({ value: a, label: a === 'scheduled' ? 'Back to scheduled' : ATTENDANCE_LABELS[a] }));

export function DemoAttendance({ d, user, options, level }: DemoTabProps) {
  const write = can(user, 'ops:leads:write');
  const open = d.demo.outcome === 'open';
  const api = (s: Session) => `/ops/api/v1/demos/${d.demo.id}/sessions/${s.id}`;
  const teachers = reviewTeachers(d);
  const title = (s: Session) =>
    `Day ${s.dayNumber}, class ${s.sessionNumber} · ${s.subject ?? 'Class'} · ${fmtDateTime(s.startsAt)}`;
  const extension = d.extension.value;
  const lastDay = d.demo.plannedDayCount + (extension.allowed ? extension.maxExtraDays : 0);
  const showChange = (field: string, v: string | null) => {
    if (field === 'schedule' && v) return fmtDateTime(v);
    if (field !== 'teacher') return humanise(v);
    return v ? (d.teacherNames[v] ?? v) : 'Unassigned';
  };
  return (
    <>
      {d.academicMarks.status === 'unavailable' ? (
        <p className="el-field-hint">
          Academic OS could not be reached (checked {fmtDateTime(d.academicMarks.checkedAt)}):
          teachers' marks for classes linked there are not shown.
        </p>
      ) : null}
      <p className="el-field-hint">
        Record a class with one tap once it has started. A day counts as attended when the student
        was present or late in at least one class; absent, excused and unrecorded classes never
        count. Changing a recorded value needs a reason and is kept in the change history.
      </p>
      {d.days.map((day) => (
        <Segment
          key={day.day}
          title={`Day ${day.day}${day.extra ? ' (extra day)' : ''}`}
          level={level}
          flush
          meta={<Badge value={day.state} label={DAY_STATE_LABELS[day.state]} />}
          description={day.dates.length ? day.dates.map(fmtDate).join(', ') : 'No date yet'}
        >
          <RecordTable
            rows={day.sessions}
            rowKey={(s) => s.id}
            empty={<EmptyState title="No class booked for this day" />}
            columns={[
              { key: 'n', header: 'Class', numeric: true, render: (s) => s.sessionNumber },
              { key: 'when', header: 'Time', render: (s) => fmtDateTime(s.startsAt) },
              { key: 'subject', header: 'Subject', render: (s) => s.subject ?? 'Not set' },
              {
                key: 'teacher',
                header: 'Teacher',
                render: (s) =>
                  s.teacherName
                    ? `${s.teacherName}${s.isSubstitute ? ' (substitute)' : ''}`
                    : 'Not assigned',
              },
              {
                key: 'attendance',
                header: 'Attendance',
                render: (s) => (
                  <AttendanceCell
                    action={api(s)}
                    label={title(s)}
                    s={s}
                    recorder={nameOf(d, s.recordedBy)}
                    write={write}
                    linked={linkOf(d, s)}
                  />
                ),
              },
              {
                key: 'review',
                header: 'Teacher review',
                render: (s) => (
                  <ReviewBadge
                    state={teachers.find((t) => t.sessionIds.includes(s.id))?.state ?? 'not_due'}
                  />
                ),
              },
              { key: 'notes', header: 'Notes', render: (s) => s.exceptionReason ?? s.notes ?? '—' },
            ]}
          />
        </Segment>
      ))}
      {write ? (
        <Segment title="Record or correct a class" level={level}>
          <div className="el-stack">
            {d.sessions.map((s) => (
              <Disclosure key={s.id} summary={title(s)}>
                {linkOf(d, s) ? (
                  <p className="el-field-hint">
                    {linkOf(d, s) === 'unavailable'
                      ? 'Waiting for Academic OS: it could not be reached, so it is not known whether this class is recorded there.'
                      : 'This class is linked to an Academic OS class: its teacher records attendance there.'}
                  </p>
                ) : (
                  <ActionForm
                    compact
                    action={api(s)}
                    submitLabel="Record attendance"
                    extra={{ action: 'attendance' }}
                    fields={[
                      {
                        name: 'attendance',
                        label: 'Attendance',
                        type: 'select',
                        required: true,
                        options: RECORD_OPTIONS,
                      },
                      reasonField('Reason (to change a recorded value)'),
                      { name: 'notes', label: 'Notes or topics' },
                    ]}
                  />
                )}
                {open ? (
                  <>
                    <ActionForm
                      compact
                      action={api(s)}
                      submitLabel="Save teacher"
                      extra={{ action: 'assign' }}
                      variant="secondary"
                      fields={[
                        {
                          name: 'teacherStaffId',
                          label: 'Teacher who taught',
                          type: 'select',
                          defaultValue: s.teacherStaffId ?? '',
                          options: options.staff,
                        },
                        {
                          name: 'subject',
                          label: 'Subject',
                          required: true,
                          defaultValue: s.subject ?? '',
                        },
                        {
                          name: 'isSubstitute',
                          label: 'Substitute for the planned teacher',
                          type: 'checkbox',
                          defaultValue: String(s.isSubstitute),
                        },
                        reasonField('Reason (needed once the class is recorded)'),
                      ]}
                    />
                    <ActionForm
                      compact
                      action={api(s)}
                      submitLabel="Reschedule class"
                      extra={{ action: 'reschedule' }}
                      variant="secondary"
                      fields={[
                        {
                          name: 'startsAt',
                          label: 'New start (IST)',
                          type: 'datetime',
                          required: true,
                        },
                        {
                          name: 'wholeDay',
                          label: `Move all of day ${s.dayNumber} (each class shifts by the same time)`,
                          type: 'checkbox',
                        },
                        reasonField('Reason', true),
                      ]}
                    />
                    <ActionForm
                      compact
                      action={api(s)}
                      submitLabel="Cancel class"
                      extra={{ action: 'cancel' }}
                      variant="danger"
                      fields={[reasonField('Reason', true)]}
                    />
                  </>
                ) : (
                  <p className="el-field-hint">
                    Teacher, reschedule and cancel close with the demo.
                  </p>
                )}
              </Disclosure>
            ))}
            {open ? (
              <Disclosure summary="Add a class to a day">
                <p className="el-field-hint">
                  Extra demo days:{' '}
                  {extension.allowed ? `up to ${extension.maxExtraDays}, with a reason` : 'off'} (
                  {d.extension.decisionState} setting). A demo never gets another day otherwise.
                </p>
                <ActionForm
                  compact
                  action={`/ops/api/v1/demos/${d.demo.id}/sessions`}
                  submitLabel="Add class"
                  fields={[
                    {
                      name: 'dayNumber',
                      label: 'Day',
                      type: 'select',
                      required: true,
                      options: Array.from({ length: lastDay }, (_, i) => ({
                        value: String(i + 1),
                        label: `Day ${i + 1}${i + 1 > d.demo.plannedDayCount ? ' (extra)' : ''}`,
                      })),
                    },
                    { name: 'startsAt', label: 'Start (IST)', type: 'datetime', required: true },
                    { name: 'subject', label: 'Subject', required: true },
                    {
                      name: 'teacherStaffId',
                      label: 'Teacher',
                      type: 'select',
                      options: options.staff,
                    },
                    reasonField('Reason (required for an extra day)'),
                  ]}
                />
              </Disclosure>
            ) : null}
          </div>
        </Segment>
      ) : null}
      <Segment
        title="Mock test"
        level={level}
        flush
        meta={<Badge value={d.mock} label={MOCK_LABELS[d.mock]} />}
        description="A mock result is linked only by reference to a real assessment record."
      >
        <RecordTable
          rows={d.sessions}
          rowKey={(s) => s.id}
          columns={[
            { key: 'n', header: 'Class', numeric: true, render: (s) => s.sessionNumber },
            {
              key: 'status',
              header: 'Mock status',
              render: (s) => (
                <Badge value={s.mockStatus} label={MOCK_LABELS[s.mockStatus as MockStatus]} />
              ),
            },
            { key: 'ref', header: 'Result reference', render: (s) => s.mockAttemptRef ?? '—' },
            ...(write
              ? [
                  {
                    key: 'update',
                    header: 'Update',
                    render: (s: Session) => (
                      <ActionForm
                        compact
                        action={api(s)}
                        submitLabel="Save"
                        extra={{ action: 'mock' }}
                        variant="secondary"
                        fields={[
                          {
                            name: 'mockStatus',
                            label: 'Status',
                            type: 'select',
                            required: true,
                            defaultValue: s.mockStatus,
                            options: MOCK_STATUSES.map((m) => ({
                              value: m,
                              label: MOCK_LABELS[m],
                            })),
                          },
                          { name: 'mockAttemptRef', label: 'Result reference (completed only)' },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Segment>
      <Segment title="Change history" level={level} flush>
        <RecordTable
          rows={d.changes}
          rowKey={(c) => c.id}
          empty="No changes yet."
          columns={[
            { key: 'at', header: 'When', render: (c) => fmtDateTime(c.at) },
            {
              key: 'session',
              header: 'Class',
              render: (c) => {
                const s = d.sessions.find((x) => x.id === c.sessionId);
                return s ? `Day ${s.dayNumber}, class ${s.sessionNumber}` : '—';
              },
            },
            {
              key: 'change',
              header: 'Change',
              render: (c) =>
                `${humanise(c.field)}: ${showChange(c.field, c.previousValue)} → ${showChange(c.field, c.newValue)}`,
            },
            { key: 'reason', header: 'Reason', render: (c) => c.reason ?? '—' },
            { key: 'by', header: 'By', render: (c) => nameOf(d, c.actorUserId) },
          ]}
        />
      </Segment>
    </>
  );
}
