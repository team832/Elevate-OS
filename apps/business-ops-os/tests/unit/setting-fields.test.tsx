/**
 * The settings editor: every setting's stored value becomes real fields and comes back identical
 * (the form posts exactly what a JSON box would), its enums and ranges come from its schema, and an
 * edited form produces what the server accepts.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  blankDraft,
  fromDraft,
  SettingControl,
  SettingFields,
  toDraft,
  type Draft,
  type FieldShape,
  type GroupDraft,
} from '@elevate/shared-ui';
import { SAMPLE_SETTINGS } from '../../seed/sample-placeholders';
import { shapeOf, valueLine } from '../../src/app/settings/_components/setting-value';
import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  settingSchemas,
  validateSettingChange,
  type SettingKey,
} from '../../src/domain';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const shape = (key: SettingKey, value: unknown = SETTING_DEFINITIONS[key].defaultValue) =>
  shapeOf({ key, value });
const posted = (html: string) =>
  /<input type="hidden" name="value" value="([^"]*)"/
    .exec(html)![1]!
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

const STORED: [SettingKey, unknown][] = [
  ['reports.weekly_deadline', { deadline: { day: 'friday', time: '17:00' } }],
  ['reports.monthly_deadline', { deadline: { dayOfNextMonth: 5, time: '09:30' } }],
  ['eod.submission_deadline', { time: '18:30' }],
  ['fees.registration', { amountPaise: 150050 }],
  ['fees.registration', { amountPaise: null }],
  ['admissions.declarations', { text: null, version: null }],
  ['demo.limits', { maxConsecutiveDays: 2, subjectCap: 3, missedDayRule: 'Sample rule' }],
  [
    'followups.due_rules',
    {
      firstContactDays: 1,
      afterCounsellingDays: 2,
      afterDemoDays: 3,
      upcomingWindowDays: 4,
      closedWeekdays: [6, 0],
    },
  ],
  ['kpi.conversion', { windowDays: 7 }],
  ['hr.request_recipients', { schar: '11111111-1111-4111-8111-111111111111' }],
  ['tasks.reopen_roles', { who: ['line_manager', 'reviewer'] }],
  ['fees.schedule', { scheduleReference: 'Sample — replace: "quoted", \\ and\nnewline' }],
  ['hr.staff_scope_departments', { departmentCodes: [] }],
  ['hr.attendance.half_day_hours', { hours: 4.5 }],
  [
    'ai.features',
    {
      feedbackSummary: false,
      reportDraft: true,
      taskBrief: false,
      csvMapping: true,
      scoreSheet: false,
      studentSummary: true,
    },
  ],
];

describe('the round trip is identical', () => {
  const every = [
    ...SETTING_KEYS.map((k) => [k, SETTING_DEFINITIONS[k].defaultValue] as [SettingKey, unknown]),
    ...SAMPLE_SETTINGS.map((s) => [s.key, s.value] as [SettingKey, unknown]),
    ...STORED,
  ];

  it.each(every)('%s: stored value, draft, posted value', (key, value) => {
    expect(settingSchemas[key].safeParse(value).success).toBe(true);
    const s = shape(key, value);
    expect(JSON.stringify(fromDraft(s, toDraft(s, value)))).toBe(JSON.stringify(value));
  });

  it.each(every)('%s: the rendered form holds the stored value', (key, value) => {
    const out = renderToStaticMarkup(
      <SettingFields name="value" shape={shape(key, value)} value={value} />,
    );
    expect(posted(out)).toBe(JSON.stringify(value));
  });
});

const fieldsOf = (s: FieldShape) => (s.kind === 'group' ? s.fields : []);
const field = (key: SettingKey, name: string) => fieldsOf(shape(key)).find((f) => f.key === name)!;

describe('fields come from the value and its schema', () => {
  it('only a setting whose shape cannot be mapped keeps the text box, with its reason', () => {
    const boxes = SETTING_KEYS.filter((k) => shape(k).kind === 'json');
    expect(boxes).toEqual(['hr.request_recipients']);
    expect(shape('hr.request_recipients').hint).toContain('keep the quotes');
  });

  it.each([
    [
      'tasks.reminders',
      'dueSoonHours',
      { kind: 'number', min: 1, max: 168, whole: true, nullable: false },
    ],
    ['hr.attendance.half_day_hours', 'hours', { kind: 'number', min: 0.5, max: 16, whole: false }],
    [
      'fees.registration',
      'amountPaise',
      { kind: 'number', paise: true, nullable: true, label: 'Amount (₹)', max: 1_000_000 },
    ],
    ['demo.fee', 'amountInr', { kind: 'number', paise: false, label: 'Amount (₹)' }],
    ['eod.submission_deadline', 'time', { kind: 'text', time: true, nullable: true }],
    ['admissions.declarations', 'text', { kind: 'text', long: true, nullable: true }],
    ['pipeline.demo_skip', 'allowed', { kind: 'boolean', label: 'Allowed' }],
    ['feedback.rating_scale', 'min', { kind: 'fixed', value: 1 }],
    ['fees.allocation', 'rule', { kind: 'fixed', text: 'Oldest due first' }],
    [
      'hr.staff_scope_departments',
      'departmentCodes',
      { kind: 'list', label: 'Departments', max: 40 },
    ],
    ['fees.tuition_split', 'sharesPercent', { kind: 'list', min: 1, max: 12 }],
  ] as const)('%s %s', (key, name, expected) => {
    expect(field(key, name)).toMatchObject(expected);
  });

  it('an enum is a list of its options, in plain words, with the real values', () => {
    const f = field('admissions.signatures.required_signers', 'guardian');
    expect(f).toMatchObject({
      kind: 'choice',
      options: [
        { value: 'always', label: 'Always' },
        { value: 'if_under_18', label: 'If under 18' },
        { value: 'never', label: 'Never' },
      ],
    });
  });

  it('a union of numbers keeps numbers', () => {
    const f = field('kpi.conversion', 'windowDays');
    expect(f).toMatchObject({
      kind: 'choice',
      options: [{ value: 7, label: '7 days' }, { value: 14 }, { value: 30 }],
    });
    const d = toDraft(shape('kpi.conversion'), { windowDays: 14 }) as GroupDraft;
    expect(fromDraft(shape('kpi.conversion'), d)).toEqual({ windowDays: 14 });
  });

  it('a list of an enum is a set of ticks; closed weekdays go by day name', () => {
    expect(field('tasks.reopen_roles', 'who')).toMatchObject({
      kind: 'choices',
      options: [
        { value: 'reviewer', label: 'Reviewer' },
        { value: 'hr_manager', label: 'Hr manager' },
        { value: 'operations_manager' },
        { value: 'line_manager' },
      ],
    });
    expect(field('followups.due_rules', 'closedWeekdays')).toMatchObject({
      kind: 'choices',
      options: expect.arrayContaining([
        { value: 0, label: 'Sunday' },
        { value: 6, label: 'Saturday' },
      ]),
    });
  });

  it('a list of codes is rows of labelled fields', () => {
    const f = field('feedback.categories', 'categories');
    expect(f).toMatchObject({ kind: 'list', min: 1, max: 40, of: { kind: 'group' } });
    expect(f.kind === 'list' && fieldsOf(f.of).map((x) => x.label)).toEqual(['Code', 'Label']);
  });

  it('every label is plain words: no camel case, no raw code', () => {
    const labels = (s: FieldShape): string[] => [
      s.label,
      ...(s.kind === 'group' ? s.fields.flatMap(labels) : s.kind === 'list' ? labels(s.of) : []),
      ...(s.kind === 'choice' || s.kind === 'choices' ? s.options.map((o) => o.label) : []),
    ];
    for (const k of SETTING_KEYS)
      for (const l of labels(shape(k))) expect(l, `${k}: ${l}`).not.toMatch(/[a-z][A-Z]|_/);
  });
});

describe('an edited form', () => {
  const edit = (key: SettingKey, change: (d: GroupDraft) => void) => {
    const s = shape(key);
    const d = structuredClone(toDraft(s, SETTING_DEFINITIONS[key].defaultValue)) as GroupDraft;
    change(d);
    return validateSettingChange(key, fromDraft(s, d));
  };

  it('a number and a null text: the server accepts them, as numbers and null', () => {
    expect(edit('tasks.reminders', (d) => void (d.fields.dueSoonHours = '12'))).toMatchObject({
      ok: true,
      value: { dueSoonHours: 12, overdueRepeatHours: 24, unacknowledgedHours: 4 },
    });
    expect(edit('fees.registration', (d) => void (d.fields.amountPaise = '19.99'))).toMatchObject({
      ok: true,
      value: { amountPaise: 1999 },
    });
    expect(edit('fees.registration', (d) => void (d.fields.amountPaise = ''))).toMatchObject({
      ok: true,
      value: { amountPaise: null },
    });
  });

  it('a deadline is switched on and filled, and off again', () => {
    const on = (d: GroupDraft) => {
      const g = d.fields.deadline as GroupDraft;
      g.on = true;
      g.fields.time = '17:00';
    };
    expect(edit('reports.weekly_deadline', on)).toMatchObject({
      ok: true,
      value: { deadline: { day: 'monday', time: '17:00' } },
    });
    expect(edit('reports.weekly_deadline', () => {})).toMatchObject({
      ok: true,
      value: { deadline: null },
    });
  });

  it.each<[SettingKey, (d: GroupDraft) => void, RegExp]>([
    ['tasks.reminders', (d) => void (d.fields.dueSoonHours = '200'), /Due soon hours.*at most 168/],
    ['tasks.reminders', (d) => void (d.fields.dueSoonHours = ''), /Due soon hours needs a value/],
    [
      'fees.registration',
      (d) => void (d.fields.amountPaise = '2000000'),
      /Amount.*at most ₹10,00,000/,
    ],
    [
      'feedback.categories',
      (d) => void (((d.fields.categories as Draft[])[1] as GroupDraft).fields.code = 'Bad Code'),
      /Code in row 2/,
    ],
    [
      'feedback.categories',
      (d) => void (d.fields.categories = []),
      /Categories needs at least 1 entry/,
    ],
    [
      'admissions.kyc.id_document_types',
      (d) => void (d.fields.mandatory = ['nope']),
      /A mandatory type must be in the list/,
    ],
  ])('%s: a refusal says which field, in words', (key, change, message) => {
    const r = edit(key, change);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(message);
    expect(!r.ok && r.message).not.toMatch(/expected|Invalid input|=/);
  });
});

describe('rows, through the real blank draft', () => {
  const LISTS = SETTING_KEYS.flatMap((key) =>
    fieldsOf(shape(key))
      .filter((f) => f.kind === 'list')
      .map((f) => [key, f.key] as [SettingKey, string]),
  );
  const listOf = (key: SettingKey, name: string) => {
    const f = field(key, name);
    if (f.kind !== 'list') throw new Error('expected a list');
    return f;
  };
  /** What a person types into an empty row, as the inputs hold it. */
  const TYPED: Record<string, string> = {
    code: 'sample_new',
    label: 'Sample new',
    departmentCodes: 'SAMPLE_NEW',
    mandatory: 'aadhaar',
    sharesPercent: '10',
    types: 'Sample leave',
  };
  const typeInto = (s: FieldShape, d: Draft, name: string): Draft =>
    s.kind === 'group'
      ? {
          ...(d as GroupDraft),
          fields: Object.fromEntries(
            s.fields.map((f) => [f.key, typeInto(f, (d as GroupDraft).fields[f.key]!, f.key)]),
          ),
        }
      : TYPED[name]!;
  const render = (s: FieldShape, d: Draft) =>
    renderToStaticMarkup(<SettingControl s={s} d={d} set={() => {}} id="t" />);
  /** The setting's stored value with one list changed, as the form would post it. */
  const post = (key: SettingKey, name: string, change: (rows: Draft[]) => Draft[]) => {
    const s = shape(key);
    const d = toDraft(s, SETTING_DEFINITIONS[key].defaultValue) as GroupDraft;
    return fromDraft(s, {
      ...d,
      fields: { ...d.fields, [name]: change(d.fields[name] as Draft[]) },
    }) as Record<string, unknown[]>;
  };

  it('there are lists to test', () => {
    expect(LISTS.length).toBeGreaterThanOrEqual(5);
  });

  it.each(LISTS)('%s %s: a new row has something to type in', (key, name) => {
    const { of } = listOf(key, name);
    const out = render({ ...of, label: 'Sample row' }, blankDraft(of));
    const leaves = of.kind === 'group' ? of.fields.length : 1;
    expect(out.match(/<(input|select|textarea)\b/g)?.length).toBe(leaves);
  });

  it.each(LISTS)('%s %s: typed into and saved, it arrives at the end of the list', (key, name) => {
    const { of } = listOf(key, name);
    const stored = (SETTING_DEFINITIONS[key].defaultValue as Record<string, unknown[]>)[name]!;
    const typed = post(key, name, (rows) => [...rows, typeInto(of, blankDraft(of), name)]);
    const row = fromDraft(of, typeInto(of, blankDraft(of), name));
    expect(typed[name]).toEqual([...stored, row]);
    if (SETTING_DEFINITIONS[key].editable)
      expect(validateSettingChange(key, typed)).toMatchObject({ ok: true, value: typed });
  });

  it.each(LISTS.filter(([k]) => SETTING_DEFINITIONS[k].editable))(
    '%s %s: an empty new row is refused in words, not dropped',
    (key, name) => {
      const { of } = listOf(key, name);
      const stored = (SETTING_DEFINITIONS[key].defaultValue as Record<string, unknown[]>)[name]!;
      const value = post(key, name, (rows) => [...rows, blankDraft(of)]);
      expect(value[name]).toHaveLength(stored.length + 1);
      const r = validateSettingChange(key, value);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toMatch(/row \d+|must be in the list/);
    },
  );

  it('a half-filled new row says which field and which row', () => {
    const { of } = listOf('feedback.categories', 'categories');
    const half = blankDraft(of) as GroupDraft;
    half.fields.code = 'sample_new';
    const r = validateSettingChange(
      'feedback.categories',
      post('feedback.categories', 'categories', (rows) => [...rows, half]),
    );
    expect(!r.ok && r.message).toBe('Label in row 7 needs at least 1 character.');
  });

  it('Remove: a row goes, and a list that may be empty can reach empty', () => {
    const removed = post('feedback.categories', 'categories', (rows) => rows.slice(1));
    expect(removed.categories).toHaveLength(5);
    expect(validateSettingChange('feedback.categories', removed).ok).toBe(true);
    const none = post('hr.staff_scope_departments', 'departmentCodes', () => []);
    expect(none).toEqual({ departmentCodes: [] });
    expect(validateSettingChange('hr.staff_scope_departments', none).ok).toBe(true);
  });

  it('an empty list offers only Add; the last required row cannot be removed; a full list cannot grow', () => {
    const empty = render(listOf('hr.staff_scope_departments', 'departmentCodes'), []);
    expect(empty).toContain('Add a row');
    expect(empty).not.toContain('Remove');
    expect(empty).not.toContain('<input');
    const required = listOf('feedback.categories', 'categories');
    const one = [blankDraft(required.of)];
    expect(render(required, one)).not.toContain('Remove');
    expect(render(required, [...one, ...one])).toContain('Remove');
    const full = Array.from({ length: 40 }, () => blankDraft(required.of));
    expect(render(required, full)).toMatch(/<button[^>]*disabled=""[^>]*>Add a row/);
  });
});

