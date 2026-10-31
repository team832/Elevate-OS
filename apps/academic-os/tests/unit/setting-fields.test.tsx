/** The shared settings editor on every Academic setting: the form posts the stored value exactly. */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fromDraft, settingLine, settingShape, SettingFields, toDraft } from '@elevate/shared-ui';
import { SETTING_DEFINITIONS, SETTING_KEYS } from '../../src/domain/settings';

const STORED: [(typeof SETTING_KEYS)[number], unknown][] = [
  ...SETTING_KEYS.map((k) => [k, SETTING_DEFINITIONS[k].defaultValue] as [typeof k, unknown]),
  ['timetable.teacher_workload_cap', { maxMinutesPerDay: 300, maxMinutesPerWeek: null, enforcement: 'hard' }],
  ['progress.trend', { lastN: 5, minPoints: 3, flatThreshold: 1.5 }],
  ['reviews.cadence_days', { days: 30 }],
  ['timetable.substitute_authoriser', { role: 'director' }],
];
const shape = (k: (typeof SETTING_KEYS)[number], v: unknown) =>
  settingShape(SETTING_DEFINITIONS[k].schema, v);

describe('every Academic setting', () => {
  it.each(STORED)('%s %j: round trip identical, and the form holds it', (key, value) => {
    expect(SETTING_DEFINITIONS[key].schema.safeParse(value).success).toBe(true);
    const s = shape(key, value);
    expect(JSON.stringify(fromDraft(s, toDraft(s, value)))).toBe(JSON.stringify(value));
    const out = renderToStaticMarkup(<SettingFields name="value" shape={s} value={value} />);
    expect(/name="value" value="([^"]*)"/.exec(out)![1]!.replaceAll('&quot;', '"')).toBe(
      JSON.stringify(value),
    );
    expect(settingLine(s, value)).not.toMatch(/[{}]/);
  });

  it('nothing falls back to the text box; ranges and enums come from the schema', () => {
    expect(SETTING_KEYS.filter((k) => shape(k, SETTING_DEFINITIONS[k].defaultValue).kind === 'json')).toEqual([]);
    const s = shape('assessments.min_gap_days', SETTING_DEFINITIONS['assessments.min_gap_days'].defaultValue);
    expect(s).toMatchObject({
      kind: 'group',
      fields: [
        { key: 'minDays', kind: 'number', min: 0, max: 60 },
        { key: 'enforcement', kind: 'choice', options: [{ value: 'warning' }, { value: 'hard' }] },
      ],
    });
  });
});
