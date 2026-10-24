/**
 * Result publication versions (brief §21, fnd-acd-contract "Publish"). Publishing makes the final
 * result run visible as version max + 1 with a ranking scope (whole roster or chosen cohort
 * batches), supersedes the current version and copies competition ranks (1, 2, 2, 4) to the
 * roster: present students with verified scores only. A final publication needs a complete roster;
 * a provisional one needs setting assessments.provisional_publication approved and on.
 */
import { and, eq, isNull } from 'drizzle-orm';
import {
  academicAssessmentRoster,
  academicAssessments,
  academicResultPublications,
  academicResultRuns,
  academicResults,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  type PUBLICATION_STATES,
} from '@elevate/shared-contracts';
import type { BatchId } from '@elevate/shared-types';
import { competitionRank, parseMarks } from '../../domain';
import { audit, type Actor } from '../context';
import {
  completenessIssues,
  eligibleBatchIds,
  rosterTally,
  type AssessmentRow,
} from './assessment-roster';
import { getSetting } from './settings';

const P = academicResultPublications;
const R = academicAssessmentRoster;

export async function provisionalAllowed(db: Database): Promise<boolean> {
  const s = await getSetting(db, 'assessments.provisional_publication');
  return s.status === 'approved' && s.value.allowed;
}

/** current ? (provisional ? provisional : published) : any withdrawn ? withdrawn : legacy published_at ? published : not published. */
export function publicationState(
  pubs: readonly { status: string; provisional: boolean }[],
  legacyPublishedAt: Date | null,
): (typeof PUBLICATION_STATES)[number] {
  const current = pubs.find((p) => p.status === 'current');
  if (current) return current.provisional ? 'provisional' : 'published';
  return pubs.some((p) => p.status === 'withdrawn')
    ? 'withdrawn'
    : legacyPublishedAt
      ? 'published'
      : 'not_published';
}

interface PublishInput {
  /** Expected new version (current highest + 1); omitted only by an automatic re-publication. */
  version?: number;
  rankingScope: 'roster' | 'cohort';
  cohortBatchIds?: string[] | null;
  provisional: boolean;
  note?: string | null;
}

/** Publish the final run of a locked, roster-managed, finalised assessment. */
export async function publishLocked(
  tx: Database,
  actor: Actor,
  a: AssessmentRow,
  input: PublishInput,
  auto = false,
) {
  if (!a.rosterSnapshotAt)
    throw new InvalidStateTransitionError(
      'This assessment has no roster; publish it from its Academic page.',
    );
  if (a.status !== 'finalised')
    throw new InvalidStateTransitionError('Finalise the results before publishing them.');
  const [run] = await tx
    .select()
    .from(academicResultRuns)
    .where(and(eq(academicResultRuns.assessmentId, a.id), eq(academicResultRuns.status, 'final')));
  if (!run) throw new InvalidStateTransitionError('No final result version exists.');
  const history = await tx.select().from(P).where(eq(P.assessmentId, a.id)).for('update');
  const next = Math.max(0, ...history.map((h) => h.version)) + 1;
  if (input.version !== undefined && input.version !== next)
    throw new ConflictError(`The next publication is version ${next}; reload before publishing.`, {
      details: { expectedVersion: next },
    });
  const cohort = input.rankingScope === 'cohort' ? (input.cohortBatchIds ?? []) : null;
  if (cohort) {
    const eligible = await eligibleBatchIds(tx, a);
    const outside = cohort.filter((b) => !eligible.includes(b as BatchId));
    if (outside.length || cohort.length === 0)
      throw new ValidationError('Cohort batches must be eligible batches of this assessment.', {
        details: { batchIds: outside },
      });
  }
  const tally = (await rosterTally(tx, [a.id])).get(a.id)!;
  const issues = completenessIssues(tally);
  if (issues.length && !input.provisional)
    throw new InvalidStateTransitionError(
      'The results are incomplete; resolve these issues or publish provisionally.',
      { details: { issues } },
    );
  if (input.provisional && !(await provisionalAllowed(tx)))
    throw new InvalidStateTransitionError(
      'Provisional publication is not allowed (setting assessments.provisional_publication); complete the roster first or withdraw the publication.',
      { details: { issues } },
    );

  const scored = await tx
    .select({ studentId: academicResults.studentId, total: academicResults.totalScore })
    .from(academicResults)
    .where(and(eq(academicResults.runId, run.id), eq(academicResults.state, 'scored')));
  const roster = await tx
    .select({ id: R.id, studentId: R.studentId, batchId: R.batchId })
    .from(R)
    .where(
      and(
        eq(R.assessmentId, a.id),
        isNull(R.removedAt),
        eq(R.attendance, 'present'),
        eq(R.marksState, 'verified'),
      ),
    );
  const inScope = new Map(
    roster
      .filter((r) => !cohort || cohort.includes(r.batchId))
      .map((r) => [r.studentId as string, r.id]),
  );
  const ranked = scored
    .filter((s) => inScope.has(s.studentId))
    .map((s) => ({ rosterId: inScope.get(s.studentId)!, units: parseMarks(s.total)! }));
  const totals = ranked.map((r) => r.units);

  const current = history.find((h) => h.status === 'current');
  if (current) await tx.update(P).set({ status: 'superseded' }).where(eq(P.id, current.id));
  const [pub] = await tx
    .insert(P)
    .values({
      assessmentId: a.id,
      version: next,
      resultRunId: run.id,
      rankingScope: input.rankingScope,
      cohortBatchIds: cohort as BatchId[] | null,
      provisional: input.provisional,
      completeness: tally.counts,
      note: input.note ?? null,
      publishedByUserId: actor.user.id,
    })
    .returning();
  await tx.update(R).set({ rank: null }).where(eq(R.assessmentId, a.id));
  for (const r of ranked)
    await tx
      .update(R)
      .set({ rank: competitionRank(r.units, totals) })
      .where(eq(R.id, r.rosterId));
  if (!a.publishedAt)
    await tx
      .update(academicAssessments)
      .set({ publishedAt: new Date(), publishedByUserId: actor.user.id })
      .where(eq(academicAssessments.id, a.id));
  await audit(tx, actor, {
    action: auto ? 'results.republished' : 'results.published',
    entityType: 'assessment',
    entityId: a.id,
    before: current ? { version: current.version, status: 'current' } : null,
    after: {
      version: next,
      resultVersion: run.version,
      rankingScope: input.rankingScope,
      cohortBatchIds: cohort,
      provisional: input.provisional,
      completeness: tally.counts,
      ranked: ranked.length,
    },
    metadata: { issues },
  });
  return pub!;
}

