/**
 * Lead funnel (owner brief 23 Oct 2026 §10–11): counts by lead stage for a period, and the rows
 * behind each count. Both come from leadFunnelRows, so a drill-down always equals its figure.
 */
import { and, desc, eq, gte, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import {
  opsEnquiries,
  opsLeads,
  opsLeadStages,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, istInstant, type IsoDate } from '../domain';
import { accessScope, type Actor } from './context';
import { leadScope } from './leads-read';

export const LEAD_FUNNEL_DEFINITION =
  'Leads first received between these dates (India time), counted by the stage they are in today. Merged duplicates are left out. "Not staged" means nobody has given the lead a stage yet. Marketing employees count only their own leads.';

/** `NOT_STAGED` drills into leads without a stage. */
export const NOT_STAGED = 'none';

export interface LeadFunnelFilters {
  from: IsoDate;
  to: IsoDate;
  ownerStaffId?: string;
  programmeCode?: string;
  /** Any enquiry of the lead came from this source. */
  sourceCode?: string;
  /** A stage key, or NOT_STAGED. Omitted = every stage. */
  stageKey?: string;
}

/** The leads behind the funnel (max 2,000 rows; the count says when that cap is hit). */
export async function leadFunnelRows(db: Database, actor: Actor, f: LeadFunnelFilters) {
  const scope = leadScope(db, await accessScope(db, actor, 'ops:leads:read'));
  if (!scope) return [];
  const where: SQL[] = [
    scope,
    isNull(opsLeads.mergedIntoLeadId),
    gte(opsLeads.firstReceivedAt, istInstant(f.from)),
    lt(opsLeads.firstReceivedAt, istInstant(addDays(f.to, 1))),
  ];
  if (f.ownerStaffId) where.push(eq(opsLeads.ownerStaffId, f.ownerStaffId as StaffMemberId));
  if (f.programmeCode) where.push(eq(programmes.code, f.programmeCode));
  if (f.sourceCode)
    where.push(
      inArray(
        opsLeads.id,
        db
          .select({ id: opsEnquiries.leadId })
          .from(opsEnquiries)
          .where(eq(opsEnquiries.sourceCode, f.sourceCode)),
      ),
    );
  if (f.stageKey)
    where.push(
      f.stageKey === NOT_STAGED ? isNull(opsLeads.stageKey) : eq(opsLeads.stageKey, f.stageKey),
    );
  return db
    .select({
      id: opsLeads.id,
      code: opsLeads.code,
      studentName: opsLeads.studentName,
      isSample: opsLeads.isSample,
      stageKey: opsLeads.stageKey,
      doNotContact: opsLeads.doNotContact,
      receivedAt: opsLeads.firstReceivedAt,
      ownerName: staffMembers.fullName,
      programmeName: programmes.name,
    })
    .from(opsLeads)
    .leftJoin(staffMembers, eq(staffMembers.id, opsLeads.ownerStaffId))
    .leftJoin(programmes, eq(programmes.id, opsLeads.programmeId))
    .where(and(...where))
    .orderBy(desc(opsLeads.firstReceivedAt))
    .limit(2000);
}

/** Counts by stage in stage order (inactive stages too, so history still adds up). */
export async function leadFunnel(db: Database, actor: Actor, f: LeadFunnelFilters) {
  const rows = await leadFunnelRows(db, actor, { ...f, stageKey: undefined });
  const stages = await db.select().from(opsLeadStages).orderBy(opsLeadStages.sortOrder);
  const count = (key: string | null) => rows.filter((r) => r.stageKey === key).length;
  return {
    definition: LEAD_FUNNEL_DEFINITION,
    total: rows.length,
    capped: rows.length >= 2000,
    stagesConfigured: stages.length > 0,
    stages: stages
      .map((s) => ({
        key: s.key,
        label: s.label,
        kind: s.kind,
        active: s.active,
        count: count(s.key),
      }))
      .filter((s) => s.active || s.count > 0),
    notStaged: count(null),
  };
}
