/**
 * Teacher reviews of a student, read from Academic OS (owner answer 21 Oct 2026, supersedes
 * D-043; server/academic-reviews.ts). Teachers write and submit them in Academic; Ops shows the
 * submitted versions (withdrawn hidden, edits marked), lets permitted staff acknowledge a version
 * and add Ops' own follow-up, and never edits the teacher's words. Reviews recorded in Business
 * Ops before 21 Oct 2026 stay below as read-only history. Student/guardian feedback ABOUT
 * teachers lives on each teacher's profile (moderated).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { StudentIdentityId } from '@elevate/shared-types';
import { StatusBadge, type Column } from '@elevate/shared-ui';
import { studentReviews, writeReviewHref, type ReviewsResult } from '../server/academic-reviews';
import { listStudentFeedback } from '../server/feedback';
import { ActionForm } from './action-form';
import { Unavailable } from './cross-module';
import { fmtDate, fmtDateTime, humanise } from './format';
import { load } from './frame';
import { RecordTable } from './record-table';
import { DetailTable, Segment } from './sections';

const TITLE = 'Teacher reviews';
const LEGACY = 'Recorded in Business Ops before 21 Oct 2026';
const WHERE_OTHER =
  'Written and submitted by teachers in Academic OS. Internal remarks never reach parents or students. Feedback from students and guardians about teachers is kept on each teacher’s profile.';

type Review = Extract<ReviewsResult, { status: 'available' }>['reviews'][number];

/** Whether the signed-in person teaches (the Academic review form is theirs to use). */
export const isTeacher = (user: AuthenticatedUser) => user.roles.includes('teacher');

/** Academic reviews with their acknowledgements; "Source unavailable" when Academic is down. */
export function AcademicReviewList({
  result,
  user,
  showStudent = false,
  heading: Heading = 'h3',
  batchNames,
}: {
  result: ReviewsResult | null;
  user: AuthenticatedUser;
  /** Academic batch id → name, from what this page already received from Academic. */
  batchNames?: ReadonlyMap<string, string>;
  /** On a teacher's profile each review names its student. */
  showStudent?: boolean;
  /** One level below the surrounding Segment's heading. */
  heading?: 'h3' | 'h4';
}) {
  if (!result) return <p className="el-field-hint">Needs permission ops:feedback:read.</p>;
  if (result.status === 'unavailable')
    return (
      <Unavailable
        name="Academic OS reviews"
        result={{ reason: result.reason, fetchedAt: result.checkedAt }}
      />
    );
  const current = result.reviews.filter((r) => !r.superseded);
  if (!current.length)
    return (
      <p>
        No submitted review. A review appears here once the teacher submits it in Academic OS; no
        review is not a mark against the student.
      </p>
    );
  return (
    <div className="el-stack">
      {current.map((r) => {
        const older = result.reviews.filter((o) => o.reviewKey === r.reviewKey && o.superseded);
        return (
          <article key={`${r.reviewKey}:${r.version}`} className="el-stack">
            <Heading>
              {r.subjectName ?? 'Subject not recorded'}, {when(r)}{' '}
              <StatusBadge tone="success">Submitted</StatusBadge>{' '}
              {r.version > 1 ? (
                <StatusBadge tone="info">Edited — version {r.version}</StatusBadge>
              ) : null}
            </Heading>
            <DetailTable
              caption={`Review by ${r.authorName}`}
              rows={[
                { label: 'Teacher', value: r.authorName },
                showStudent && { label: 'Student', value: r.studentName },
                { label: 'Type', value: humanise(r.reviewType) },
                !!r.observationOn && { label: 'Observed on', value: fmtDate(r.observationOn) },
                !!r.batchId && {
                  label: 'Batch',
                  value: batchNames?.get(r.batchId) ?? 'Batch recorded in Academic',
                },
                { label: 'Strengths', value: r.strengths ?? 'None recorded' },
                { label: 'Areas needing support', value: r.areasForSupport ?? 'None recorded' },
                !!r.attendanceEvidence && {
                  label: 'Attendance and engagement',
                  value: r.attendanceEvidence,
                },
                !!r.homeworkEvidence && {
                  label: 'Homework and practice',
                  value: r.homeworkEvidence,
                },
                !!r.academicConcerns && { label: 'Academic concerns', value: r.academicConcerns },
                { label: 'Suggested next step', value: r.suggestedAction ?? 'None recorded' },
                {
                  label: 'Teacher follow-up',
                  value: r.followUpOn ? fmtDate(r.followUpOn) : 'None',
                },
                {
                  label: 'Visibility',
                  value:
                    r.visibility === 'shareable'
                      ? 'Strengths, areas and next step may go into a reviewed parent/student report'
                      : 'Internal staff only',
                },
                { label: 'Submitted', value: fmtDateTime(r.submittedAt) },
                // The Academic page checks access itself; the link is offered to its users only.
                can(user, 'academic:module:access') && {
                  label: 'Source',
                  value: <a href={r.sourcePath}>Open in Academic OS</a>,
                },
              ]}
            />
            {older.length ? (
              <p className="el-field-hint">
                Earlier version{older.length === 1 ? '' : 's'}{' '}
                {older.map((o) => `${o.version} (${fmtDateTime(o.submittedAt)})`).join(', ')}{' '}
                superseded by the teacher; open the source to compare.
              </p>
            ) : null}
            <Acknowledgements r={r} user={user} />
          </article>
        );
      })}
    </div>
  );
}

