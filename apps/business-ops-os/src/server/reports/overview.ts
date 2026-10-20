/**
 * Read-only figures for the platform Workspace overview (apps/platform/src/server/overview-adapter.ts).
 * Aggregate counts, not the list services: those stop at 500–1000 rows, so a total
 * read from them becomes unknown as soon as the data grows. Each function checks
 * its permission and applies the same record scope as the matching Ops page.
 */
import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
} from 'drizzle-orm';
import {
  opsAdmissions,
  opsAttendanceSessions,
  opsLeads,
  opsShiftAssignments,
  programmes,
  type Database,
} from '@elevate/database';
import type { LeadId } from '@elevate/shared-types';
import { istToday, type AdmissionStatus } from '../../domain';
import { ownAdmissionFilter } from '../admissions';
import { accessScope, type Actor } from '../context';
import { listFollowUps } from '../follow-ups';
import { hrScope, hrScopeIds } from '../hr-scope';

/** Leads (not merged) with an admission case still open — any status except enrolled or lost. */
export async function countOpenLeads(db: Database, actor: Actor): Promise<number> {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const [row] = await db
    .select({ n: countDistinct(opsLeads.id) })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(
      and(
        isNull(opsLeads.mergedIntoLeadId),
        notInArray(opsAdmissions.status, ['enrolled', 'lost']),
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
 * Today's (IST) attendance in the caller's HR scope. `null` when the scope holds no
 * staff record. `recordedToday` says whether ANY session exists today, so the
 * overview can tell "nobody recorded attendance" (unknown) from "none of yours came in".
 */
export async function staffPresentToday(db: Database, actor: Actor, now = new Date()) {
  const ids = hrScopeIds(await hrScope(db, actor, 'ops:attendance:read'));
  if (ids?.length === 0) return null;
  const today = istToday(now);
  const s = opsAttendanceSessions;
  const a = opsShiftAssignments;
  const live = and(eq(s.workDate, today), ne(s.status, 'superseded'));
  const [[present], anySession, [shifts]] = await Promise.all([
    db
      .select({ n: countDistinct(s.staffId) })
      .from(s)
      .where(and(live, ids ? inArray(s.staffId, ids) : undefined)),
    db.select({ id: s.id }).from(s).where(live).limit(1),
    db
      .select({ n: countDistinct(a.staffId) })
      .from(a)
      .where(
        and(
          eq(a.status, 'active'),
          lte(a.fromDate, today),
          or(isNull(a.toDate), gte(a.toDate, today)),
          ids ? inArray(a.staffId, ids) : undefined,
        ),
      ),
  ]);
  return {
    present: present?.n ?? 0,
    recordedToday: anySession.length > 0,
    withShift: shifts?.n ?? 0,
  };
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
            .select({ id: opsLeads.id, code: programmes.code })
            .from(opsLeads)
            .leftJoin(programmes, eq(programmes.id, opsLeads.programmeId))
            .where(inArray(opsLeads.id, leadIds as LeadId[]))
        ).map((p) => [p.id as string, p.code])
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
