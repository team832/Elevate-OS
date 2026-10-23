/**
 * HR Settings (brief 23 Oct 2026 §6): the HR, work-report and student-feedback policies, changed
 * with ops:hr_settings:manage. A change stays Proposed until the owner approves it. Other keys
 * are "not found" here; they belong to the main Settings page — including `hr.staff_scope_departments`
 * (who HR covers), which only ops:settings:manage changes, so HR cannot widen its own scope.
 */
import type { Database } from '@elevate/database';
import { NotFoundError } from '@elevate/shared-contracts';
import type { SettingKey } from '../domain';
import { accessScope, type Actor } from './context';
import { loadSettings, updateSetting } from './settings';

const HR_KEY =
  /^(hr\.(?!staff_scope_departments$)|feedback\.|reports\.(week_start|weekly_deadline|monthly_deadline|timezone)$|tasks\.reopen_roles$)/;
export const isHrSettingKey = (key: string): key is SettingKey => HR_KEY.test(key);

export async function listHrSettings(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:hr_settings:manage');
  return Object.values(await loadSettings(db)).filter((s) => isHrSettingKey(s.key));
}

export async function updateHrSetting(
  db: Database,
  actor: Actor,
  input: { key: string; value: unknown; note?: string | null },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:hr_settings:manage');
  if (!isHrSettingKey(input.key)) throw new NotFoundError('HR setting not found.');
  return updateSetting(db, actor, input, requestId, 'ops:hr_settings:manage');
}
