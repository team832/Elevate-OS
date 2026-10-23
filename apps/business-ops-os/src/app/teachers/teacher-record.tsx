/**
 * One teacher, shared by the directory pop-up (`/ops/teachers?open=<id>`) and the profile route
 * (`/ops/teachers/<id>`): bordered sections as tabs, and the edit / record-feedback flows in their
 * own FormModal (`act=<key>`). Each fact names its source (brief 2 §7–8): HR attendance lives in
 * HR → Attendance (linked), class delivery and logs come from Academic OS, tasks and EOD from Business Ops. No
 * salary, identity documents, private notes, ratings or productivity scores.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, scopeFor } from '@elevate/authorization';
import type { Metric } from '@elevate/shared-contracts';
import { Alert, MetricStrip, StatusBadge } from '@elevate/shared-ui';
import { REVIEW_STATE_LABELS } from '../../domain/feedback';
import { writeReviewHref } from '../../server/academic-reviews';
import { demoReviewsDue, REVIEWS_DUE_DAYS } from '../../server/feedback';
import type { getTeacherProfile } from '../../server/teachers';
import { ActionForm, type ActionFormProps } from '../../ui/action-form';
import { Unavailable } from '../../ui/cross-module';
import { load } from '../../ui/frame';
import { fmtDate, fmtDateTime, humanise } from '../../ui/format';
import { FormModal, type ModalTab } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';
import { AcademicReviewList, isTeacher } from '../../ui/student-feedback-section';
import { ApptStatus, SampleBadge, TypeBadge } from '../meetings/appointment-view';
import { VerificationBadge } from './verification-badge';

export type TeacherProfile = Awaited<ReturnType<typeof getTeacherProfile>>;

const MODERATION_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'neutral',
  hidden: 'neutral',
} as const;

const needs = (permission: string) => (
  <p className="el-field-hint">Needs permission {permission}.</p>
);

/** A metric as a short cell value: missing stays "Not recorded", never 0. */
export const metricText = (m: Metric) =>
  m.status === 'missing' ? 'Not recorded' : String(m.value);

