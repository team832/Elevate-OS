/**
 * Social account registry (MKT-001, MKT-002, PLT-017). Handles are never invented: a handle
 * is stored only when a person confirms it. Integration status changes only through an
 * adapter verification call; `connected` cannot be set by hand (D-014).
 */
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  marketingLegacyConflicts,
  marketingSocialAccounts,
  staffMembers,
  type Database,
} from '@elevate/database';
import { NotFoundError, withTransaction } from '@elevate/server-kit';
import type { StaffMemberId } from '@elevate/shared-types';
import { CADENCE_ENFORCEMENT, ACCOUNT_STATUSES, type AccountCadence } from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing, rowById } from './common';
import { getPublishingAdapter } from './adapters/publishing';

export type SocialAccountRow = typeof marketingSocialAccounts.$inferSelect;

export async function listAccounts(db: Database) {
  const rows = await db
    .select({ account: marketingSocialAccounts, ownerName: staffMembers.fullName })
    .from(marketingSocialAccounts)
    .leftJoin(staffMembers, eq(staffMembers.id, marketingSocialAccounts.ownerStaffId))
    .orderBy(asc(marketingSocialAccounts.platform), asc(marketingSocialAccounts.code));
  return rows.map((r) => ({ ...r.account, ownerName: r.ownerName }));
}

export async function listLegacyConflicts(db: Database) {
  return db.select().from(marketingLegacyConflicts).orderBy(asc(marketingLegacyConflicts.code));
}

export const getAccountById = (db: Database, id: string): Promise<SocialAccountRow> =>
  rowById(db, marketingSocialAccounts, id, 'Social account not found.');

export async function getAccountByCode(db: Database, code: string): Promise<SocialAccountRow> {
  const [row] = await db
    .select()
    .from(marketingSocialAccounts)
    .where(eq(marketingSocialAccounts.code, code.toUpperCase()));
  if (!row) throw new NotFoundError(`No social account with code ${code}.`);
  return row;
}

export function cadenceOf(account: SocialAccountRow): AccountCadence {
  return {
    accountCode: account.code,
    maxPerDay: account.cadenceMaxPerDay,
    maxPerWeek: account.cadenceMaxPerWeek,
    enforcement: account.cadenceEnforcement,
    status: account.cadenceStatus,
  };
}

export const updateAccountBody = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullable(),
    /** Only a handle a person has confirmed live; never a guess. */
    handle: z
      .string()
      .trim()
      .regex(/^@?[A-Za-z0-9._-]{2,60}$/, 'Handles look like @name')
      .nullable(),
    ownerStaffId: z.uuid().nullable(),
    status: z.enum(ACCOUNT_STATUSES),
    cadenceMaxPerDay: z.int().min(1).max(50).nullable(),
    cadenceMaxPerWeek: z.int().min(1).max(200).nullable(),
    cadenceEnforcement: z.enum(CADENCE_ENFORCEMENT),
    contentRules: z.array(z.string().trim().min(1).max(300)).max(30),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Send at least one field to change.' });

export async function updateAccount(
  db: Database,
  actor: Actor,
  id: string,
  patch: z.output<typeof updateAccountBody>,
  requestId?: string,
): Promise<SocialAccountRow> {
  assertCan(actor, 'marketing:accounts:manage');
  return withTransaction(db, async (tx) => {
    const before = await getAccountById(tx, id);
    const { ownerStaffId, ...rest } = patch;
    const set: Partial<typeof marketingSocialAccounts.$inferInsert> = { ...rest };
    if (ownerStaffId !== undefined) set.ownerStaffId = ownerStaffId as StaffMemberId | null;
    if (patch.handle !== undefined) {
      set.handle =
        patch.handle === null
          ? null
          : patch.handle.startsWith('@')
            ? patch.handle
            : `@${patch.handle}`;
      set.handleStatus = patch.handle === null ? 'tbd' : 'confirmed_by_user';
    }
    if (patch.cadenceMaxPerDay !== undefined || patch.cadenceMaxPerWeek !== undefined) {
      // A person changed the target; it is still a proposal until the owner approves (OD-007).
      set.cadenceStatus = 'proposed';
    }
    const [after] = await tx
      .update(marketingSocialAccounts)
      .set(set)
      .where(eq(marketingSocialAccounts.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action: 'social_account.updated',
      entityType: 'social_account',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after!;
  });
}

/** Run the adapter's verification and store the honest result (mock → `sandbox`). */
export async function verifyAccountConnection(
  db: Database,
  actor: Actor,
  id: string,
  requestId?: string,
): Promise<SocialAccountRow> {
  assertCan(actor, 'marketing:accounts:manage');
  const adapter = getPublishingAdapter();
  return withTransaction(db, async (tx) => {
    const before = await getAccountById(tx, id);
    const check = await adapter.verifyConnection({ code: before.code, platform: before.platform });
    const [after] = await tx
      .update(marketingSocialAccounts)
      .set({
        integrationStatus: check.status,
        integrationCheckedAt: new Date(),
        integrationNote: check.note,
      })
      .where(eq(marketingSocialAccounts.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action: 'social_account.connection_verified',
      entityType: 'social_account',
      entityId: before.id,
      before: { integrationStatus: before.integrationStatus },
      after: { integrationStatus: check.status, adapter: adapter.name },
      requestId,
    });
    return after!;
  });
}

/** Counts per integration status — every status listed, zero only when truly none. */
export function countByIntegrationStatus(accounts: readonly SocialAccountRow[]) {
  const out = { not_configured: 0, sandbox: 0, connected: 0, error: 0 };
  for (const a of accounts) out[a.integrationStatus] += 1;
  return out;
}
