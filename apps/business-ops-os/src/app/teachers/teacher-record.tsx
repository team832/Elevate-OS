/**
 * One teacher, shared by the directory pop-up (`/ops/teachers?open=<id>`) and the
 * profile route (`/ops/teachers/<id>`): bordered sections as tabs, and the edit /
 * record-feedback flows in their own FormModal (`act=<key>`).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { StatusBadge } from '@elevate/shared-ui';
import { REVIEW_STATE_LABELS } from '../../domain/feedback';
import { demoReviewsDue } from '../../server/feedback';
import type { getTeacherProfile } from '../../server/teachers';
import { ActionForm, type ActionFormProps } from '../../ui/action-form';
import { load } from '../../ui/frame';
import { fmtDate, fmtDateTime, humanise } from '../../ui/format';
import { FormModal, type ModalTab } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';
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

export function teacherTabs(
  t: TeacherProfile,
  user: AuthenticatedUser,
  actHref: (act: TeacherAct) => string,
  level: 2 | 3,
): ModalTab[] {
  const moderate = can(user, 'ops:feedback:moderate');
  const about = t.feedbackAbout;
  return [
    {
      key: 'profile',
      label: 'Profile',
      content: (
        <>
          <Segment
            title="Subjects and role"
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
                { label: 'Staff status', value: humanise(t.staff.status) },
                { label: 'Staff code', value: t.profile?.staffCode ?? 'Not assigned' },
                { label: 'Source', value: t.profile?.sourceNote ?? 'Not recorded' },
                !!t.profile?.notes &&
                  can(user, 'ops:teachers:manage') && {
                    label: 'Internal note',
                    value: t.profile.notes,
                  },
                { label: 'Batches', value: `Not available: ${t.batches.reason}` },
                { label: 'Staff record', value: <a href={`/ops/staff/${t.staff.id}`}>Open</a> },
              ]}
            />
          </Segment>
          <Segment
            title="Workload"
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
              rowKey={(a) => a.id}
              rowHref={(a) => `/ops/meetings?open=${a.id}`}
              empty="Nothing booked from today."
              columns={[
                { key: 'when', header: 'When', render: (a) => fmtDateTime(a.startsAt) },
                { key: 'type', header: 'Type', render: (a) => <TypeBadge type={a.type} /> },
                {
                  key: 'who',
                  header: 'Student',
                  render: (a) => (
                    <>
                      {a.personName} <SampleBadge show={a.studentSample} />
                    </>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (a) => <ApptStatus status={a.status} />,
                },
              ]}
            />
          )}
        </Segment>
      ),
    },
    {
      key: 'feedback',
      label: 'Feedback',
      count: about?.rows.length ?? null,
      content: (
        <>
          <Segment
            title="Feedback from students and guardians"
            level={level}
            flush
            description="Recorded by staff on their behalf and moderated. The teacher cannot edit it."
            actions={
              can(user, 'ops:feedback:record') ? (
                <a href={actHref('feedback')}>Record feedback</a>
              ) : undefined
            }
          >
            {about === null ? (
              needs('ops:feedback:read')
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
          {t.feedbackWritten === null ? null : (
            <DemoReviewsDue staffId={t.staff.id} user={user} level={level} />
          )}
          <Segment
            title="Feedback this teacher wrote about students"
            level={level}
            flush
            description="Latest version of each note."
          >
            {t.feedbackWritten === null ? (
              needs('ops:feedback:read')
            ) : (
              <RecordTable
                rows={t.feedbackWritten}
                rowKey={(f) => f.id}
                empty="None written yet."
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
            )}
          </Segment>
        </>
      ),
    },
    {
      key: 'history',
      label: 'History',
      count: t.history.length,
      content: (
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
      allowed: can(user, 'ops:feedback:record'),
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

/** Demo classes this teacher took where the student attended and no review exists yet. */
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
  return (
    <Segment
      title="Demo classes waiting for a review"
      level={level}
      flush
      description="Pending is not a mark against anyone: it only means no review is written yet. Open the student to write it."
    >
      {r.ok ? (
        <RecordTable
          rows={r.data}
          rowKey={(x) => x.sessionId}
          rowHref={(x) => `/ops/students/${x.studentId}`}
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
            { key: 'state', header: 'Review', render: () => REVIEW_STATE_LABELS.pending },
          ]}
        />
      ) : (
        r.view
      )}
    </Segment>
  );
}
