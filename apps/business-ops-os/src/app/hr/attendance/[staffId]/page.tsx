/**
 * /ops/hr/attendance/[staffId]?date= — one person's attendance: the chosen day (raw punches with
 * their source, status, HR decision), their month, and their correction requests. For a teacher,
 * Academic's classes for the day are shown beside it as a different fact (scenario 10): they never
 * change attendance.
 */
import { can, type Principal } from '@elevate/authorization';
import { isIsoDate } from '@elevate/shared-types';
import type { Metric } from '@elevate/shared-contracts';
import { PageHeader } from '@elevate/shared-ui';
import { monthRange } from '../../../../domain/attendance';
import { addDays, istToday, type IsoDate } from '../../../../domain/dates';
import { fetchTeacherActivity } from '../../../../server/academic-summary';
import { attendanceDay, listAttendance } from '../../../../server/attendance';
import { listCorrections } from '../../../../server/attendance-corrections';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, fmtMonth } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { DetailTable, Segment } from '../../../../ui/sections';
import { API, BASE, PunchForm } from '../_components/days';
import {
  AttendanceBadge,
  CorrectionsTable,
  DayTable,
  Legend,
  statusOptions,
  timeText,
} from '../_components/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff attendance' };

type Params = Record<string, string | undefined>;

export default async function StaffAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ staffId: string }>;
  searchParams: Promise<Params>;
}) {
  const { staffId } = await params;
  const access = await gate('ops:attendance:read', `${BASE}/${staffId}`);
  return (
    <Frame access={access} active="hr-attendance">
      <Section label="Loading attendance…">
        <StaffAttendance user={access.user} staffId={staffId} query={await searchParams} />
      </Section>
    </Frame>
  );
}

const metricText = (m: Metric) => (m.status === 'missing' ? 'Not recorded' : String(m.value));

async function StaffAttendance({
  user,
  staffId,
  query,
}: {
  user: Principal;
  staffId: string;
  query: Params;
}) {
  const yesterday = addDays(istToday(new Date()), -1);
  const date = (
    isIsoDate(query.date) && query.date <= istToday(new Date()) ? query.date : yesterday
  ) as IsoDate;
  const month = /^\d{4}-\d{2}$/.test(query.month ?? '') ? query.month! : date.slice(0, 7);
  const result = await load(async (db) => {
    const day = await attendanceDay(db, user, staffId, date);
    return {
      ...day,
      monthDays: await listAttendance(db, user, { staffId, ...monthRange(month), page: 1 }),
      corrections: await listCorrections(db, user, { staffId }),
    };
  });
  if (!result.ok) return result.view;
  const { staff, day, punches, monthDays, corrections } = result.data;
  // Network call outside any transaction; never feeds the attendance status.
  const academic = await fetchTeacherActivity(staff.id, { from: date, to: date });
  const canManage = can(user, 'ops:attendance:manage');
  const prev = monthRange(month).from;
  const here = `${BASE}/${staff.id}`;
  return (
    <>
      <PageHeader
        title={staff.name}
        description={
          [staff.staffCode && `Employee ID ${staff.staffCode}`, staff.departmentName]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={<a href={BASE}>All staff attendance</a>}
      />
      <Legend />
      <div className="ops-panels">
        <Segment
          title={`Attendance on ${fmtDate(date)}`}
          meta={day ? <AttendanceBadge status={day.status} basis={day.basis} /> : null}
          flush
        >
          <DetailTable
            rows={[
              {
                label: 'First check-in',
                value: day?.firstIn ? timeText(day.firstIn) : 'Not recorded',
              },
              {
                label: 'Last check-out',
                value: day?.lastOut
                  ? timeText(day.lastOut)
                  : day?.missingCheckout
                    ? 'Missing'
                    : 'Not recorded',
              },
              {
                label: 'Late',
                value: day?.lateMinutes
                  ? `${day.lateMinutes} minutes after the start`
                  : day?.lateMinutes === 0
                    ? 'On time'
                    : 'Not applicable',
              },
              day?.basis === 'hr_decision' && {
                label: 'HR decision',
                value: day.note ?? 'No note',
              },
              {
                label: 'Punches',
                value: punches.length ? (
                  <ul>
                    {punches.map((p) => (
                      <li key={p.id}>
                        {p.direction === 'in' ? 'Check-in' : 'Check-out'} {timeText(p.punchedAt)} —{' '}
                        {p.source === 'import'
                          ? `imported from a file (${p.sourceRef})`
                          : (p.sourceRef ?? 'entered by HR')}
                        {p.isSample ? (
                          <span className="el-badge el-badge-sample">Sample data</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  'None recorded'
                ),
              },
            ]}
          />
        </Segment>
        <Segment
          title="Classes delivered (Academic)"
          description="A different record from attendance: being present does not mean every class was taught, and a missing teaching log does not mean absent."
          flush
        >
          {academic.status === 'available' ? (
            academic.data.assignments.length === 0 && academic.data.sessions.planned.value === 0 ? (
              <p className="el-field-hint">
                No teaching assignments or classes in Academic OS for this day.
              </p>
            ) : (
              <DetailTable
                rows={[
                  { label: 'Classes scheduled', value: metricText(academic.data.sessions.planned) },
                  {
                    label: 'Classes delivered',
                    value: metricText(academic.data.sessions.delivered),
                  },
                  { label: 'Teaching logs pending', value: metricText(academic.data.logsPending) },
                ]}
              />
            )
          ) : (
            <p className="el-field-hint">
              Source unavailable (checked {fmtDateTime(academic.fetchedAt)}).
            </p>
          )}
        </Segment>
      </div>
      {canManage ? (
        <>
          <Segment
            title="Decide this day"
            description="Your decision replaces the computed status and stays even when new punches arrive. Say why."
          >
            <ActionForm
              action={`${API}/decisions`}
              submitLabel="Save decision"
              successText="Decision saved."
              extra={{ staffId: staff.id, workDate: date }}
              fields={[
                {
                  name: 'status',
                  label: 'Status',
                  type: 'select',
                  required: true,
                  options: statusOptions,
                  defaultValue: day?.status,
                },
                { name: 'note', label: 'Reason', type: 'textarea', required: true },
              ]}
            />
          </Segment>
          <PunchForm staffId={staff.id} date={date} />
        </>
      ) : null}
      <Segment
        title={fmtMonth(month)}
        actions={
          <>
            <a href={`${here}?month=${addDays(prev, -1).slice(0, 7)}&date=${date}`}>
              Previous month
            </a>{' '}
            <a href={`${here}?month=${addDays(monthRange(month).to, 1).slice(0, 7)}&date=${date}`}>
              Next month
            </a>
          </>
        }
        flush
      >
        <DayTable
          rows={monthDays.items}
          caption={`${staff.name}: ${monthDays.total} days in ${fmtMonth(month)} up to today`}
          empty="No days to show yet for this month."
          rowHref={(r) => `${here}?date=${r.date}&month=${month}`}
        />
      </Segment>
      <Segment title="Correction requests" flush>
        <CorrectionsTable
          rows={corrections.items}
          empty={`${staff.name} has not asked for any corrections.`}
        />
      </Segment>
    </>
  );
}
