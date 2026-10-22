/**
 * Configurable academic rules (academic.settings). Defaults are `proposed`. Approving a value
 * needs the owner's decision reference (D-0xx / OD-0xx), kept in the audit row; changing a value
 * without a new reference makes it `proposed` again.
 */
import { eq } from 'drizzle-orm';
import { academicSettings, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { NotFoundError, ValidationError } from '@elevate/shared-contracts';
import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  isSettingKey,
  readSetting,
  type SettingKey,
  type SettingValue,
} from '../../domain';
import { audit, type Actor } from '../context';

export async function getSetting<K extends SettingKey>(
  db: Database,
  key: K,
): Promise<{ value: SettingValue<K>; status: 'proposed' | 'approved'; stored: boolean }> {
  const [row] = await db.select().from(academicSettings).where(eq(academicSettings.key, key));
  return { value: readSetting(key, row?.value), status: row?.status ?? 'proposed', stored: Boolean(row) };
}

export async function listSettings(db: Database) {
  const rows = await db.select().from(academicSettings);
  return SETTING_KEYS.map((key) => {
    const row = rows.find((r) => r.key === key);
    return {
      key,
      description: SETTING_DEFINITIONS[key].description,
      value: readSetting(key, row?.value),
      status: row?.status ?? 'proposed',
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function updateSetting(
  db: Database,
  actor: Actor,
  key: string,
  input: { value: unknown; status: 'proposed' | 'approved'; decisionRef?: string },
) {
  if (!isSettingKey(key)) throw new NotFoundError(`Unknown setting "${key}".`);
  const parsed = SETTING_DEFINITIONS[key].schema.safeParse(input.value);
  if (!parsed.success) {
    throw new ValidationError(`Invalid value for ${key}.`, {
      details: parsed.error.issues.map((i) => ({ location: 'body', path: ['value', ...i.path], message: i.message })),
    });
  }
  return withTransaction(db, async (tx) => {
    const [before] = await tx.select().from(academicSettings).where(eq(academicSettings.key, key));
    const unchanged = before?.status === 'approved' && JSON.stringify(before.value) === JSON.stringify(parsed.data);
    if (input.status === 'approved' && !input.decisionRef && !unchanged) {
      throw new ValidationError('Approving needs the owner’s decision reference (e.g. D-061); without one the value stays proposed.', {
        details: [{ location: 'body', path: ['decisionRef'], message: 'Required to approve' }],
      });
    }
    const [row] = await tx
      .insert(academicSettings)
      .values({
        key,
        value: parsed.data as object,
        status: input.status,
        description: SETTING_DEFINITIONS[key].description,
        updatedByUserId: actor.user.id,
      })
      .onConflictDoUpdate({
        target: academicSettings.key,
        set: { value: parsed.data as object, status: input.status, updatedByUserId: actor.user.id },
      })
      .returning();
    await audit(tx, actor, { action: 'setting.updated', entityType: 'setting', entityId: key, before: before ?? null, after: row, metadata: { decisionRef: input.decisionRef ?? null } });
    return row!;
  });
}
