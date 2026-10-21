/**
 * The demo record (owner brief §5 "Demo detail layout") as tabs: Overview, KYC, Demo attendance,
 * Teacher feedback, Fees, Activity — tabs in the pop-up (`/ops/admissions?open=<id>`), stacked
 * segments on the full record `/ops/admissions/demos/<id>`. Every form posts to an API route;
 * the server re-checks permission and scope.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { StatusBadge } from '@elevate/shared-ui';
import {
  ATTENDANCE_LABELS,
  DAY_STATE_LABELS,
  DEMO_FEE_LABELS,
  MANUAL_OUTCOMES,
  MOCK_LABELS,
  type Attendance,
} from '../../../domain/demos';
import { getDemo, type DemoRecord } from '../../../server/demos';
import { formOptions } from '../../../server/options';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, fmtPaise, humanise } from '../../../ui/format';
import { load } from '../../../ui/frame';
import type { ModalTab } from '../../../ui/record-modal';
import { DetailTable, Segment } from '../../../ui/sections';
import { DemoActivity } from './demo-activity';
import { DemoAttendance } from './demo-attendance';
import {
  Badge,
  DayMarks,
  Disclosure,
  FollowUpCell,
  programmeNames,
  reasonField,
  reviewTeachers,
  SampleBadge,
} from './demo-bits';
import { DemoFees } from './demo-fees';
import { DemoFeedback } from './demo-feedback';
import { DemoKyc } from './demo-kyc';
import { RecordJourney } from './journey';

type Option = { value: string; label: string };
export interface DemoTabProps {
  d: DemoRecord;
  user: AuthenticatedUser;
  /** Active staff and programmes for the pickers. */
  options: { staff: readonly Option[]; programmes: readonly Option[] };
  /** 3 inside the pop-up (its title is the h2), 2 on the full page. */
  level: 2 | 3;
}

/** The demo record plus picker options, for the pop-up and the full record. */
export const loadDemoRecord = (user: AuthenticatedUser, id: string) =>
  load(async (db) => {
    const [d, options] = await Promise.all([getDemo(db, user, id), formOptions(db)]);
    return { d, options };
  });

/** "Sample User" for a user id, "System" for none. */
export const nameOf = (d: DemoRecord, userId: string | null) =>
  userId ? (d.names[userId] ?? 'Staff member') : 'System';

/** Why Begin admission is unavailable, or null when it can be used. */
function convertBlock(d: DemoRecord, user: AuthenticatedUser): string | null {
  if (d.demo.outcome !== 'open') return `This demo is closed (${humanise(d.demo.outcome)}).`;
  if (!can(user, 'ops:admissions:convert')) return 'Your role cannot begin admissions.';
  if (d.checklistRequired.value.requiredBeforeConversion && d.checklist.done < d.checklist.total)
    return 'Resolve the checklist first (setting "Demo checklist required before conversion").';
  return null;
}

/** Begin admission (the conversion route), or the reason it is not available. */
export function DemoActions({
  d,
  user,
  convertHref,
}: {
  d: DemoRecord;
  user: AuthenticatedUser;
  convertHref: string;
}) {
  if (d.convertedCode)
    return (
      <p className="el-field-hint">
        Admission begun: <a href={`/ops/admissions/${d.demo.convertedAdmissionId}`}>open it</a>
      </p>
    );
  const block = convertBlock(d, user);
  return block ? (
    <p className="el-field-hint">Begin admission is not available. {block}</p>
  ) : (
    <a className="el-button el-button-primary" href={convertHref}>
      Begin admission
    </a>
  );
}

const teacherText = (s: DemoRecord['sessions'][number]) =>
  s.teacherName ? `${s.teacherName}${s.isSubstitute ? ' (substitute)' : ''}` : 'no teacher';

