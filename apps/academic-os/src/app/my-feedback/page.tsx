import { FeedbackDevelopmentBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../domain';
import { AcademicShell, gate } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feedback and development' };

/** A teacher's approved feedback summaries and agreed follow-ups (brief 23 Oct 2026 §15, D-073 body). */
export default async function MyFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate(
    'ops:teacher_feedback_summaries:read',
    `${MODULE.basePath}/my-feedback`,
  );
  return (
    <AcademicShell access={access} active="my-feedback">
      {access.status === 'allowed' ? (
        <FeedbackDevelopmentBody
          user={access.user}
          base={MODULE.basePath}
          searchParams={await searchParams}
        />
      ) : null}
    </AcademicShell>
  );
}
