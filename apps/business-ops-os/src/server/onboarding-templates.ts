/**
 * Onboarding templates (owner brief §8): versioned per code; publishing retires the earlier
 * active version, and checklists already built keep the version they were copied from. Staff
 * joining / leaving checklist templates (F4-09) version the same way (retireForNextVersion).
 */
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { opsOnboardingTemplates, programmes, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { accessScope, type Actor } from './context';
import { fieldError, opsAudit } from './ops-common';
import type { TemplateInput } from './profile-schemas';

/** GET /onboarding-templates — every version, newest first per code (settings screens). */
export async function listTemplates(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:settings:read');
  return db
    .select()
    .from(opsOnboardingTemplates)
    .orderBy(asc(opsOnboardingTemplates.code), desc(opsOnboardingTemplates.version));
}

/** Lock the versions under `key`, retire the active one and return the next version number. */
export async function retireForNextVersion(
  tx: Database,
  table: PgTable & { version: PgColumn; status: PgColumn },
  key: SQL,
) {
  const old = await tx.select({ v: table.version }).from(table).where(key).for('update');
  await tx
    .update(table)
    .set({ status: 'retired' } as never)
    .where(and(key, eq(table.status, 'active')));
  return Math.max(0, ...old.map((t) => t.v as number)) + 1;
}

/**
 * POST /onboarding-templates — publish the next version of `code` (active; the earlier active
 * version is retired). Existing checklists keep the version they were built from.
 */
export async function publishTemplateVersion(
  db: Database,
  actor: Actor,
  input: TemplateInput,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:settings:manage');
  const known = await db
    .select({ code: programmes.code })
    .from(programmes)
    .where(inArray(programmes.code, input.programmeCodes));
  const unknown = input.programmeCodes.filter((c) => !known.some((k) => k.code === c));
  if (unknown.length)
    throw fieldError('programmeCodes', `Unknown programme: ${unknown.join(', ')}`);
  return withTransaction(db, async (tx) => {
    const version = await retireForNextVersion(
      tx,
      opsOnboardingTemplates,
      eq(opsOnboardingTemplates.code, input.code),
    );
    const [row] = await tx
      .insert(opsOnboardingTemplates)
      .values({
        ...input,
        classCategory: input.classCategory as never,
        version,
        status: 'active',
        createdBy: actor.id,
      })
      .returning();
    await opsAudit('onboarding_template')(
      tx,
      actor,
      row!.id,
      'onboarding.template_published',
      { after: { code: row!.code, version: row!.version, items: row!.items.map((i) => i.key) } },
      requestId,
    );
    return row!;
  });
}