describe('the value as one plain line', () => {
  it.each<[SettingKey, unknown, string]>([
    ['hr.attendance.late_grace_minutes', undefined, '10 minutes'],
    ['hr.attendance.half_day_hours', undefined, '4 hours'],
    ['reports.week_start', undefined, 'Monday'],
    ['fees.registration', undefined, '₹5,000'],
    ['demo.fee', undefined, '₹1,000'],
    ['reports.weekly_deadline', undefined, 'Not set'],
    [
      'reports.weekly_deadline',
      { deadline: { day: 'friday', time: '17:00' } },
      'Day: Friday · Time: 17:00',
    ],
    [
      'tasks.reminders',
      undefined,
      'Due soon hours: 24 hours · Overdue repeat hours: 24 hours · Unacknowledged hours: 4 hours',
    ],
    ['pipeline.demo_skip', undefined, 'Allowed: Yes'],
    ['hr.staff_scope_departments', undefined, 'Academics, Marketing growth'],
    ['fees.tuition_split', undefined, '50 %, 25 %, 25 %'],
    [
      'followups.due_rules',
      {
        firstContactDays: 1,
        afterCounsellingDays: 1,
        afterDemoDays: 1,
        upcomingWindowDays: 1,
        closedWeekdays: [],
      },
      'First contact days: 1 day · After counselling days: 1 day · After demo days: 1 day · Upcoming window days: 1 day · Closed weekdays: None',
    ],
    [
      'feedback.categories',
      undefined,
      'Explanation clarity, Pace, Doubt resolution, Preparedness, Classroom engagement, Helpfulness of materials',
    ],
    ['hr.request_recipients', undefined, 'Schar: Not set'],
    ['hr.request_recipients', { schar: '11111111-1111-4111-8111-111111111111' }, 'Schar: Set'],
    ['feedback.rating_scale', undefined, 'Min: 1 · Max: 5'],
    [
      'admissions.closure_reasons',
      undefined,
      'Codes: Not interested, Chose another institute, Fees / affordability, Timing or schedule does not suit, Location or mode does not suit, Could not be reached and 5 more · Require code: No',
    ],
  ])('%s %j', (key, value, line) => {
    expect(valueLine({ key, value: value ?? SETTING_DEFINITIONS[key].defaultValue })).toBe(line);
  });

  it('every setting: one line, no braces, nothing long', () => {
    for (const k of SETTING_KEYS) {
      const line = valueLine({ key: k, value: SETTING_DEFINITIONS[k].defaultValue });
      expect(line, k).not.toMatch(/[{}\n]/);
      expect(line.length, k).toBeLessThan(320);
    }
  });
});
