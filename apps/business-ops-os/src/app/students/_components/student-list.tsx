/**
 * Student lists (Active, On hold, Former): the search panel, the bordered table
 * (whole row opens `?open=<id>`), the pager and the centred quick-view pop-up.
 * Server components; the pop-up itself is the shared client RecordModal.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { ReactNode } from 'react';
import { StatusBadge, type Column, type Tone } from '@elevate/shared-ui';
import { istToday } from '../../../domain';
import { isExitStatus } from '../../../domain/student-lifecycle';
import type { COHORT_PROGRAMMES } from '../../../domain/catalog';
import {
  STUDENT_FEE_STATUS_LABELS,
  STUDENT_FEE_STATUSES,
  type StudentFeeStatus,
} from '../../../domain/fee-plans';
import { formOptions } from '../../../server/options';
import { openReadmission } from '../../../server/student-lifecycle';
import { getStudent, listStudents } from '../../../server/students';
import { studentSearchQuery, type StudentSearchQuery } from '../../../server/students-schemas';
import { fmtDate, fmtDateTime, humanise, statusTone } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref, Pager, SearchPanel, type FilterField } from '../../../ui/list-controls';
import { ActionForm } from '../../../ui/action-form';
import { RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { StudentFeesSection } from '../../../ui/student-fees-section';
import {
  AdmissionFacts,
  batchLabel,
  ExitRecords,
  ActivityTimeline,
  HistoryTable,
  ProgrammesTable,
  StudentJourney,
  StudentMeta,
  ReportButtons,
  UpcomingTable,
} from './profile-sections';

export { listHref };
export const PAGE_SIZE = 25;
type Params = Record<string, string | undefined>;
export type Row = Awaited<ReturnType<typeof listStudents>>['items'][number];

export const COHORT_LABELS: Record<(typeof COHORT_PROGRAMMES)[number] | 'none', string> = {
  CLASS_11: 'Class 11 Commerce',
  CLASS_12: 'Class 12 Commerce',
  DROPPER: 'Dropper',
  none: 'Entrance programme only',
};

export const FEE_TONE: Record<StudentFeeStatus, Tone> = {
  paid: 'success',
  due: 'warning',
  overdue: 'danger',
  not_configured: 'neutral',
};

/** A full phone number (10+ digits) or an email typed into the search box. */
const CONTACT = /^(?=(?:\D*\d){10})[\d\s()+-]+$|^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The search box also finds a phone or email for staff allowed to see private details: it is
 * then sent as the audited `contact` filter (the server searches names and numbers only in `q`).
 */
export const contactSearch = (params: Params, user: AuthenticatedUser) =>
  params.contact ??
  (params.q && CONTACT.test(params.q.trim()) && can(user, 'ops:student_private:read')
    ? params.q.trim()
    : undefined);

/** URL params → service query (invalid values are dropped, never fatal). */
export function parseQuery(
  params: Params,
  view: StudentSearchQuery['view'],
  user: AuthenticatedUser,
) {
  const page = Math.max(1, Number(params.page) || 1);
  const contact = contactSearch(params, user);
  const raw = {
    ...params,
    ...(contact ? { contact, q: params.contact ? params.q : undefined } : {}),
    view,
    limit: String(PAGE_SIZE),
    cursor: String((page - 1) * PAGE_SIZE),
  };
  const parsed = studentSearchQuery.safeParse(raw);
  return {
    page,
    valid: parsed.success,
    query: parsed.success ? parsed.data : studentSearchQuery.parse({ view, limit: PAGE_SIZE }),
  };
}

