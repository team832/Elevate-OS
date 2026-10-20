/**
 * Ops configuration (OPS-022): stored overrides merged over the code defaults
 * from domain/policies.ts. Changing a value never approves it.
 */
import { eq } from 'drizzle-orm';
import { opsSettings, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import {
  resolveSettings,
  SETTING_DEFINITIONS,
  validateSettingChange,
  type ResolvedSettings,
} from '../domain';
import { accessScope, type Actor } from './context';
import { opsAudit } from './ops-common';

const audit = opsAudit('setting');

/** All settings (no permission check: internal use by other services). */
export async function loadSettings(db: Database): Promise<ResolvedSettings> {
  const rows = await db.select().from(opsSettings);
  return resolveSettings(rows);
}

export async function listSettings(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:settings:read');
  return Object.values(await loadSettings(db));
}

export async function updateSetting(
  db: Database,
  actor: Actor,
  input: { key: string; value: unknown; note?: string | null },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:settings:manage');
  const check = validateSettingChange(input.key, input.value);
  if (!check.ok)
    throw new ValidationError(check.message, {
      details: [{ location: 'body', path: ['value'], message: check.message }],
    });
  const def = SETTING_DEFINITIONS[check.key];
  return withTransaction(db, async (tx) => {
    const [before] = await tx.select().from(opsSettings).where(eq(opsSettings.key, check.key));
    const values = {
      key: check.key,
      value: check.value as object,
      decisionState: check.decisionState,
      source: `Changed in Elevate OS (proposed). Original source: ${def.source}`,
      ownerDecision: def.ownerDecision,
      note: input.note ?? null,
      updatedBy: actor.id,
    };
    const [after] = before
      ? await tx.update(opsSettings).set(values).where(eq(opsSettings.id, before.id)).returning()
      : await tx.insert(opsSettings).values(values).returning();
    await audit(tx, actor, check.key, 'setting.changed', { before, after }, requestId);
    return resolveSettings(after ? [after] : [])[check.key];
  });
}
