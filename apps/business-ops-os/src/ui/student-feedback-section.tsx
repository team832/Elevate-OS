/**
 * Student profile section: teacher reviews of the student (owner brief §8H; 21 Oct §5), the
 * single review store (feedback service: ../server/feedback). A review references a demo class,
 * an enrolment or neither; Draft and Submitted are distinct; Internal by default. Raw reviews
 * are for authorised staff only. Versions: a submitted review is never overwritten — an edit
 * adds a version, older ones are listed under it. Student/guardian feedback ABOUT teachers is
 * not shown here; it lives on each teacher's profile (moderated).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { StudentIdentityId } from '@elevate/shared-types';
import { StatusBadge } from '@elevate/shared-ui';
import { REVIEW_STATE_LABELS } from '../domain/feedback';
import { listStudentFeedback, reviewTargets } from '../server/feedback';
import { listTeachers } from '../server/teachers';
import { ActionForm, type FieldSpec } from './action-form';
import { fmtDate, fmtDateTime } from './format';
import { load } from './frame';
import { RecordTable } from './record-table';
import { DetailTable, Segment } from './sections';

const TITLE = 'Teacher reviews';
const WHERE_OTHER =
  'Internal: raw reviews never reach parents or students. Feedback from students and guardians about teachers is kept on each teacher’s profile.';

const SCOPE_LABELS = {
  demo_session: 'A demo class',
  enrolment: 'An Academic enrolment',
  general: 'General',
} as const;
const stateLabel = (status: string) =>
  status === 'final' ? REVIEW_STATE_LABELS.submitted : REVIEW_STATE_LABELS.draft;

const fields = (f?: {
  [
    K in
      | 'subject'
      | 'observedOn'
      | 'relatedRef'
      | 'observations'
      | 'strengths'
      | 'areasToImprove'
      | 'actionPlan'
      | 'status'
      | 'visibility'
  ]?: string | null;
}): FieldSpec[] => [
  { name: 'subject', label: 'Subject', required: true, defaultValue: f?.subject ?? '' },
  {
    name: 'observedOn',
    label: 'Date observed',
    type: 'date',
    required: true,
    defaultValue: f?.observedOn ?? '',
  },
  {
    name: 'relatedRef',
    label: 'Related class or test (optional)',
    defaultValue: f?.relatedRef ?? '',
  },
  {
    name: 'observations',
    label: 'Observation (internal only, never in parent or student reports)',
    type: 'textarea',
    required: true,
    defaultValue: f?.observations ?? '',
  },
  { name: 'strengths', label: 'Strengths', type: 'textarea', defaultValue: f?.strengths ?? '' },
  {
    name: 'areasToImprove',
    label: 'Areas needing support',
    type: 'textarea',
    defaultValue: f?.areasToImprove ?? '',
  },
  {
    name: 'actionPlan',
    label: 'Suggested next step',
    type: 'textarea',
    defaultValue: f?.actionPlan ?? '',
  },
  {
    name: 'visibility',
    label: 'Who may see it',
    type: 'select',
    required: true,
    defaultValue: f?.visibility ?? 'internal',
    options: [
      { value: 'internal', label: 'Internal staff only' },
      {
        value: 'shareable',
        label: 'Strengths, areas and next step may go into a reviewed parent/student report',
      },
    ],
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    defaultValue: f?.status ?? 'draft',
    options: [
      { value: 'draft', label: 'Draft (can still be edited in place)' },
      { value: 'final', label: 'Submitted (later edits add a new version)' },
    ],
  },
];

export async function StudentFeedbackSection({
  studentId,
  user,
  readOnly = false,
}: {
  studentId: StudentIdentityId;
  user: AuthenticatedUser;
  /** No forms (the printed report). */
  readOnly?: boolean;
}) {
  if (!can(user, 'ops:feedback:read'))
    return (
      <Segment title={TITLE} description={WHERE_OTHER}>
        <p className="el-field-hint">Needs permission ops:feedback:read.</p>
      </Segment>
    );
  const manage = !readOnly && can(user, 'ops:feedback:manage');
  const write = manage || (!readOnly && can(user, 'ops:feedback:write'));
  const r = await load(async (db) => ({
    rows: await listStudentFeedback(db, user, studentId),
    teachers: manage ? (await listTeachers(db, user)).teachers : [],
    targets: write ? await reviewTargets(db, studentId) : null,
  }));
  if (!r.ok)
    return (
      <Segment title={TITLE} description={WHERE_OTHER}>
        {r.view}
      </Segment>
    );
  const { rows, teachers, targets } = r.data;
  const byId = new Map(rows.map((f) => [f.id, f]));
  const olderVersions = (f: (typeof rows)[number]) => {
    const out = [];
    for (
      let p = f.supersedesId ? byId.get(f.supersedesId) : undefined;
      p;
      p = p.supersedesId ? byId.get(p.supersedesId) : undefined
    )
      out.push(p);
    return out;
  };
  const current = rows.filter((f) => !f.superseded);
  const sessions = targets?.sessions ?? [];
  const enrolments = targets?.enrolments ?? [];
  return (
    <Segment title={TITLE} description={WHERE_OTHER}>
      <div className="el-stack">
        {current.length === 0 ? (
          <p>No teacher review yet.{write ? ' Add one with “Add a review” below.' : ''}</p>
        ) : null}
        {current.map((f) => {
          const older = olderVersions(f);
          return (
            <article key={f.id} className="el-stack">
              <h3>
                {f.subject}, {fmtDate(f.observedOn)}{' '}
                <StatusBadge tone={f.status === 'final' ? 'success' : 'neutral'}>
                  {stateLabel(f.status)}, version {f.version}
                </StatusBadge>
              </h3>
              <DetailTable
                caption={`Review of ${f.subject}`}
                rows={[
                  { label: 'Teacher', value: f.teacherName },
                  { label: 'About', value: SCOPE_LABELS[f.scope] },
                  { label: 'Observation', value: f.observations },
                  { label: 'Strengths', value: f.strengths ?? 'None recorded' },
                  { label: 'Areas needing support', value: f.areasToImprove ?? 'None recorded' },
                  { label: 'Suggested next step', value: f.actionPlan ?? 'None recorded' },
                  {
                    label: 'Visibility',
                    value:
                      f.visibility === 'shareable'
                        ? 'Shareable in reviewed reports (never the observation)'
                        : 'Internal staff only',
                  },
                  { label: 'Written', value: fmtDateTime(f.createdAt) },
                  !!f.relatedRef && { label: 'Related to', value: f.relatedRef },
                ]}
              />
              {older.length ? (
                <RecordTable
                  caption={`Earlier versions (${older.length})`}
                  rows={older}
                  rowKey={(v) => v.id}
                  columns={[
                    { key: 'v', header: 'Version', numeric: true, render: (v) => v.version },
                    { key: 's', header: 'Status', render: (v) => stateLabel(v.status) },
                    { key: 'at', header: 'Written', render: (v) => fmtDateTime(v.createdAt) },
                    { key: 'o', header: 'Observation', render: (v) => v.observations },
                  ]}
                />
              ) : null}
              {write ? (
                <details>
                  <summary>Edit this review</summary>
                  <ActionForm
                    action={`/ops/api/v1/feedback/about-students/${f.id}`}
                    method="PATCH"
                    submitLabel={f.status === 'final' ? 'Save as new version' : 'Save review'}
                    variant="secondary"
                    fields={fields(f)}
                  />
                </details>
              ) : null}
            </article>
          );
        })}
        {write ? (
          <details>
            <summary>Add a review</summary>
            <ActionForm
              action="/ops/api/v1/feedback/about-students"
              submitLabel="Save review"
              extra={{ studentId }}
              fields={[
                ...(manage
                  ? [
                      {
                        name: 'teacherStaffId',
                        label: 'Teacher',
                        type: 'select' as const,
                        required: true,
                        options: teachers.map((t) => ({ value: t.id, label: t.displayName })),
                      },
                    ]
                  : []),
                {
                  name: 'scope',
                  label: 'About',
                  type: 'select' as const,
                  required: true,
                  defaultValue: 'general',
                  options: [
                    { value: 'general', label: SCOPE_LABELS.general },
                    ...(sessions.length
                      ? [
                          {
                            value: 'demo_session',
                            label: `${SCOPE_LABELS.demo_session} (choose below)`,
                          },
                        ]
                      : []),
                    ...(enrolments.length
                      ? [{ value: 'enrolment', label: `${SCOPE_LABELS.enrolment} (choose below)` }]
                      : []),
                  ],
                },
                ...(sessions.length
                  ? [
                      {
                        name: 'demoSessionId',
                        label: 'Demo class',
                        type: 'select' as const,
                        hint: 'Only the teacher who took the class can review it.',
                        options: sessions.map((s) => ({
                          value: s.id,
                          label: `Day ${s.dayNumber} · ${fmtDateTime(s.startsAt)} · ${s.subject ?? 'Subject not recorded'} · ${s.teacherName ?? 'No teacher'}`,
                        })),
                      },
                    ]
                  : []),
                ...(enrolments.length
                  ? [
                      {
                        name: 'enrolmentId',
                        label: 'Enrolment',
                        type: 'select' as const,
                        options: enrolments.map((e) => ({ value: e.id, label: e.code })),
                      },
                    ]
                  : []),
                ...fields(),
              ]}
            />
          </details>
        ) : null}
      </div>
    </Segment>
  );
}
