/** HR attendance: the "Days" and "Needs review" tabs (filters, chart, day table, punch entry). */
import { BarChart, EmptyState } from '@elevate/shared-ui';
import {
  ATTENDANCE_STATUS_LABELS,
  REVIEW_REASON_LABELS,
  type AttendanceStatus,
} from '../../../../domain/attendance';
import type { listAttendance } from '../../../../server/attendance';
import type { AttendanceSetup } from '../../../../server/attendance-lists';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate } from '../../../../ui/format';
import { listHref, Pager, SearchPanel } from '../../../../ui/list-controls';
import { Segment } from '../../../../ui/sections';
import { DayTable, statusOptions } from './shared';

type Params = Record<string, string | undefined>;
export const BASE = '/ops/hr/attendance';
export const API = '/ops/api/v1/attendance';

export function DaysTab({
  list,
  setup,
  params,
  review,
  canManage,
}: {
  list: Awaited<ReturnType<typeof listAttendance>>;
  setup: AttendanceSetup;
  params: Params;
  review: boolean;
  canManage: boolean;
}) {
  const hidden: Record<string, string> = review ? { tab: 'review' } : {};
  const range = `${fmtDate(list.from)} to ${fmtDate(list.to)}`;
  const known = setup.staff.length > 0;
  return (
    <>
      <SearchPanel
        action={BASE}
        hidden={hidden}
        search={{ name: 'q', label: 'Staff name or code', value: params.q }}
        filters={[
          { name: 'from', label: 'From', type: 'date', value: params.from },
          { name: 'to', label: 'To', type: 'date', value: params.to },
          review
            ? {
                name: 'review',
                label: 'Reason',
                type: 'select',
                value: params.review,
                options: Object.entries(REVIEW_REASON_LABELS).map(([value, label]) => ({
                  value,
                  label,
                })),
              }
            : {
                name: 'status',
                label: 'Status',
                type: 'select',
                options: statusOptions,
                value: params.status,
              },
          {
            name: 'department',
            label: 'Department',
            type: 'select',
            options: setup.departments,
            value: params.department,
          },
          {
            name: 'branch',
            label: 'Branch',
            type: 'select',
            options: setup.branches,
            value: params.branch,
          },
        ]}
      />
      {review ? null : (
        <Segment
          title="Attendance by date"
          description={`Staff present each day, ${range}. Hover a bar for the other statuses.`}
        >
          <BarChart
            label="Staff present per day"
            orientation="vertical"
            data={list.byDate.map((d) => ({
              label: fmtDate(d.date),
              value: known ? (d.counts.present ?? 0) : null,
              note: Object.entries(d.counts)
                .filter(([s]) => s !== 'present')
                .map(([s, n]) => `${ATTENDANCE_STATUS_LABELS[s as AttendanceStatus]} ${n}`)
                .join(', '),
            }))}
            emptyText="No staff records match these filters."
          />
        </Segment>
      )}
      <DayTable
        staff
        rows={list.items}
        caption={`${list.total} ${review ? 'days needing review' : 'staff days'}, ${range}, newest first`}
        rowHref={(r) => `${BASE}/${r.staff.id}?date=${r.date}`}
        empty={
          <EmptyState
            title={review ? 'Nothing needs review' : 'No days match'}
            description={
              review
                ? 'Every working day in this range has a check-in and check-out, a decision, leave or a holiday.'
                : 'Widen the dates or clear a filter.'
            }
          />
        }
      />
      <Pager
        basePath={BASE}
        params={{ ...params, ...hidden }}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
      {canManage ? <PunchForm staffOptions={setup.staffOptions} /> : null}
    </>
  );
}

/** Manual entry of one punch; `staffId` fixed on a staff page. */
export function PunchForm({
  staffOptions,
  staffId,
  date,
}: {
  staffOptions?: { value: string; label: string }[];
  staffId?: string;
  date?: string;
}) {
  return (
    <Segment
      title="Enter a check-in or check-out"
      description="For a day the person worked but has no punch. The entry is recorded as entered by you."
    >
      <ActionForm
        action={`${API}/punches`}
        submitLabel="Save punch"
        successText="Punch saved."
        resetOnSuccess
        extra={staffId ? { staffId } : undefined}
        fields={[
          ...(staffId
            ? []
            : [
                {
                  name: 'staffId',
                  label: 'Staff member',
                  type: 'select' as const,
                  required: true,
                  options: staffOptions,
                },
              ]),
          {
            name: 'at',
            label: 'Date and time (IST)',
            type: 'datetime',
            required: true,
            defaultValue: date ? `${date}T09:00` : undefined,
          },
          {
            name: 'direction',
            label: 'Direction',
            type: 'select',
            required: true,
            options: [
              { value: 'in', label: 'Check-in' },
              { value: 'out', label: 'Check-out' },
            ],
          },
          {
            name: 'note',
            label: 'Note (optional)',
            hint: 'Where the time came from, e.g. the register at the front desk.',
          },
        ]}
      />
    </Segment>
  );
}

export const tabHref = (tab: string) => listHref(BASE, { tab: tab || undefined });