const ackDetailColumns: Column<Review['acknowledgements'][number]>[] = [
  { key: 'note', header: 'Note', render: (a) => a.note ?? '—' },
  {
    key: 'follow',
    header: 'Ops follow-up (Ops’ own words)',
    render: (a) =>
      a.followUp ? `${a.followUp}${a.followUpOn ? ` (by ${fmtDate(a.followUpOn)})` : ''}` : '—',
  },
];

const when = (r: Review) =>
  r.sessionDate
    ? fmtDate(r.sessionDate)
    : r.periodFrom && r.periodTo
      ? `${fmtDate(r.periodFrom)} to ${fmtDate(r.periodTo)}`
      : `submitted ${fmtDateTime(r.submittedAt)}`;

function Acknowledgements({ r, user }: { r: Review; user: AuthenticatedUser }) {
  const mine = r.acknowledgements.some((a) => a.byUserId === user.id);
  // Ops' notes and follow-ups reach holders of ops:feedback:acknowledge only (the server blanks them).
  const details = can(user, 'ops:feedback:acknowledge');
  return (
    <>
      {r.acknowledgements.length ? (
        <RecordTable
          caption="Acknowledged in Business Ops"
          rows={r.acknowledgements}
          rowKey={(a) => a.id}
          columns={[
            { key: 'by', header: 'By', render: (a) => `${a.by}, ${fmtDateTime(a.at)}` },
            ...(details ? ackDetailColumns : []),
          ]}
        />
      ) : null}
      {can(user, 'ops:feedback:acknowledge') && !mine && r.coreStudentId ? (
        <details>
          <summary>Acknowledge this review</summary>
          <ActionForm
            action="/ops/api/v1/review-acks"
            submitLabel="Acknowledge review"
            successText="Acknowledged."
            labelSuffix={` (${r.authorName}, version ${r.version})`}
            variant="secondary"
            extra={{ coreStudentId: r.coreStudentId, reviewKey: r.reviewKey, version: r.version }}
            fields={[
              { name: 'note', label: 'Note (optional)', type: 'textarea' },
              { name: 'followUp', label: 'Ops follow-up (optional)', type: 'textarea' },
              { name: 'followUpOn', label: 'Follow-up date', type: 'date' },
            ]}
          />
        </details>
      ) : null}
    </>
  );
}

export async function StudentFeedbackSection({
  studentId,
  academicStudentId,
  user,
  batchNames,
}: {
  studentId: StudentIdentityId;
  /** The Academic student record, once the student is enrolled there (the review form needs it). */
  academicStudentId: string | null;
  user: AuthenticatedUser;
  batchNames?: Promise<ReadonlyMap<string, string>>;
}) {
  const write =
    isTeacher(user) && academicStudentId ? (
      <a href={writeReviewHref({ studentId: academicStudentId })}>Write review in Academic OS</a>
    ) : undefined;
  if (!can(user, 'ops:feedback:read'))
    return (
      <Segment title={TITLE} description={WHERE_OTHER} actions={write}>
        <p className="el-field-hint">Needs permission ops:feedback:read.</p>
      </Segment>
    );
  const r = await load(async (db) => ({
    academic: await studentReviews(db, user, studentId),
    legacy: await listStudentFeedback(db, user, studentId),
  }));
  if (!r.ok)
    return (
      <Segment title={TITLE} description={WHERE_OTHER} actions={write}>
        {r.view}
      </Segment>
    );
  const { academic, legacy } = r.data;
  return (
    <>
      <Segment title={TITLE} description={WHERE_OTHER} actions={write}>
        <AcademicReviewList result={academic} user={user} batchNames={await batchNames} />
      </Segment>
      {legacy.length ? (
        <Segment title={`Earlier reviews — ${LEGACY}`} flush description="Read-only history.">
          <RecordTable
            rows={legacy}
            rowKey={(f) => f.id}
            columns={[
              { key: 'on', header: 'Date', render: (f) => fmtDate(f.observedOn) },
              { key: 'teacher', header: 'Teacher', render: (f) => f.teacherName },
              { key: 'subject', header: 'Subject' },
              {
                key: 'status',
                header: 'Status',
                render: (f) =>
                  `${f.status === 'final' ? 'Submitted' : 'Draft'}, version ${f.version}${f.superseded ? ' (superseded)' : ''}`,
              },
              {
                key: 'text',
                header: 'Observation, strengths, support, next step',
                render: (f) =>
                  [f.observations, f.strengths, f.areasToImprove, f.actionPlan]
                    .filter(Boolean)
                    .join(' · '),
              },
            ]}
          />
        </Segment>
      ) : null}
    </>
  );
}
