import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { ButtonLink, PageHeader } from '@elevate/shared-ui';
import { getBatch, listBatchPlacements, listBatches } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { BulkTransfer } from '../../../../ui/bulk-transfer';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Move students' };

/** F4-07: move several students of this batch to another batch of the same course (coordinators). */
export default async function MoveStudentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:enrolments:decide', `${MODULE_PATHS.batch(id)}/move`);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="batches">{null}</AcademicShell>;
  const db = getDb();
  const actor = actorFor(access.user);
  const data = await load(async () => ({ batch: await getBatch(db, actor, id), placements: await listBatchPlacements(db, actor, id), batches: await listBatches(db, actor) }));
  if (!data.ok) return <AcademicShell access={access} active="batches"><LoadError level={1} back="batches" error={data.error} /></AcademicShell>;
  const { batch: b, placements, batches } = data.data;
  const back = `${MODULE_PATHS.batch(b.id)}?tab=students`;
  return (
    <AcademicShell access={access} active="batches">
      <PageHeader
        title={`Move students — ${b.code}`}
        description="All or none: if one student cannot move (a clash, a full batch, a date before their start), nobody is moved and you see who and why."
        actions={<ButtonLink href={back}>Back to the batch</ButtonLink>}
      />
      <BulkTransfer
        from={{ id: b.id, code: b.code }}
        students={placements.filter((p) => p.endDate === null).map((p) => ({ enrolmentId: p.enrolmentId, studentName: p.studentName, startDate: p.startDate, isSample: p.isSample }))}
        targets={batches
          .filter((x) => x.id !== b.id && x.courseId === b.courseId && x.status !== 'completed' && x.status !== 'cancelled')
          .map((x) => ({ id: x.id, code: x.code, label: `${x.code} — ${x.name}${x.status === 'planning' ? ' (planning)' : ''}` }))}
        action={MODULE_PATHS.api('placements/bulk-transfer')}
        back={back}
      />
    </AcademicShell>
  );
}
