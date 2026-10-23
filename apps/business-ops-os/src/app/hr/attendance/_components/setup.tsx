/** HR attendance: the "Schedules" and "Holidays and leave" tabs. */
import { StatusBadge } from '@elevate/shared-ui';
import { OPS_WEEKDAYS, type OpsWeeklyPattern } from '@elevate/database';
import { DECISION_STATE_LABELS, type DecisionState } from '../../../../domain/policies';
import type { AttendanceSetup } from '../../../../server/attendance-lists';
import { ActionForm, type FieldSpec } from '../../../../ui/action-form';
import { decisionTone, fmtDate } from '../../../../ui/format';
import { RecordTable } from '../../../../ui/record-table';
import { Segment } from '../../../../ui/sections';
import { API } from './days';

type Schedule = AttendanceSetup['schedules'][number];
const DAY_NAMES = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const hoursText = (p: OpsWeeklyPattern) =>
  OPS_WEEKDAYS.map((d) => `${DAY_NAMES[d]} ${p[d] ? `${p[d]!.start}–${p[d]!.end}` : 'off'}`).join(
    ' · ',
  );

const scheduleFields = (s?: Schedule): FieldSpec[] => [
  { name: 'name', label: 'Name', required: true, defaultValue: s?.name, section: 'Schedule' },
  {
    name: 'graceMinutes',
    label: 'Late grace (minutes)',
    type: 'number',
    defaultValue: String(s?.graceMinutes ?? 0),
    hint: '0 = use the HR setting "Late arrival grace".',
    section: 'Schedule',
  },
  {
    name: 'isDefault',
    label: 'Default schedule for staff without one',
    type: 'checkbox',
    defaultValue: String(s?.isDefault ?? false),
    section: 'Schedule',
  },
  ...OPS_WEEKDAYS.flatMap((d): FieldSpec[] => [
    {
      name: `weeklyPattern.${d}.start`,
      label: `${DAY_NAMES[d]} start`,
      defaultValue: s?.weeklyPattern[d]?.start,
      hint: 'HH:MM, IST. Leave both empty for a weekly off.',
      section: 'Working hours',
    },
    {
      name: `weeklyPattern.${d}.end`,
      label: `${DAY_NAMES[d]} end`,
      defaultValue: s?.weeklyPattern[d]?.end,
      section: 'Working hours',
    },
  ]),
];

export function SchedulesTab({ setup, canManage }: { setup: AttendanceSetup; canManage: boolean }) {
  const fallback = setup.schedules.find((s) => s.isDefault);
  const followers = (s: Schedule) =>
    setup.staff.filter((x) => x.scheduleId === s.id || (s.isDefault && !x.scheduleId)).length;
  return (
    <>
      <RecordTable<Schedule>
        rows={setup.schedules}
        rowKey={(s) => s.id}
        caption="Work schedules"
        empty="No work schedules yet. Until one is marked as the default, staff days cannot be checked against working hours."
        columns={[
          {
            key: 'name',
            header: 'Schedule',
            render: (s) => (
              <>
                {s.name} {s.isDefault ? <StatusBadge tone="info">Default</StatusBadge> : null}
              </>
            ),
          },
          {
            key: 'hours',
            header: 'Working hours (IST)',
            render: (s) => hoursText(s.weeklyPattern),
          },
          {
            key: 'grace',
            header: 'Late grace',
            render: (s) => (s.graceMinutes ? `${s.graceMinutes} min` : 'HR setting'),
          },
          { key: 'staff', header: 'Staff following it', numeric: true, render: followers },
          ...(canManage
            ? [
                {
                  key: 'edit',
                  header: 'Change',
                  render: (s: Schedule) => (
                    <details>
                      <summary>Edit {s.name}</summary>
                      <ActionForm
                        action={`${API}/schedules/${s.id}`}
                        method="PUT"
                        submitLabel="Save schedule"
                        labelSuffix={` — ${s.name}`}
                        fields={scheduleFields(s)}
                      />
                    </details>
                  ),
                },
              ]
            : []),
        ]}
      />
      {canManage ? (
        <>
          <Segment
            title="Choose a staff member's schedule"
            description={`Staff without their own schedule follow ${fallback ? `"${fallback.name}"` : 'the default schedule (none set yet)'}.`}
          >
            <ActionForm
              action={`${API}/schedule-assignments`}
              submitLabel="Save schedule choice"
              fields={[
                {
                  name: 'staffId',
                  label: 'Staff member',
                  type: 'select',
                  required: true,
                  options: setup.staffOptions,
                },
                {
                  name: 'scheduleId',
                  label: 'Schedule',
                  type: 'select',
                  options: setup.schedules.map((s) => ({ value: s.id, label: s.name })),
                  hint: 'Leave empty to follow the default schedule.',
                },
              ]}
            />
          </Segment>
          <Segment title="Add a schedule">
            <ActionForm
              action={`${API}/schedules`}
              submitLabel="Add schedule"
              resetOnSuccess
              fields={scheduleFields()}
            />
          </Segment>
        </>
      ) : null}
    </>
  );
}