/** Search box + Filters (programme, cohort, counsellor, fee status, meetings; contact only with permission). */
export async function StudentSearch({
  basePath,
  params,
  user,
  hidden = {},
  extra = [],
}: {
  basePath: string;
  params: Params;
  user: AuthenticatedUser;
  /** Kept on submit, e.g. `{ tab: 'former' }`. */
  hidden?: Record<string, string>;
  /** Page-specific filters shown first (e.g. the outcome of past students). */
  extra?: FilterField[];
}) {
  const r = await load((db) => formOptions(db));
  const opts = r.ok ? r.data : { programmes: [], staff: [] };
  return (
    <>
      <SearchPanel
        action={basePath}
        hidden={hidden}
        search={{
          name: 'q',
          label: can(user, 'ops:student_private:read')
            ? 'Name, admission no. or phone'
            : 'Name or admission no.',
          value: params.q,
        }}
        filters={[
          ...extra,
          ...(can(user, 'ops:student_private:read')
            ? [
                {
                  name: 'contact',
                  label: 'Phone or email (student or guardian)',
                  value: params.contact,
                },
              ]
            : []),
          {
            name: 'programme',
            label: 'Programme',
            type: 'select' as const,
            options: opts.programmes,
            value: params.programme,
          },
          {
            name: 'cohort',
            label: 'Cohort',
            type: 'select' as const,
            options: Object.entries(COHORT_LABELS).map(([value, label]) => ({ value, label })),
            value: params.cohort,
          },
          {
            name: 'counsellor',
            label: 'Counsellor',
            type: 'select' as const,
            options: opts.staff,
            value: params.counsellor,
          },
          ...(can(user, 'ops:fees:read')
            ? [
                {
                  name: 'fee',
                  label: 'Fee status',
                  type: 'select' as const,
                  options: STUDENT_FEE_STATUSES.map((s) => ({
                    value: s,
                    label: STUDENT_FEE_STATUS_LABELS[s],
                  })),
                  value: params.fee,
                },
              ]
            : []),
          {
            name: 'meeting',
            label: 'Meetings',
            type: 'select' as const,
            options: [{ value: 'upcoming', label: 'Has an upcoming meeting' }],
            value: params.meeting,
          },
          {
            name: 'sort',
            label: 'Sort',
            type: 'select' as const,
            anyLabel: 'Admitted most recently',
            options: [
              { value: 'oldest', label: 'Admitted longest ago' },
              { value: 'name', label: 'Name A–Z' },
            ],
            value: params.sort,
          },
        ]}
      />
      {contactSearch(params, user) ? (
        <p className="el-field-hint" role="status">
          Contact searches are recorded in the audit trail (masked).
        </p>
      ) : null}
    </>
  );
}

export const FeeBadge = ({ status }: { status: Row['feeStatus'] }) =>
  status === null ? (
    'Restricted'
  ) : (
    <StatusBadge tone={FEE_TONE[status]}>{STUDENT_FEE_STATUS_LABELS[status]}</StatusBadge>
  );

/** The earlier of the next open follow-up and the next meeting. */
function nextEvent(s: Row) {
  const f = s.nextFollowUp;
  const m = s.nextMeeting;
  const meetingFirst = m && (!f || m.startsAt.toISOString().slice(0, 10) <= f.dueDate);
  if (meetingFirst) return `${fmtDateTime(m.startsAt)} · ${humanise(m.type)} with ${m.staffName}`;
  if (!f) return 'Nothing scheduled';
  const late = f.dueDate < istToday(new Date()) ? ' (overdue)' : '';
  return `${fmtDate(f.dueDate)} · Follow-up${late}: ${f.title}`;
}

