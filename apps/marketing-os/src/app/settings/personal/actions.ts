'use server';

import {
  CHECKLIST_MAX,
  FOCUS_MAX,
  preferencesBody,
  saveMyPreferences,
} from '../../../server/preferences';
import { go, run, str, strs } from '../../actions/common';

const BACK = 'settings/personal';

/** Rows `0…n-1` of a repeated field group; a row without its key field is left out. */
const rows = <T>(n: number, row: (i: number) => T | null) =>
  Array.from({ length: n }, (_, i) => row(i)).filter((r): r is T => r !== null);

export async function savePersonalSettingsAction(form: FormData): Promise<void> {
  const start = str(form, 'workStart');
  const end = str(form, 'workEnd');
  const reminder = str(form, 'reminder');
  const parsed = preferencesBody.safeParse({
    marketing: {
      dashboard: {
        period: str(form, 'period'),
        owner: str(form, 'owner') ?? null,
        campaign: str(form, 'campaign') ?? null,
        course: str(form, 'course') ?? null,
      },
      calendarView: str(form, 'calendarView'),
      workingHours: start || end ? { start, end, days: strs(form, 'days') } : null,
      focusBlocks: rows(FOCUS_MAX, (i) =>
        str(form, `focus${i}Start`) || str(form, `focus${i}End`)
          ? {
              day: str(form, `focus${i}Day`),
              start: str(form, `focus${i}Start`),
              end: str(form, `focus${i}End`),
              label: str(form, `focus${i}Label`) ?? '',
            }
          : null,
      ),
      checklist: rows(CHECKLIST_MAX, (i) => {
        const label = str(form, `item${i}`);
        return label ? { label, done: form.get(`item${i}Done`) === 'on' } : null;
      }),
      goals: (str(form, 'goals') ?? '')
        .split('\n')
        .map((g) => g.trim())
        .filter(Boolean),
    },
    notifications: {
      reminderIntervalHours: reminder ? Number(reminder) : null,
      popUps: form.get('popUps') === 'on',
    },
  });
  if (!parsed.success)
    go(BACK, {
      error: parsed.error.issues
        .map((i) => `${String(i.path.at(-1) ?? 'Settings')}: ${i.message}`)
        .join('; '),
    });
  const res = await run((db, user) => saveMyPreferences(db, user, parsed.data));
  if (!res.ok) go(BACK, { error: res.error });
  go(BACK, { notice: 'Personal settings saved.' });
}
