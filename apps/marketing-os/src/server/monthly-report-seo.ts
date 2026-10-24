/**
 * SEO / AIO / GEO rows of a monthly report: the person's items with work done in the month (new
 * evidence or a review step), in their state at the cut-off, rebuilt from the audit trail that
 * every change writes (server/optimisation.ts). Due dates and the current row are not used.
 */
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { auditEvents, marketingOptimisationItems as opt, type Database } from '@elevate/database';

type Row = { topic: string; categoryKey: string; evidence: string | null };
const REVIEW_STEPS = [
  'optimisation_item.submitted',
  'optimisation_item.approved',
  'optimisation_item.changes_requested',
];
const EDITS = ['optimisation_item.created', 'optimisation_item.updated'];

export async function optimisationWorkAsOf(
  db: Database,
  staffId: string,
  /** [start, end): the month, `end` already cut at the report's cut-off. */
  start: Date,
  end: Date,
) {
  const owned = await db
    .select({ id: opt.id, isSample: opt.isSample })
    .from(opt)
    .where(eq(opt.ownerStaffId, staffId as never))
    .orderBy(asc(opt.createdAt));
  if (!owned.length) return [];
  const events = await db
    .select({
      itemId: auditEvents.entityId,
      action: auditEvents.action,
      at: auditEvents.at,
      before: auditEvents.before,
      after: auditEvents.after,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.module, 'marketing'),
        eq(auditEvents.entityType, 'optimisation_item'),
        inArray(
          auditEvents.entityId,
          owned.map((o) => o.id),
        ),
        lt(auditEvents.at, end),
      ),
    )
    .orderBy(asc(auditEvents.at));
  const evidenceOf = (v: unknown) => (v as Row | null)?.evidence ?? null;
  return owned.flatMap((o) => {
    const mine = events.filter((e) => e.itemId === o.id);
    const worked = mine.some(
      (e) =>
        e.at >= start &&
        (REVIEW_STEPS.includes(e.action) ||
          (e.action === 'optimisation_item.updated' &&
            evidenceOf(e.before) !== evidenceOf(e.after))),
    );
    const row = mine.filter((e) => EDITS.includes(e.action)).at(-1)?.after as Row | undefined;
    if (!worked || !row) return [];
    const step = mine.filter((e) => REVIEW_STEPS.includes(e.action)).at(-1);
    return [
      {
        itemId: o.id,
        categoryKey: row.categoryKey,
        topic: row.topic,
        reviewState: step ? step.action.replace('optimisation_item.', '') : 'draft',
        evidence: row.evidence ?? null,
        isSample: o.isSample,
      },
    ];
  });
}