/** Every column a student list can show; each page picks its set. */
export const STUDENT_COLUMNS = {
  number: {
    key: 'number',
    header: 'Admission no.',
    render: (s) => s.admissionNumber ?? 'Not assigned',
  },
  student: {
    key: 'student',
    header: 'Student',
    render: (s) => (
      <>
        {s.studentName}
        {s.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
        {s.phoneMasked ? <span className="el-field-hint"> {s.phoneMasked}</span> : null}
      </>
    ),
  },
  programmes: {
    key: 'programmes',
    header: 'Programmes and batch',
    render: (s) => (
      <>
        {s.combination}
        <br />
        <span className="el-field-hint">
          Batch{' '}
          {batchLabel(s.enrolledBatchId, s.intendedBatchId).replace(/^./, (c) => c.toLowerCase())}
        </span>
      </>
    ),
  },
  counsellor: {
    key: 'counsellor',
    header: 'Counsellor',
    render: (s) => s.counsellorName ?? 'Unassigned',
  },
  status: {
    key: 'status',
    header: 'Enrolment status',
    render: (s) => <StatusBadge tone={statusTone(s.status)}>{s.statusLabel}</StatusBadge>,
  },
  fees: { key: 'fees', header: 'Fee status', render: (s) => <FeeBadge status={s.feeStatus} /> },
  next: { key: 'next', header: 'Next event', render: nextEvent },
  activity: {
    key: 'activity',
    header: 'Last activity',
    render: (s) => fmtDateTime(s.lastActivityAt),
  },
  exit: {
    key: 'exit',
    header: 'Exit',
    render: (s) => (
      <>
        <StatusBadge tone="neutral">{s.statusLabel}</StatusBadge>
        <br />
        <span className="el-field-hint">
          {s.statusSince
            ? `${fmtDate(istToday(s.statusSince.at))} · by ${s.statusSince.byName ?? 'Academic OS reply'}`
            : 'Date not recorded'}
        </span>
      </>
    ),
  },
  review: { key: 'review', header: 'Review date', render: (s) => fmtDate(s.holdReviewDate) },
  reason: { key: 'reason', header: 'Reason', render: (s) => s.statusReason ?? 'Not recorded' },
  since: {
    key: 'since',
    header: 'Recorded',
    render: (s) =>
      s.statusSince
        ? `${fmtDateTime(s.statusSince.at)} by ${s.statusSince.byName ?? 'Academic OS reply'}`
        : 'Not recorded',
  },
} satisfies Record<string, Column<Row>>;

/** Loads one list view and renders the table (or its error state) and the pager. */
export async function StudentListSection({
  user,
  basePath,
  params,
  view,
  columns,
  empty,
}: {
  user: AuthenticatedUser;
  basePath: string;
  params: Params;
  view: StudentSearchQuery['view'];
  columns: Column<Row>[];
  empty: ReactNode;
}) {
  const { query, page, valid } = parseQuery(params, view, user);
  const r = await load((db) => listStudents(db, user, query));
  if (!r.ok) return r.view;
  const { items, total } = r.data;
  return (
    <>
      {!valid ? (
        <p className="el-field-hint" role="status">
          Some filters were not valid and were ignored.
        </p>
      ) : null}
      <RecordTable
        caption={`${total} student${total === 1 ? '' : 's'}`}
        columns={columns}
        rows={items}
        rowKey={(s) => s.id}
        rowHref={(s) => listHref(basePath, params, { open: s.id })}
        linkColumn="student"
        empty={empty}
      />
      <Pager basePath={basePath} params={params} page={page} pageSize={PAGE_SIZE} total={total} />
    </>
  );
}

/** `?open=<admissionId>` quick profile in the centred pop-up; "Open full record" goes to the profile. */
export async function StudentQuickView({
  user,
  id,
  closeHref,
}: {
  user: AuthenticatedUser;
  id: string;
  closeHref: string;
}) {
  const r = await load(async (db) => {
    const d = await getStudent(db, user, id);
    // Readmission (brief §11): a new application for the same student; the closed case stays.
    const readmit =
      isExitStatus(d.admission.status) &&
      can(user, 'ops:students:lifecycle') &&
      can(user, 'ops:admissions:write');
    const openReadmissionRef = readmit ? await openReadmission(db, d.admission.id) : null;
    return {
      ...d,
      openReadmissionRef,
      readmitProgrammes: readmit && !openReadmissionRef ? (await formOptions(db)).programmes : null,
    };
  });
  if (!r.ok)
    return (
      <RecordModal id="student-modal" title="Student" closeHref={closeHref} returnId={id}>
        {r.view}
      </RecordModal>
    );
  const d = r.data;
  const held = Boolean(d.admission.holdReviewDate);
  const upcoming = d.followUps.length + d.upcomingCounselling.length;
  return (
    <RecordModal
      id="student-modal"
      title={d.person.fullName}
      closeHref={closeHref}
      returnId={id}
      fullHref={`/ops/students/${d.identity?.id ?? d.admission.id}`}
      meta={<StudentMeta d={d} />}
      tabs={[
        {
          key: 'overview',
          label: 'Overview',
          content: (
            <Segment title="Admission" level={3} flush>
              <AdmissionFacts d={d} />
            </Segment>
          ),
        },
        {
          key: 'programmes',
          label: 'Programmes',
          count: d.cases.length,
          content: (
            <Segment title="Programmes and batches" level={3} flush>
              <ProgrammesTable d={d} />
            </Segment>
          ),
        },
        ...(d.identity && can(user, 'ops:fees:read')
          ? [
              {
                key: 'fees',
                label: 'Fees',
                content: (
                  <StudentFeesSection studentId={d.identity.id} user={user} level={3} readOnly />
                ),
              },
            ]
          : []),
        ...(held || d.exitRecords.length
          ? [
              {
                key: 'exit',
                label: held ? 'Hold' : 'Exit record',
                content: held ? (
                  <Segment title="On hold" level={3} flush>
                    <DetailTable
                      rows={[
                        { label: 'Review date', value: fmtDate(d.admission.holdReviewDate) },
                        { label: 'Reason', value: d.admission.statusReason ?? 'Not recorded' },
                        { label: 'Held from', value: humanise(d.admission.heldFromStatus) },
                      ]}
                    />
                  </Segment>
                ) : (
                  <>
                    <ExitRecords d={d} level={3} />
                    {d.openReadmissionRef ? (
                      <p role="status">
                        Readmission already open: {d.openReadmissionRef}. Continue it under
                        Admission applications.
                      </p>
                    ) : null}
                    {d.readmitProgrammes ? (
                      <Segment
                        title="Readmit"
                        level={3}
                        description="Starts a new application for the same student. The closed admission, its number and this exit record stay as they are."
                      >
                        <ActionForm
                          action={`/ops/api/v1/admissions/${d.admission.id}/lifecycle`}
                          submitLabel="Start readmission"
                          extra={{ action: 'readmit' }}
                          // Router path: Next adds the /ops basePath itself (D-022).
                          redirectTo="/admissions/applications/{id}"
                          fields={[
                            {
                              name: 'programmeCode',
                              label: 'Programme',
                              type: 'select',
                              options: d.readmitProgrammes,
                              hint: 'Empty: the programme of the closed admission.',
                            },
                            {
                              name: 'academicYear',
                              label: 'Academic year',
                              hint: 'For example 2027-28',
                            },
                            {
                              name: 'reason',
                              label: 'Why the student is returning',
                              type: 'textarea',
                              required: true,
                            },
                          ]}
                        />
                      </Segment>
                    ) : null}
                  </>
                ),
              },
            ]
          : []),
        {
          key: 'history',
          label: 'Status history',
          count: d.history.length,
          content: (
            <Segment title="Status history" level={3} flush>
              <HistoryTable d={d} />
            </Segment>
          ),
        },
        {
          key: 'upcoming',
          label: 'Upcoming',
          count: upcoming,
          content: (
            <Segment title="Upcoming" level={3} flush>
              <UpcomingTable d={d} />
            </Segment>
          ),
        },
        {
          key: 'activity',
          label: 'Activity',
          content: (
            <Segment
              title="Recent activity"
              level={3}
              description="Latest 10 from the audit trail."
            >
              <ActivityTimeline rows={d.timeline.slice(0, 10)} />
            </Segment>
          ),
        },
      ]}
    >
      <StudentJourney d={d} />
      <ReportButtons d={d} />
    </RecordModal>
  );
}