/** Day 1/2/3 cards: the day's state, each class with its teacher and attendance, and reviews. */
function DayStrip({ d }: { d: DemoRecord }) {
  return (
    <ol className="ops-admissions-days" aria-label="Demo days">
      {d.days.map((day) => {
        const states = (d.feedback.find((f) => f.dayNumber === day.day)?.teachers ?? []).map(
          (t) => t.state,
        );
        const received = states.filter((s) => s === 'submitted').length;
        return (
          <li key={day.day}>
            <div className="ops-admissions-day-head">
              <span>
                <strong>Day {day.day}</strong>
                {day.extra ? ' (extra)' : ''} · {day.dates.map(fmtDate).join(', ') || 'No date'}
              </span>
              <Badge value={day.state} label={DAY_STATE_LABELS[day.state]} />
            </div>
            {day.sessions.length ? (
              <ul>
                {day.sessions.map((s) => (
                  <li key={s.id}>
                    {s.subject ?? 'Class'}{' '}
                    <Badge
                      value={s.attendance}
                      label={ATTENDANCE_LABELS[s.attendance as Attendance]}
                    />
                    <br />
                    <span className="el-field-hint">{teacherText(s)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {states.length ? (
              <span className="el-field-hint">
                Teacher reviews: {received} of {states.length} received
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Where the demo student is on the admission journey (closed without converting: none). */
export const DemoJourney = ({ d }: { d: DemoRecord }) =>
  d.demo.outcome === 'open' || d.convertedCode ? (
    <RecordJourney at={d.convertedCode ? 1 : 0} />
  ) : null;

function Overview({ d, user, options, level }: DemoTabProps) {
  const write = can(user, 'ops:leads:write');
  const open = d.demo.outcome === 'open';
  const awaited = reviewTeachers(d).filter(
    (t) => t.state === 'pending' || t.state === 'draft',
  ).length;
  return (
    <>
      <Segment
        title="Demo days"
        level={level}
        description="A day counts when the student was present or late in at least one class."
        meta={<DayMarks days={d.days} label={d.progress.label} detail={d.progress.sessionsLabel} />}
      >
        <DayStrip d={d} />
      </Segment>
      <Segment title="Summary" level={level} flush>
        <DetailTable
          rows={[
            {
              label: 'Student',
              value: (
                <>
                  {d.studentName} <SampleBadge show={d.demo.isSample} />
                </>
              ),
            },
            {
              label: 'Programme interests',
              value: d.interests.length
                ? programmeNames(d.interests, options.programmes)
                : (d.programmeName ?? 'Not set'),
            },
            { label: 'Counsellor', value: d.counsellorName ?? 'Not assigned' },
            {
              label: 'Demo state',
              value: (
                <>
                  <Badge value={d.demo.outcome} />{' '}
                  {open
                    ? d.completed
                      ? 'Completed: every class recorded, outcome not decided yet (this does not enrol).'
                      : `${humanise(d.view)} demo`
                    : ''}
                </>
              ),
            },
            {
              label: 'Days',
              value: `${d.progress.label}; ${d.progress.daysScheduled} of ${d.progress.planned} days have a class booked; ${d.progress.sessionsLabel}`,
            },
            {
              label: 'Next class',
              value: d.next
                ? `${d.next.subject ?? 'Class'}, ${fmtDateTime(d.next.startsAt)} (day ${d.next.dayNumber})`
                : d.awaitingRecord.length
                  ? `Attendance to record for ${d.awaitingRecord.length} class(es)`
                  : 'None scheduled',
            },
            {
              label: 'Payment',
              value: d.fees ? (
                <>
                  <Badge value={d.fees.state} label={DEMO_FEE_LABELS[d.fees.state]} /> Paid{' '}
                  {fmtPaise(d.fees.paidPaise)} of{' '}
                  {d.fees.balancePaise === null
                    ? 'no amount due recorded'
                    : fmtPaise(d.fees.assessedPaise)}
                </>
              ) : (
                'Shown to staff with fee access'
              ),
            },
            {
              label: 'Teacher reviews',
              value: awaited ? `${awaited} awaited (see Teacher feedback)` : 'None awaited',
            },
            {
              label: 'Next follow-up',
              value: (
                <>
                  <FollowUpCell followUp={d.followUp} canClose={write} />
                  {d.followUp ? <span className="el-field-hint">{d.followUp.title}</span> : null}
                </>
              ),
            },
            { label: 'Mock test', value: MOCK_LABELS[d.mock] },
            { label: 'Checklist', value: d.checklist.label },
            d.gaps.length > 0 && { label: 'Still to arrange', value: d.gaps.join('; ') },
            !open && {
              label: 'Closed',
              value: `${fmtDateTime(d.demo.outcomeAt)} by ${nameOf(d, d.demo.outcomeBy)}${
                d.demo.outcomeReason ? `: ${d.demo.outcomeReason}` : ''
              }`,
            },
          ]}
        />
      </Segment>
      {write ? (
        <Disclosure summary="Schedule a follow-up">
          <ActionForm
            compact
            action="/ops/api/v1/follow-ups"
            submitLabel="Schedule follow-up"
            extra={{
              leadId: d.demo.leadId,
              admissionId: d.demo.admissionId,
              kind: 'demo_followup',
            }}
            fields={[
              { name: 'title', label: 'What to follow up', required: true },
              { name: 'dueDate', label: 'Due date', type: 'date', required: true },
              {
                name: 'ownerStaffId',
                label: 'Owner (blank = the counsellor)',
                type: 'select',
                options: options.staff,
              },
            ]}
          />
        </Disclosure>
      ) : null}
      {write && open ? (
        <Disclosure summary="Close the demo">
          <p className="el-field-hint">
            Future classes are cancelled; past ones never recorded become Not recorded. Not
            converted, cancelled or no-show returns the case to Counselled so a new demo can be
            booked.
          </p>
          <ActionForm
            compact
            action={`/ops/api/v1/demos/${d.demo.id}`}
            submitLabel="Close demo"
            extra={{ action: 'outcome' }}
            variant="secondary"
            fields={[
              {
                name: 'outcome',
                label: 'Outcome',
                type: 'select',
                required: true,
                options: MANUAL_OUTCOMES.map((o) => ({ value: o, label: humanise(o) })),
              },
              reasonField('Reason', true),
            ]}
          />
        </Disclosure>
      ) : null}
    </>
  );
}

/** The record's tabs (brief §5): the same content stacks on the full page. */
export function demoSections(props: DemoTabProps): ModalTab[] {
  const { d } = props;
  const awaited = reviewTeachers(d).filter(
    (t) => t.state === 'pending' || t.state === 'draft',
  ).length;
  return [
    { key: 'overview', label: 'Overview', content: <Overview {...props} /> },
    { key: 'kyc', label: 'KYC', content: <DemoKyc {...props} /> },
    {
      key: 'attendance',
      label: 'Demo attendance',
      count: d.sessions.length,
      content: <DemoAttendance {...props} />,
    },
    {
      key: 'feedback',
      label: 'Teacher feedback',
      count: awaited || undefined,
      content: <DemoFeedback {...props} />,
    },
    { key: 'fees', label: 'Fees', content: <DemoFees {...props} /> },
    { key: 'activity', label: 'Activity', content: <DemoActivity {...props} /> },
  ];
}

/** Header line: outcome, progress, counsellor and sample marker (no reference numbers). */
export const DemoMeta = ({ d }: { d: DemoRecord }) => (
  <>
    <Badge value={d.demo.outcome} /> {d.progress.label}
    {d.counsellorName ? ` · ${d.counsellorName}` : ''} <SampleBadge show={d.demo.isSample} />
    {d.completed && d.demo.outcome === 'open' ? (
      <>
        {' '}
        <StatusBadge tone="info">All classes recorded</StatusBadge>
      </>
    ) : null}
  </>
);
