import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { ButtonLink, Card, EmptyState, PageHeader } from '@elevate/shared-ui';
import { reviewChoices, reviewTarget, reviewableStudents } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { ApiForm } from '../../../ui/api-form';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';
import { reviewFields, typeField } from '../review-fields';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Write a review' };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

/** Prefilled from a class roster: `?studentId&sessionId` (enrolled) or `?coreStudentId&opsDemoSessionId` (demo). */
export default async function NewReviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('academic:reviews:write', MODULE_PATHS.newReview);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="reviews">{null}</AcademicShell>;
  const p = await searchParams;
  const ref = { studentId: one(p.studentId), sessionId: one(p.sessionId), coreStudentId: one(p.coreStudentId), opsDemoSessionId: one(p.opsDemoSessionId) };
  const db = getDb();
  const actor = actorFor(access.user);
  const prefilled = Boolean(ref.studentId || ref.coreStudentId);
  const data = await load(async () => ({ ...(prefilled ? { target: await reviewTarget(db, actor, ref), students: [] } : { target: null, students: await reviewableStudents(db, actor) }), choices: ref.coreStudentId ? undefined : await reviewChoices(db, actor) }));
  if (!data.ok) return <AcademicShell access={access} active="reviews"><LoadError error={data.error} /></AcademicShell>;
  const { target, students, choices } = data.data;
  const extra = target?.demo
    ? { coreStudentId: ref.coreStudentId, opsDemoSessionId: ref.opsDemoSessionId, sessionId: target.sessionId ?? undefined }
    : target
      ? { academicStudentId: ref.studentId, sessionId: ref.sessionId }
      : {};
  const studentField = target ? [] : [{ name: 'academicStudentId', label: 'Student', type: 'select' as const, required: true, options: students.map((s) => ({ value: s.id, label: `${s.fullName} (${s.code})` })) }];
  return (
    <AcademicShell access={access} active="reviews">
      <PageHeader
        title={target ? `Review — ${target.name}` : 'Write a review'}
        description="Write what you saw in class. A draft is visible only to you. Once published it is shared with coordinators, the student’s other teachers of the same subject and authorised Business Operations staff, and it is never edited: revise it as a new version or withdraw it. Student feedback about teachers is a separate record."
        actions={<ButtonLink href={MODULE_PATHS.reviews}>All reviews</ButtonLink>}
      />
      <Card>
        {!target && students.length === 0 ? (
          <EmptyState title="No students to review" description="You can review students placed in batches you are assigned to today. Open a class roster to review a demo student." />
        ) : (
          <ApiForm
            action={MODULE_PATHS.api('reviews')}
            extra={extra}
            fields={[...studentField, typeField(Boolean(target?.demo)), ...reviewFields({}, choices)]}
            submitLabel="Publish review"
            draftLabel="Save draft"
            successMessage="Published."
            stickyActions
            goTo="/reviews/{id}"
            idPrefix="review"
          />
        )}
      </Card>
    </AcademicShell>
  );
}