export function CalendarTab({
  setup,
  canManage,
  canDecideHolidays,
}: {
  setup: AttendanceSetup;
  canManage: boolean;
  /** ops:hr_settings:manage: approve or remove holidays. */
  canDecideHolidays: boolean;
}) {
  type Holiday = AttendanceSetup['holidays'][number];
  type Leave = AttendanceSetup['leave'][number];
  return (
    <>
      <Segment
        title="Staff holidays"
        description="Holidays from 60 days ago onwards. Only an approved holiday changes staff days; a proposed one is shown on the day but the day is worked out as usual."
        flush
      >
        <RecordTable<Holiday>
          rows={setup.holidays}
          rowKey={(h) => h.id}
          caption="Staff holidays"
          empty="No holidays recorded."
          columns={[
            { key: 'day', header: 'Day', render: (h) => fmtDate(h.holidayOn) },
            { key: 'name', header: 'Holiday', render: (h) => h.name },
            { key: 'branch', header: 'Applies to', render: (h) => h.branchName ?? 'Every branch' },
            {
              key: 'state',
              header: 'Decision',
              render: (h) => (
                <StatusBadge tone={decisionTone(h.decisionState)}>
                  {DECISION_STATE_LABELS[h.decisionState as DecisionState]}
                </StatusBadge>
              ),
            },
            ...(canDecideHolidays
              ? [
                  {
                    key: 'act',
                    header: 'Action',
                    render: (h: Holiday) => (
                      <>
                        {h.decisionState === 'proposed' ? (
                          <ActionForm
                            action={`${API}/holidays/${h.id}`}
                            extra={{ action: 'approve' }}
                            submitLabel="Approve"
                            successText="Approved."
                            labelSuffix={` — ${h.name}`}
                            compact
                          />
                        ) : null}
                        {h.decisionState === 'locked' ? null : (
                          <ActionForm
                            action={`${API}/holidays/${h.id}`}
                            extra={{ action: 'remove' }}
                            submitLabel="Remove"
                            successText="Removed."
                            labelSuffix={` — ${h.name}`}
                            variant="secondary"
                            compact
                          />
                        )}
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Segment>
      {canManage ? (
        <Segment title="Add a holiday">
          <ActionForm
            action={`${API}/holidays`}
            submitLabel="Add holiday"
            resetOnSuccess
            fields={[
              { name: 'holidayOn', label: 'Day', type: 'date', required: true },
              { name: 'name', label: 'Name', required: true },
              {
                name: 'branchId',
                label: 'Branch',
                type: 'select',
                options: setup.branches,
                hint: 'Empty = every branch.',
              },
            ]}
          />
        </Segment>
      ) : null}
      <Segment
        title="Approved leave"
        description="Leave ending in the last 60 days or later."
        flush
      >
        <RecordTable<Leave>
          rows={setup.leave}
          rowKey={(l) => l.id}
          caption="Approved leave"
          empty="No leave recorded."
          columns={[
            { key: 'staff', header: 'Staff member', render: (l) => l.staffName },
            {
              key: 'dates',
              header: 'Dates',
              render: (l) => `${fmtDate(l.fromDate)} to ${fmtDate(l.toDate)}`,
            },
            { key: 'kind', header: 'Kind', render: (l) => l.kind },
            { key: 'reason', header: 'Reason', render: (l) => l.reason ?? 'Not recorded' },
            {
              key: 'status',
              header: 'Status',
              render: (l) => (
                <>
                  <StatusBadge tone={l.status === 'approved' ? 'success' : 'neutral'}>
                    {l.status === 'approved' ? 'Approved' : 'Cancelled'}
                  </StatusBadge>
                  {l.isSample ? (
                    <span className="el-badge el-badge-sample">Sample data</span>
                  ) : null}
                </>
              ),
            },
            ...(canManage
              ? [
                  {
                    key: 'act',
                    header: 'Action',
                    render: (l: Leave) =>
                      l.status === 'approved' ? (
                        <details>
                          <summary>Cancel leave</summary>
                          <ActionForm
                            action={`${API}/leave/${l.id}`}
                            submitLabel="Cancel this leave"
                            successText="Leave cancelled."
                            labelSuffix={` — ${l.staffName}`}
                            variant="danger"
                            fields={[
                              { name: 'reason', label: 'Why', type: 'textarea', required: true },
                            ]}
                          />
                        </details>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      </Segment>
      {canManage ? (
        <Segment
          title="Record approved leave"
          description="Leave requests are not handled here; record leave that has been approved."
        >
          <ActionForm
            action={`${API}/leave`}
            submitLabel="Record leave"
            resetOnSuccess
            fields={[
              {
                name: 'staffId',
                label: 'Staff member',
                type: 'select',
                required: true,
                options: setup.staffOptions,
              },
              { name: 'fromDate', label: 'First day', type: 'date', required: true },
              { name: 'toDate', label: 'Last day', type: 'date', required: true },
              {
                name: 'kind',
                label: 'Kind of leave',
                required: true,
                hint: 'In your own words, e.g. Casual leave.',
              },
              { name: 'reason', label: 'Reason (optional)', type: 'textarea' },
            ]}
          />
        </Segment>
      ) : null}
    </>
  );
}
