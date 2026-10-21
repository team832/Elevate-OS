/**
 * Read-only figures for the platform Workspace overview (apps/platform/src/server/overview-adapter.ts).
 * Aggregate counts, not the list services: those stop at 500–1000 rows, so a total
 * read from them becomes unknown as soon as the data grows. Each function checks
 * its permission and applies the same record scope as the matching Ops page.
 */
import { and, count, countDistinct, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { opsAdmissions, opsLeads, programmes, type Database } from '@elevate/database';
import type { LeadId } from '@elevate/shared-types';
import { ADMISSION_STATUSES, isOpenStatus, type AdmissionStatus } from '../../domain';
import { ownAdmissionFilter } from '../admissions';
import { accessScope, type Actor } from '../context';
import { listFollowUps } from '../follow-ups';

const CLOSED_STATUSES = ADMISSION_STATUSES.filter((s) => !isOpenStatus(s));

/** Leads (not merged) with an admission case still open (domain isOpenStatus: not enrolled, lost or exited). */
export async function countOpenLeads(db: Database, actor: Actor): Promise<number> {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const [row] = await db
    .select({ n: countDistinct(opsLeads.id) })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(
      and(
        isNull(opsLeads.mergedIntoLeadId),
        notInArray(opsAdmissions.status, CLOSED_STATUSES),
        ownAdmissionFilter(access),
      ),
    );
  return row?.n ?? 0;
}

/** Admission cases by current status (merged leads excluded), scoped like the admissions board. */
export async function countAdmissionsByStatus(
  db: Database,
  actor: Actor,
): Promise<Partial<Record<AdmissionStatus, number>>> {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const rows = await db
    .select({ status: opsAdmissions.status, n: count() })
    .from(opsAdmissions)
    .innerJoin(
      opsLeads,
      and(eq(opsLeads.id, opsAdmissions.leadId), isNull(opsLeads.mergedIntoLeadId)),
    )
    .where(ownAdmissionFilter(access))
    .groupBy(opsAdmissions.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/**
 * Open follow-ups in the caller's scope (`ops:leads:read`), earliest due first, at most
 * 500 (the list service's limit). Names and the lead's programme only — no contact details.
 */
export async function openFollowUpsForOverview(db: Database, actor: Actor, now = new Date()) {
  const rows = await listFollowUps(db, actor, { view: 'open', now });
  const leadIds = [...new Set(rows.map((r) => r.leadId))];
  const programmeOf = new Map(
    leadIds.length
      ? (
          await db
            .select({ id: opsLeads.id, name: programmes.name })
            .from(opsLeads)
            .leftJoin(programmes, eq(programmes.id, opsLeads.programmeId))
            .where(inArray(opsLeads.id, leadIds as LeadId[]))
        ).map((p) => [p.id as string, p.name])
      : [],
  );
  return rows.map((r) => ({
    id: r.id as string,
    leadId: r.leadId as string,
    student: r.studentName,
    programme: programmeOf.get(r.leadId) ?? null,
    owner: r.ownerName,
    nextStep: r.title,
    due: r.dueDate as string,
  }));
}