/**
 * After a re-score with a current version: publish the new run as version + 1 with the same scope.
 * A correction never turns a final publication provisional: if it leaves the roster incomplete
 * (and the current version is final, or provisional publication is no longer allowed), the current
 * version is withdrawn instead and the correction stands; Ops republishes once complete.
 */
export async function republishIfCurrent(tx: Database, actor: Actor, a: AssessmentRow) {
  const [current] = await tx
    .select()
    .from(P)
    .where(and(eq(P.assessmentId, a.id), eq(P.status, 'current')));
  if (!current) return null;
  const issues = completenessIssues((await rosterTally(tx, [a.id])).get(a.id)!);
  if (issues.length > 0 && (!current.provisional || !(await provisionalAllowed(tx)))) {
    await withdrawLocked(tx, actor, a, current.version, 'correction made results incomplete');
    return null;
  }
  return publishLocked(
    tx,
    actor,
    { ...a, status: 'finalised', publishedAt: a.publishedAt ?? new Date() },
    {
      rankingScope: current.rankingScope,
      cohortBatchIds: current.cohortBatchIds,
      provisional: issues.length > 0,
      note: 'Re-scored: published automatically as a new version.',
    },
    true,
  );
}

/** Withdraw the current publication (reason required): ranks cleared, results no longer published. */
export async function withdrawLocked(
  tx: Database,
  actor: Actor,
  a: AssessmentRow,
  version: number,
  reason: string,
) {
  const [pub] = await tx
    .select()
    .from(P)
    .where(and(eq(P.assessmentId, a.id), eq(P.version, version)))
    .for('update');
  if (!pub) throw new NotFoundError('Publication not found.');
  if (pub.status !== 'current')
    throw new ConflictError('Only the current publication can be withdrawn.');
  await tx
    .update(P)
    .set({
      status: 'withdrawn',
      withdrawnAt: new Date(),
      withdrawnByUserId: actor.user.id,
      withdrawnReason: reason,
    })
    .where(eq(P.id, pub.id));
  await tx.update(R).set({ rank: null }).where(eq(R.assessmentId, a.id));
  await tx
    .update(academicAssessments)
    .set({ publishedAt: null, publishedByUserId: null })
    .where(eq(academicAssessments.id, a.id));
  await audit(tx, actor, {
    action: 'results.withdrawn',
    entityType: 'assessment',
    entityId: a.id,
    before: { version, status: 'current' },
    after: { version, status: 'withdrawn' },
    metadata: { reason },
  });
}