export function teacherTabs(
  t: TeacherProfile,
  user: AuthenticatedUser,
  actHref: (act: TeacherAct) => string,
  level: 2 | 3,
): ModalTab[] {
  const moderate = can(user, 'ops:teacher_feedback:manage');
  const about = t.feedbackAbout;
  const a = t.activity.status === 'available' ? t.activity.data : null;
  const sources = [
    {
      source: 'HR attendance and leave',
      state: 'Kept in HR → Attendance (see the Attendance tab)',
    },
    {
      source: 'Academic OS — assignments, classes, logs, marking',
      state:
        t.activity.status === 'available'
          ? `Fresh — generated ${fmtDateTime(t.activity.data.generatedAt)}`
          : `Source unavailable (${t.activity.reason}), checked ${fmtDateTime(t.activity.fetchedAt)}`,
    },
    {
      source: 'Academic OS — student reviews',
      state: !t.reviewsAuthored
        ? 'Not shared with you'
        : t.reviewsAuthored.status === 'available'
          ? `Fresh — checked ${fmtDateTime(t.reviewsAuthored.checkedAt)}`
          : `Source unavailable (${t.reviewsAuthored.reason}), checked ${fmtDateTime(t.reviewsAuthored.checkedAt)}`,
    },
    {
      source: 'Business Ops — tasks and EOD reports',
      state: t.tasks ? 'Fresh — read now' : 'Not shared with you',
    },
  ];
  return [
    {
      key: 'overview',
      label: 'Overview',
      content: (
        <>
          <Segment
            title="Role and professional details"
            level={level}
            flush
            actions={
              can(user, 'ops:teachers:manage') ? (
                <a href={actHref('edit')}>Edit teacher details</a>
              ) : undefined
            }
          >
            <DetailTable
              rows={[
                { label: 'Staff code', value: t.profile?.staffCode ?? 'Not assigned' },
                { label: 'Department', value: t.department ?? 'Not recorded' },
                { label: 'Manager', value: t.manager ?? 'Not recorded' },
                { label: 'Staff status', value: humanise(t.staff.status) },
                {
                  label: 'Subjects',
                  value: t.subjects.length ? (
                    <ul>
                      {t.subjects.map((s) => (
                        <li key={s.subject}>{s.subject}</li>
                      ))}
                    </ul>
                  ) : (
                    'None recorded'
                  ),
                },
                {
                  label: 'Other role',
                  value: `${t.profile?.roleNote ?? 'None recorded'} (kept separate from teaching)`,
                },
                {
                  label: 'Name verification',
                  value:
                    t.profile?.verificationStatus === 'confirmed' ? (
                      <StatusBadge tone="success">Confirmed by the owner</StatusBadge>
                    ) : (
                      <VerificationBadge status={t.profile?.verificationStatus} />
                    ),
                },
                { label: 'Source', value: t.profile?.sourceNote ?? 'Not recorded' },
                {
                  label: 'Contacts',
                  value: <a href={`/ops/staff/${t.staff.id}`}>On the staff record</a>,
                },
              ]}
            />
          </Segment>
          <Segment
            title="Academic assignments"
            level={level}
            flush
            description="From Academic OS: the batches and subjects this teacher is assigned to."
          >
            {a ? (
              <RecordTable
                rows={a.assignments}
                rowKey={(x) => `${x.batchCode}-${x.subjectName}-${x.role}`}
                empty="No assignment in Academic OS."
                columns={[
                  { key: 'batch', header: 'Batch', render: (x) => x.batchCode },
                  { key: 'subject', header: 'Subject', render: (x) => x.subjectName },
                  { key: 'role', header: 'Role', render: (x) => humanise(x.role) },
                  {
                    key: 'dates',
                    header: 'Dates',
                    render: (x) =>
                      `${fmtDate(x.startDate)} to ${x.endDate ? fmtDate(x.endDate) : 'open'}`,
                  },
                ]}
              />
            ) : t.activity.status === 'unavailable' ? (
              <Unavailable name="Academic OS" result={t.activity} />
            ) : null}
          </Segment>
          <Segment
            title="Workload in Business Ops"
            level={level}
            flush
            description="Booked appointments and scheduled demo classes: a capacity view, not a performance score."
          >
            <DetailTable
              rows={[
                { label: 'Next 7 days', value: String(t.workload.next7Days) },
                { label: 'Next 30 days', value: String(t.workload.next30Days) },
              ]}
            />
          </Segment>
        </>
      ),
    },
    {
      key: 'attendance',
      label: 'Attendance and leave',
      content: (
        <Segment title="Attendance and leave" level={level}>
          <div className="el-stack">
            {scopeFor(user, 'ops:attendance:read') === 'all' ? (
              <p>
                <a href={`/ops/hr/attendance?staffId=${t.staff.id}`}>
                  Open this teacher’s attendance in HR
                </a>
              </p>
            ) : (
              <p className="el-field-hint">Staff attendance is kept by HR.</p>
            )}
            <p className="el-field-hint">
              Class delivery (Academic OS) and EOD reports are not attendance, and attendance does
              not prove a class was taught.
            </p>
            {a?.unavailability.length ? (
              <RecordTable
                caption="Academic availability records — not HR leave"
                rows={a.unavailability}
                rowKey={(u) => `${u.from}-${u.to}`}
                columns={[
                  { key: 'from', header: 'From', render: (u) => fmtDate(u.from) },
                  { key: 'to', header: 'To', render: (u) => fmtDate(u.to) },
                ]}
              />
            ) : null}
          </div>
        </Segment>
      ),
    },
    {
      key: 'academic',
      label: 'Academic activity',
      content: (
        <Segment
          title="Academic activity"
          level={level}
          description={`From Academic OS, ${fmtDate(t.activityWindow.from)} to ${fmtDate(t.activityWindow.to)}. Planned is not delivered; delivered counts classes marked delivered with this teacher as an actual teacher.`}
        >
          {a ? (
            <MetricStrip
              label="Academic activity"
              items={[
                { label: 'Planned classes', metric: a.sessions.planned },
                { label: 'Delivered', metric: a.sessions.delivered },
                { label: 'Cancelled', metric: a.sessions.cancelled },
                { label: 'Substituted', metric: a.sessions.substituted },
                { label: 'Teaching logs pending', metric: a.logsPending },
                { label: 'Attendance not recorded', metric: a.attendancePending },
                { label: 'Marking pending', metric: a.markingPending },
              ]}
            />
          ) : t.activity.status === 'unavailable' ? (
            <Unavailable name="Academic OS" result={t.activity} />
          ) : null}
        </Segment>
      ),
    },
    {
      key: 'tasks',
      label: 'Tasks and updates',
      content: (
        <Segment
          title="Tasks and updates"
          level={level}
          flush
          description="Operational tasks in Business Ops. A task update is not attendance and does not prove a class was taught."
          actions={
            t.tasks ? (
              <a href={`/ops/tasks?tab=all&staffId=${t.staff.id}`}>Open tasks</a>
            ) : undefined
          }
        >
          {t.tasks ? (
            <DetailTable
              rows={[
                { label: 'Open tasks', value: String(t.tasks.open) },
                { label: 'Overdue', value: String(t.tasks.overdue) },
                { label: 'Today’s EOD report', value: humanise(t.tasks.eodToday) },
              ]}
            />
          ) : (
            needs('ops:tasks:read for this teacher (yourself or your reports)')
          )}
        </Segment>
      ),
    },
    {
      key: 'appointments',
      label: 'Appointments',
      count: t.upcoming?.length ?? null,
      content: (
        <Segment title="Upcoming appointments" level={level} flush>
          {t.upcoming === null ? (
            needs('ops:appointments:read')
          ) : (
            <RecordTable
              rows={t.upcoming}
              rowKey={(x) => x.id}
              rowHref={(x) => `/ops/meetings?open=${x.id}`}
              empty="Nothing booked from today."
              columns={[
                { key: 'when', header: 'When', render: (x) => fmtDateTime(x.startsAt) },
                { key: 'type', header: 'Type', render: (x) => <TypeBadge type={x.type} /> },
                {
                  key: 'who',
                  header: 'Student',
                  render: (x) => (
                    <>
                      {x.personName} <SampleBadge show={x.studentSample} />
                    </>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (x) => <ApptStatus status={x.status} />,
                },
              ]}
            />
          )}
        </Segment>
      ),
    },
    {
      key: 'reviews',
      label: 'Student reviews authored',
      count:
        t.reviewsAuthored?.status === 'available'
          ? t.reviewsAuthored.reviews.filter((r) => !r.superseded).length
          : null,
      content: (
        <>
          <Segment
            title="Student reviews this teacher wrote"
            level={level}
            description="Submitted in Academic OS; you see those about students in your scope. These are a teacher's reviews of students. There is no manager appraisal of teachers in Elevate OS, and nothing here rates the teacher."
          >
            <AcademicReviewList
              result={t.reviewsAuthored}
              user={user}
              showStudent
              heading={level === 3 ? 'h4' : 'h3'}
            />
          </Segment>
          {t.reviewsAuthored ? (
            <DemoReviewsDue staffId={t.staff.id} user={user} level={level} />
          ) : null}
          {t.feedbackWritten?.length ? (
            <Segment
              title="Earlier reviews — recorded in Business Ops before 21 Oct 2026"
              level={level}
              flush
              description="Read-only history; latest version of each."
            >
              <RecordTable
                rows={t.feedbackWritten}
                rowKey={(f) => f.id}
                columns={[
                  { key: 'on', header: 'Date', render: (f) => fmtDate(f.observedOn) },
                  {
                    key: 'student',
                    header: 'Student',
                    render: (f) => (
                      <>
                        {f.studentName} <SampleBadge show={f.studentSample} />
                      </>
                    ),
                  },
                  { key: 'subject', header: 'Subject' },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (f) =>
                      `${f.status === 'final' ? REVIEW_STATE_LABELS.submitted : REVIEW_STATE_LABELS.draft}, version ${f.version}`,
                  },
                ]}
              />
            </Segment>
          ) : null}
        </>
      ),
    },
    {
      key: 'feedback',
      label: 'Feedback about the teacher',
      count: about?.rows.length ?? null,
      content: (
        <Segment
          title="Feedback from students and guardians"
          level={level}
          flush
          description="Recorded by staff on their behalf and moderated. The teacher cannot edit it."
          actions={
            can(user, 'ops:teacher_feedback:manage') ? (
              <a href={actHref('feedback')}>Record feedback</a>
            ) : undefined
          }
        >
          {about === null ? (
            needs('ops:teacher_feedback:read')
          ) : (
            <>
              <DetailTable
                caption="Feedback summary"
                rows={[
                  { label: 'Approved', value: String(about.summary.approved) },
                  {
                    label: 'Average rating',
                    value:
                      about.summary.averageRating === null
                        ? 'No ratings given'
                        : `${about.summary.averageRating.toFixed(1)} of 5 (${about.summary.rated} rated)`,
                  },
                ]}
              />
              <RecordTable
                rows={about.rows}
                rowKey={(f) => f.id}
                empty="No feedback to show."
                columns={[
                  { key: 'on', header: 'Date', render: (f) => fmtDate(f.feedbackOn) },
                  { key: 'by', header: 'From', render: (f) => humanise(f.submittedByKind) },
                  {
                    key: 'rating',
                    header: 'Rating',
                    render: (f) => (f.rating === null ? 'Not rated' : `${f.rating} of 5`),
                  },
                  { key: 'comment', header: 'Comment' },
                  {
                    key: 'state',
                    header: 'Moderation',
                    render: (f) => (
                      <div className="el-stack">
                        <StatusBadge tone={MODERATION_TONE[f.moderationStatus]}>
                          {humanise(f.moderationStatus)}
                        </StatusBadge>
                        {moderate && f.moderationStatus !== 'rejected' ? (
                          <ActionForm
                            action={`/ops/api/v1/feedback/about-teachers/${f.id}`}
                            method="PATCH"
                            submitLabel="Save decision"
                            labelSuffix={` for the ${fmtDate(f.feedbackOn)} feedback`}
                            compact
                            variant="secondary"
                            fields={[
                              {
                                name: 'action',
                                label: 'Decision',
                                type: 'select',
                                required: true,
                                options: [
                                  { value: 'approve', label: 'Approve' },
                                  { value: 'reject', label: 'Reject' },
                                  { value: 'hide', label: 'Hide' },
                                ],
                              },
                              {
                                name: 'visibility',
                                label: 'Visible to',
                                type: 'select',
                                options: [
                                  { value: 'staff_only', label: 'Staff only' },
                                  { value: 'teacher_and_staff', label: 'Teacher and staff' },
                                ],
                              },
                            ]}
                          />
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            </>
          )}
        </Segment>
      ),
    },
    {
      key: 'eod',
      label: 'EOD history',
      count: t.eods?.length ?? null,
      content: (
        <Segment
          title="EOD reports and manager responses"
          level={level}
          flush
          description="The teacher's own end-of-day summaries; a manager sees the ones sent to them."
          actions={t.eods ? <a href={`/ops/tasks/inbox`}>Open in the manager inbox</a> : undefined}
        >
          {t.eods === null ? (
            needs('ops:tasks:read for this teacher (yourself or your reports)')
          ) : (
            <RecordTable
              rows={t.eods}
              rowKey={(e) => e.id}
              empty="No EOD report yet."
              columns={[
                { key: 'date', header: 'Day', render: (e) => fmtDate(e.reportDate) },
                { key: 'status', header: 'Status', render: (e) => humanise(e.status) },
                { key: 'sent', header: 'Submitted', render: (e) => fmtDateTime(e.submittedAt) },
                { key: 'reviewed', header: 'Reviewed', render: (e) => fmtDateTime(e.reviewedAt) },
              ]}
            />
          )}
        </Segment>
      ),
    },
    {
      key: 'documents',
      label: 'Documents',
      content: (
        <Segment title="Documents" level={level}>
          <p>
            No protected file storage yet: employment and operational documents are not kept in
            Elevate OS. Identity documents and salary are never shown here.
          </p>
        </Segment>
      ),
    },
    {
      key: 'history',
      label: 'Timeline and sources',
      count: t.history.length,
      content: (
        <>
          <Segment title="Where each fact comes from" level={level} flush>
            <RecordTable
              rows={sources}
              rowKey={(x) => x.source}
              columns={[
                { key: 'source', header: 'Source', render: (x) => x.source },
                { key: 'state', header: 'Status', render: (x) => x.state },
              ]}
            />
          </Segment>
          <Segment title="Change history" level={level} flush>
            <RecordTable
              rows={t.history}
              rowKey={(h) => h.id}
              empty="No changes recorded in Elevate OS."
              columns={[
                { key: 'at', header: 'When', render: (h) => fmtDateTime(h.at) },
                {
                  key: 'action',
                  header: 'Change',
                  render: (h) => humanise(h.action.replace('.', ' ')),
                },
                { key: 'by', header: 'By', render: (h) => h.actorName ?? 'System' },
              ]}
            />
          </Segment>
        </>
      ),
    },
  ];
}

export const TEACHER_ACTS = ['edit', 'feedback'] as const;
export type TeacherAct = (typeof TEACHER_ACTS)[number];

export function TeacherActModal({
  act,
  t,
  user,
  closeHref,
}: {
  act: TeacherAct;
  t: TeacherProfile;
  user: AuthenticatedUser;
  closeHref: string;
}) {
  const flows: Record<TeacherAct, { title: string; allowed: boolean; form: ActionFormProps }> = {
    edit: {
      title: 'Edit teacher details',
      allowed: can(user, 'ops:teachers:manage'),
      form: {
        action: `/ops/api/v1/teachers/${t.staff.id}`,
        method: 'PATCH',
        submitLabel: 'Save teacher details',
        fields: [
          {
            name: 'displayName',
            label: 'Display name',
            defaultValue: t.displayName,
            section: 'Teacher',
          },
          {
            name: 'staffCode',
            label: 'Staff code',
            defaultValue: t.profile?.staffCode ?? '',
            section: 'Teacher',
          },
          {
            name: 'roleNote',
            label: 'Other role',
            defaultValue: t.profile?.roleNote ?? '',
            section: 'Teacher',
          },
          {
            name: 'verificationStatus',
            label: 'Name verification',
            type: 'select',
            defaultValue: t.profile?.verificationStatus ?? 'unverified',
            options: [
              { value: 'unverified', label: 'Unverified' },
              { value: 'confirmed', label: 'Confirmed by the owner' },
            ],
            section: 'Teacher',
          },
          {
            name: 'subjects',
            label: 'Subjects (comma separated)',
            type: 'list',
            defaultValue: t.subjects.map((s) => s.subject).join(', '),
            section: 'Subjects',
          },
        ],
      },
    },
    feedback: {
      title: 'Record feedback',
      allowed: can(user, 'ops:teacher_feedback:manage'),
      form: {
        action: '/ops/api/v1/feedback/about-teachers',
        submitLabel: 'Record feedback',
        extra: { teacherStaffId: t.staff.id },
        fields: [
          {
            name: 'submittedByKind',
            label: 'Given by',
            type: 'select',
            required: true,
            options: [
              { value: 'student', label: 'Student' },
              { value: 'guardian', label: 'Guardian' },
            ],
            section: 'Who and when',
          },
          {
            name: 'feedbackOn',
            label: 'Date given',
            type: 'date',
            required: true,
            section: 'Who and when',
          },
          { name: 'subjectRef', label: 'Subject or batch', section: 'Feedback' },
          { name: 'rating', label: 'Rating (1–5, optional)', type: 'number', section: 'Feedback' },
          {
            name: 'comment',
            label: 'Feedback',
            type: 'textarea',
            required: true,
            section: 'Feedback',
          },
        ],
      },
    },
  };
  const flow = flows[act];
  if (!flow.allowed) return null;
  return (
    <FormModal
      id={`teacher-${act}`}
      title={`${flow.title}: ${t.displayName}`}
      closeHref={closeHref}
    >
      <ActionForm
        {...flow.form}
        // Router path: Next adds the /ops basePath itself (D-022).
        redirectTo={closeHref.replace(/^\/ops/, '')}
        secondary={<a href={closeHref}>Cancel</a>}
      />
    </FormModal>
  );
}

/** Demo classes this teacher took where the student attended and no review is submitted yet. */
async function DemoReviewsDue({
  staffId,
  user,
  level,
}: {
  staffId: string;
  user: AuthenticatedUser;
  level: 2 | 3;
}) {
  const r = await load((db) => demoReviewsDue(db, user, staffId));
  const write = isTeacher(user);
  return (
    <Segment
      title="Demo classes waiting for a review"
      level={level}
      flush
      description={`Demo classes in the last ${REVIEWS_DUE_DAYS} days. Pending is not a mark against anyone: it only means no review is submitted yet. Teachers write reviews in Academic OS.`}
    >
      {r.ok && !r.data.shared ? (
        <p className="el-field-hint">Not shared with you.</p>
      ) : r.ok ? (
        <>
          {r.data.unavailable ? (
            <Alert
              tone="warning"
              title="Academic OS unavailable — some of these may already be reviewed"
            >
              Checked {fmtDateTime(r.data.unavailable.checkedAt)} ({r.data.unavailable.reason}).
            </Alert>
          ) : null}
          <RecordTable
            rows={r.data.rows}
            rowKey={(x) => `${x.id}-${x.teacherStaffId}`}
            empty="No demo class is waiting for a review."
            columns={[
              {
                key: 'student',
                header: 'Student',
                render: (x) => (
                  <>
                    {x.studentName} <SampleBadge show={x.isSample} />
                  </>
                ),
              },
              { key: 'day', header: 'Demo day', numeric: true, render: (x) => x.dayNumber },
              { key: 'when', header: 'Class', render: (x) => fmtDateTime(x.startsAt) },
              { key: 'subject', header: 'Subject', render: (x) => x.subject ?? 'Not recorded' },
              {
                key: 'state',
                header: 'Review',
                render: (x) =>
                  x.onRoster === null ? (
                    'Source unavailable'
                  ) : !x.onRoster ? (
                    'Not on an Academic class roster — ask the academic coordinator to add the student.'
                  ) : write ? (
                    <a
                      href={writeReviewHref({ coreStudentId: x.studentId, opsDemoSessionId: x.id })}
                    >
                      Write review in Academic OS
                      <span className="el-visually-hidden">
                        {' '}
                        for {x.studentName}, day {x.dayNumber}
                      </span>
                    </a>
                  ) : (
                    REVIEW_STATE_LABELS.pending
                  ),
              },
            ]}
          />
        </>
      ) : (
        r.view
      )}
    </Segment>
  );
}
