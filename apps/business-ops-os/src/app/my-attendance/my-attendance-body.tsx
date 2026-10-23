/**
 * `<base>/my-attendance` (owner brief 23 Oct 2026 §12, D-073): your own days for a month, what the
 * statuses mean, a correction request form and your requests. Shown in Ops, Academic and Marketing.
 * The person is always the signed-in user; nothing in the URL can point it at someone else.
 */
import { EmptyState, PageHeader, StatCard } from '@elevate/shared-ui';
import {
  monthRange,
  REQUESTABLE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  summariseDays,
} from '../../domain/attendance';
import { addDays, istToday } from '../../domain/dates';
import { listAttendance } from '../../server/attendance';
import { listCorrections } from '../../server/attendance-corrections';
import { staffIdForUser } from '../../server/context';
import { ActionForm } from '../../ui/action-form';
import { fmtMonth } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { Segment } from '../../ui/sections';
import { CorrectionsTable, DayTable, Legend } from '../hr/attendance/_components/shared';
import type { BodyProps } from '../tasks/_components/bodies';
import '../ops.css';

export function MyAttendanceBody(props: BodyProps) {
  return (
    <Section label="Loading your attendance…">
      <MyAttendance {...props} />
    </Section>
  );
}

async function MyAttendance({ user, base, searchParams }: BodyProps) {
  const thisMonth = istToday(new Date()).slice(0, 7);
  const month =
    /^\d{4}-\d{2}$/.test(searchParams.month ?? '') && searchParams.month! <= thisMonth
      ? searchParams.month!
      : thisMonth;
  const range = monthRange(month);
  const result = await load(async (db) => {
    const staffId = await staffIdForUser(db, user.id);
    if (!staffId) return null;
    return {
      days: await listAttendance(db, user, { staffId, ...range, page: 1 }),
      requests: await listCorrections(db, user, { staffId }),
    };
  });
  const header = (
    <PageHeader
      title="My attendance"
      description={`Your check-ins, check-outs and daily status for ${fmtMonth(month)}.`}
    />
  );
  if (!result.ok)
    return (
      <>
        {header}
        {result.view}
      </>
    );
  if (!result.data)
    return (
      <>
        {header}
        <EmptyState
          title="No staff record"
          description="Your login is not linked to a staff record yet, so there is no attendance to show. Ask HR to link it."
        />
      </>
    );
  const { days, requests } = result.data;
  const sum = summariseDays(days.items);
  const page = `${base}/my-attendance`;
  const monthLink = (d: string) => `${page}?month=${d.slice(0, 7)}`;
  return (
    <>
      {header}
      <ul className="el-grid ops-kpis" aria-label={`Summary for ${fmtMonth(month)}`}>
        <li>
          <StatCard
            label="Working days so far"
            value={sum.scheduledWorkdays}
            missingLabel="No work schedule"
            note="In your schedule, holidays left out"
          />
        </li>
        <li>
          <StatCard label="Present" value={sum.present} />
        </li>
        <li>
          <StatCard label="Half days" value={sum.halfDays} />
        </li>
        <li>
          <StatCard label="On leave" value={sum.leave} />
        </li>
        <li>
          <StatCard
            label="Unmarked"
            value={sum.unmarked}
            note="No check-in yet and no HR decision; not an absence"
          />
        </li>
        <li>
          <StatCard label="Absences confirmed by HR" value={sum.confirmedAbsences} />
        </li>
      </ul>
      <Legend />
      <Segment
        title={fmtMonth(month)}
        actions={
          <>
            <a href={monthLink(addDays(range.from, -1))}>Previous month</a>
            {month < thisMonth ? (
              <>
                {' '}
                <a href={monthLink(addDays(range.to, 1))}>Next month</a>
              </>
            ) : null}
          </>
        }
        flush
      >
        <DayTable
          rows={days.items}
          caption={`Your days in ${fmtMonth(month)}, newest first`}
          empty="No days to show for this month."
        />
      </Segment>
      <Segment
        title="Ask HR to correct a day"
        description="For a missed punch or a wrong status. Say what happened; HR approves or rejects it and you get a notification. One open request per day."
      >
        <ActionForm
          action={`${base}/api/v1/attendance/corrections`}
          submitLabel="Send request to HR"
          successText="Sent to HR."
          resetOnSuccess
          fields={[
            { name: 'workDate', label: 'Day', type: 'date', required: true, section: 'Which day' },
            {
              name: 'requestedStatus',
              label: 'Correct status (optional)',
              type: 'select',
              options: REQUESTABLE_STATUSES.map((s) => ({
                value: s,
                label: ATTENDANCE_STATUS_LABELS[s],
              })),
              section: 'What should it say',
            },
            {
              name: 'requestedIn',
              label: 'Check-in time (optional)',
              type: 'datetime',
              section: 'What should it say',
            },
            {
              name: 'requestedOut',
              label: 'Check-out time (optional)',
              type: 'datetime',
              section: 'What should it say',
            },
            {
              name: 'reason',
              label: 'What happened',
              type: 'textarea',
              required: true,
              section: 'Why',
            },
          ]}
        />
      </Segment>
      <Segment title="My correction requests" flush>
        <CorrectionsTable rows={requests.items} empty="You have not asked for any corrections." />
      </Segment>
    </>
  );
}
