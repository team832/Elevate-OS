/**
 * `<base>/my-attendance` (owner brief 23 Oct 2026 §12, D-073): today and how to ask HR first, then
 * the month's totals, then your days, your correction requests (`?view=requests`) and your leave
 * applications (`?view=leave`) apart. Shown in Ops, Academic and Marketing. The person is always the signed-in user; nothing in the URL can
 * point it at someone else.
 */
import { can } from '@elevate/authorization';
import { LINK_LOGIN_HELP } from '@elevate/shared-contracts';
import { Alert, ButtonLink, EmptyState, PageHeader, Tabs } from '@elevate/shared-ui';
import {
  monthRange,
  monthTotals,
  monthTotalsText,
  REQUESTABLE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
} from '../../domain/attendance';
import { addDays, istToday } from '../../domain/dates';
import { attendanceDay, listAttendance, upcomingHolidays } from '../../server/attendance';
import { listCorrections } from '../../server/attendance-corrections';
import { correctionListQuery, leaveListQuery } from '../../server/attendance-schemas';
import { staffIdForUser } from '../../server/context';
import { leaveTypes, listLeaveApplications } from '../../server/leave-applications';
import { readBalances } from '../../server/leave-balances';
import { ActionForm } from '../../ui/action-form';
import { ExportLink } from '../../ui/export-link';
import { fmtDate, fmtMonth } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { listHref, Pager } from '../../ui/list-controls';
import { Segment } from '../../ui/sections';
import { BalanceList, balanceTitle } from '../hr/attendance/_components/allowances';
import {
  ApplyForLeave,
  leaveFiles,
  LeaveTable,
  myLeaveAction,
} from '../hr/attendance/_components/leave';
import {
  AttendanceBadge,
  CorrectionsTable,
  DayTable,
  Legend,
  timeText,
} from '../hr/attendance/_components/shared';
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
  const today = istToday(new Date());
  const thisMonth = today.slice(0, 7);
  const month =
    /^\d{4}-\d{2}$/.test(searchParams.month ?? '') && searchParams.month! <= thisMonth
      ? searchParams.month!
      : thisMonth;
  const range = monthRange(month);
  const result = await load(async (db) => {
    const staffId = await staffIdForUser(db, user.id);
    if (!staffId) return null;
    const { staff, day } = await attendanceDay(db, user, staffId, today);
    const leave = await listLeaveApplications(db, user, {
      staffId,
      page: leaveListQuery.safeParse({ page: searchParams.page }).data?.page,
    });
    return {
      day,
      holidays: await upcomingHolidays(db, staff.branchId, today),
      days: await listAttendance(db, user, { staffId, ...range, page: 1 }),
      requests: await listCorrections(db, user, {
        staffId,
        page: correctionListQuery.safeParse({ page: searchParams.page }).data?.page,
      }),
      leave,
      files:
        searchParams.view === 'leave'
          ? await leaveFiles(db, user, `${base}/api/v1`, leave.items)
          : undefined,
      types: await leaveTypes(db),
      balances: searchParams.view === 'leave' ? await readBalances(db, user, staffId) : null,
    };
  });
  const header = (
    <PageHeader
      title="My attendance and leave"
      description="Your status today, your month so far, how to apply for leave, and how to ask HR to correct a day."
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
          description={`Your login is not linked to a staff record yet, so there is no attendance to show and you cannot apply for leave. ${LINK_LOGIN_HELP}`}
        />
      </>
    );
  const { day, holidays, days, requests, leave, files, types, balances } = result.data;
  const totals = monthTotals(days.items);
  const noSchedule = totals.scheduledWorkdays === null;
  const page = `${base}/my-attendance`;
  const monthLink = (d: string) => listHref(page, searchParams, { month: d.slice(0, 7) });
  const view =
    searchParams.view === 'requests' || searchParams.view === 'leave'
      ? searchParams.view
      : 'history';
  const requestsHref = listHref(page, searchParams, { view: 'requests', page: undefined });
  const leaveHref = listHref(page, searchParams, { view: 'leave', page: undefined });
  const canApply = can(user, 'ops:attendance:request');
  return (
    <>
      {header}
      {noSchedule ? (
        <Alert title="No work schedule is set for you">
          Without one, Elevate OS cannot tell which days you were due to work, so these days count
          neither for nor against you. Any check-ins and check-outs still show. Ask HR to add a work
          schedule to your staff record.
        </Alert>
      ) : null}
      <div className="ops-panels">
        <Segment
          title={`Today, ${fmtDate(today)}`}
          meta={
            day ? (
              <AttendanceBadge
                status={day.status}
                basis={day.basis}
                scheduled={day.scheduled}
                leavePart={day.leavePart}
              />
            ) : null
          }
          actions={
            <>
              {canApply ? <ButtonLink href={`${leaveHref}#apply`}>Apply for leave</ButtonLink> : null}
              <ButtonLink variant="primary" href={`${requestsHref}#correct`}>
                Ask HR to correct a day
              </ButtonLink>
            </>
          }
        >
          <p>
            {day?.firstIn
              ? `Checked in ${timeText(day.firstIn)}${day.lastOut ? `, checked out ${timeText(day.lastOut)}` : ''}.`
              : 'No check-in recorded yet today.'}
          </p>
          <p className="el-field-hint">
            There is no check-in button here, by design: HR enters check-ins and check-outs or
            imports them from a file, and no machine is connected. If a day looks wrong, ask HR to
            correct it.
          </p>
        </Segment>
        <Segment title="Upcoming holidays">
          {holidays.length ? (
            <ul>
              {holidays.map((h) => (
                <li key={h.id}>
                  {fmtDate(h.holidayOn)}: {h.name}
                  {h.decisionState === 'proposed' ? ' (proposed, not confirmed)' : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="el-field-hint">No upcoming holidays are recorded.</p>
          )}
        </Segment>
      </div>
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
      >
        <p>{monthTotalsText(totals)}</p>
        <ExportLink
          base={base}
          list="attendance"
          params={{ month, mine: '1' }}
          label="Download attendance (spreadsheet)"
        />
        <details className="el-explain">
          <summary>How these totals are worked out</summary>
          <p>
            Each day listed counts once, under the status it shows. Working days are the days your
            schedule says you work, without holidays. Unmarked means a working day with no check-in,
            or a very short day, and no HR decision; it is not an absence. A day with no schedule
            cannot be judged, so it is counted apart. Days after today are not counted.
          </p>
        </details>
      </Segment>
      <Tabs
        idBase="my-attendance"
        label="Your days and your requests"
        selected={view}
        items={[
          {
            key: 'history',
            label: 'My days',
            href: listHref(page, searchParams, { view: undefined, page: undefined }),
          },
          { key: 'leave', label: 'Leave applications', href: leaveHref, count: leave.total },
          {
            key: 'requests',
            label: 'Correction requests',
            href: requestsHref,
            count: requests.total,
          },
        ]}
      >
        {view === 'history' ? (
          <div className="el-stack">
            <Legend />
            <DayTable
              rows={days.items}
              caption={`Your days in ${fmtMonth(month)}, newest first`}
              empty="No days to show for this month."
            />
          </div>
        ) : view === 'leave' ? (
          <div className="el-stack">
            {balances ? (
              <Segment
                id="balance"
                title={balanceTitle(balances)}
                description="Leave HR has approved this leave year, counted against the allowance HR set. A pending application is not counted until it is approved."
                flush
              >
                <BalanceList data={balances} />
              </Segment>
            ) : null}
            {canApply ? (
              <Segment
                id="apply"
                title="Apply for leave"
                description="HR approves or rejects it and you get a notification. Leave already taken can be applied for afterwards. To add a leave letter or medical certificate, apply first, then attach it to the application below."
              >
                <ApplyForLeave base={base} types={types} />
              </Segment>
            ) : (
              <p className="el-field-hint">
                Your role reads records only, so it cannot apply for leave here. Ask HR to record it.
              </p>
            )}
            <Segment title="My leave applications" flush>
              <LeaveTable
                rows={leave.items}
                files={files}
                actions={(r) => myLeaveAction(base, r)}
                empty="You have not applied for leave."
              />
            </Segment>
            <Pager
              basePath={page}
              params={searchParams}
              page={leave.page}
              pageSize={leave.pageSize}
              total={leave.total}
            />
          </div>
        ) : (
          <div className="el-stack">
            <Segment
              id="correct"
              title="Ask HR to correct a day"
              description="For a missed punch or a wrong status. Say what happened; HR approves or rejects it and you get a notification. One open request per day."
            >
              <ActionForm
                action={`${base}/api/v1/attendance/corrections`}
                submitLabel="Send request to HR"
                successText="Sent to HR."
                resetOnSuccess
                fields={[
                  {
                    name: 'workDate',
                    label: 'Day',
                    type: 'date',
                    required: true,
                    section: 'Which day',
                  },
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
              <CorrectionsTable
                rows={requests.items}
                empty="You have not asked for any corrections."
              />
            </Segment>
            <Pager
              basePath={page}
              params={searchParams}
              page={requests.page}
              pageSize={requests.pageSize}
              total={requests.total}
            />
          </div>
        )}
      </Tabs>
    </>
  );
}
