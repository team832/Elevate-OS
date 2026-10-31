/**
 * A setting's value as form fields, for the one shared editor (SettingFields). The validation
 * schema gives the shape, enums and ranges; the stored value gives the key order. `toDraft` is what
 * the inputs hold and `fromDraft` what gets posted, so an untouched form posts the stored value
 * exactly. No zod import: this file also reaches the browser, and only reads a schema's `def`.
 */
import { settingFieldName } from '@elevate/shared-types';

export type PlainValue = string | number | boolean;
export interface ShapeOption {
  value: PlainValue;
  label: string;
}
export type FieldShape = { label: string; hint?: string } & (
  | {
      kind: 'number';
      min?: number;
      max?: number;
      whole: boolean;
      nullable: boolean;
      paise: boolean;
      unit?: string;
    }
  | { kind: 'text'; nullable: boolean; long: boolean; time: boolean; maxLength?: number }
  | { kind: 'boolean' }
  | { kind: 'choice'; options: ShapeOption[]; nullable: boolean }
  | { kind: 'choices'; options: ShapeOption[] }
  | { kind: 'list'; of: FieldShape; min: number; max?: number }
  | { kind: 'group'; fields: (FieldShape & { key: string })[]; nullable: boolean }
  | { kind: 'fixed'; text: string; value: PlainValue }
  | { kind: 'json'; line: string }
);

export type GroupDraft = { on: boolean; fields: Record<string, Draft> };
export type Draft = string | boolean | PlainValue[] | Draft[] | GroupDraft;

interface Def {
  type: string;
  shape?: Record<string, unknown>;
  element?: unknown;
  innerType?: unknown;
  values?: PlainValue[];
  options?: unknown[];
  entries?: Record<string, PlainValue>;
  checks?: {
    _zod: { def: { check: string; minimum?: number; maximum?: number; pattern?: RegExp } };
  }[];
}
const defOf = (schema: unknown) => (schema as { _zod: { def: Def } })._zod.def;
const checkOf = (d: Def, check: string) =>
  d.checks?.map((c) => c._zod.def).find((c) => c.check === check);

/** The closed list of values a schema allows, or null when it is not one. */
function literals(schema: unknown): PlainValue[] | null {
  const d = defOf(schema);
  if (d.type === 'enum') return Object.values(d.entries!);
  if (d.type === 'literal') return d.values!;
  if (d.type !== 'union') return null;
  const all = d.options!.map(literals);
  return all.every(Boolean) ? (all.flat() as PlainValue[]) : null;
}

const UNITS: [RegExp, string][] = [
  [/hours$/i, 'hour'],
  [/days$/i, 'day'],
  [/minutes$/i, 'minute'],
];
const unitOf = (key: string) => UNITS.find(([re]) => re.test(key))?.[1];
const counted = (n: number, unit?: string) =>
  unit ? `${n} ${unit}${n === 1 ? '' : 's'}` : String(n);
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const NOT_SET = 'Leave empty for not set.';
const patternHint = (re?: RegExp) =>
  !re
    ? undefined
    : re.test('AB_1') && !re.test('ab')
      ? 'Capital letters, numbers and underscores only.'
      : re.test('ab_1') && !re.test('AB')
        ? 'Small letters, numbers and underscores only.'
        : undefined;
const hintOf = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(' ') || undefined;

const NO_FORM =
  'This setting holds a list of names you can add to, so it has no form of its own yet. Change it as text: keep the quotes, braces and commas, and write null for not set.';

export interface ShapeOptions {
  /** A key in plain words (default settingFieldName). */
  label?: (key: string) => string;
  /** Number lists that really are a choice, by key: closed weekdays by day name. */
  choices?: Record<string, ShapeOption[]>;
}

function walk(
  schema: unknown,
  value: unknown,
  key: string,
  o: Required<Pick<ShapeOptions, 'label'>> & ShapeOptions,
  nullable = false,
): FieldShape {
  const d = defOf(schema);
  if (d.type === 'nullable') return walk(d.innerType, value, key, o, true);
  if (d.type === 'default') return walk(d.innerType, value, key, o, nullable);
  const money = /(Paise|Inr)$/.test(key);
  const label = key ? o.label(key) : '';
  const option = (v: PlainValue): ShapeOption => ({
    value: v,
    label:
      typeof v === 'number'
        ? counted(v, unitOf(key))
        : typeof v === 'boolean'
          ? v
            ? 'Yes'
            : 'No'
          : /^\w+$/.test(v)
            ? settingFieldName(v)
            : v || 'None',
  });
  const closed = literals(schema);
  if (closed) {
    if (closed.length === 1 && !nullable)
      return { kind: 'fixed', label, value: closed[0]!, text: option(closed[0]!).label };
    return { kind: 'choice', label, nullable, options: closed.map(option) };
  }
  switch (d.type) {
    case 'boolean':
      return { kind: 'boolean', label };
    case 'number': {
      const n = schema as { minValue: number | null; maxValue: number | null; isInt: boolean };
      const paise = key.endsWith('Paise');
      const shown = (v: number) => (paise ? v / 100 : v);
      const min = n.minValue === null ? undefined : shown(n.minValue);
      const max = n.maxValue === null ? undefined : shown(n.maxValue);
      return {
        kind: 'number',
        label: money ? `${label} (₹)` : key.endsWith('Percent') ? `${label} (%)` : label,
        hint: hintOf(
          min !== undefined &&
            max !== undefined &&
            `From ${min.toLocaleString('en-IN')} to ${max.toLocaleString('en-IN')}.`,
          nullable && NOT_SET,
        ),
        min,
        max,
        whole: n.isInt && !paise,
        nullable,
        paise,
        unit: unitOf(key),
      };
    }
    case 'string': {
      const pattern = checkOf(d, 'string_format')?.pattern;
      const maxLength = checkOf(d, 'max_length')?.maximum;
      const time = Boolean(pattern?.test('09:30') && !pattern.test('24:00'));
      return {
        kind: 'text',
        label,
        hint: hintOf(patternHint(pattern), nullable && NOT_SET),
        nullable,
        time,
        long: (maxLength ?? 0) >= 300,
        maxLength,
      };
    }
    case 'array': {
      const elements = literals(d.element);
      const choices = o.choices?.[key] ?? elements?.map(option);
      if (choices) return { kind: 'choices', label, options: choices };
      const max = checkOf(d, 'max_length')?.maximum;
      return {
        kind: 'list',
        label,
        hint: max ? `Up to ${max}.` : undefined,
        of: walk(d.element, (value as unknown[] | undefined)?.[0], key, o),
        min: checkOf(d, 'min_length')?.minimum ?? 0,
        max,
      };
    }
    case 'object': {
      const stored = (value ?? {}) as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(stored), ...Object.keys(d.shape!)])];
      return {
        kind: 'group',
        label,
        nullable,
        fields: keys
          .filter((k) => k in d.shape!)
          .map((k) => ({ key: k, ...walk(d.shape![k], stored[k], k, o) })),
      };
    }
    default:
      return {
        kind: 'json',
        label,
        hint: NO_FORM,
        line: Object.entries((value ?? {}) as object)
          // A staff record id means nothing to read: say that it is set.
          .map(
            ([k, v]) =>
              `${o.label(k)}: ${v === null ? 'Not set' : /^[0-9a-f-]{36}$/.test(String(v)) ? 'Set' : v}`,
          )
          .join(' · '),
      };
  }
}

export const settingShape = (schema: unknown, value: unknown, options: ShapeOptions = {}) =>
  walk(schema, value, '', { label: settingFieldName, ...options });

export function toDraft(s: FieldShape, v: unknown): Draft {
  switch (s.kind) {
    case 'number':
      return v === null || v === undefined
        ? ''
        : String(s.paise ? (v as number) / 100 : (v as number));
    case 'text':
      return (v as string | null | undefined) ?? '';
    case 'boolean':
      return Boolean(v);
    case 'choice': {
      const i = s.options.findIndex((o) => o.value === v);
      return i < 0 ? (s.nullable ? '' : '0') : String(i);
    }
    case 'choices':
      return [...((v ?? []) as PlainValue[])];
    case 'list':
      return ((v ?? []) as unknown[]).map((x) => toDraft(s.of, x));
    case 'group': {
      const stored = (v ?? {}) as Record<string, unknown>;
      return {
        // Only a nullable group can be off: a new row of a list is a group with something to fill in.
        on: !s.nullable || (v !== null && v !== undefined),
        fields: Object.fromEntries(s.fields.map((f) => [f.key, toDraft(f, stored[f.key])])),
      };
    }
    case 'fixed':
      return '';
    case 'json':
      return JSON.stringify(v, null, 2);
  }
}

/** An empty row for a list: `toDraft` of nothing, ready to fill. */
export const blankDraft = (s: FieldShape) => toDraft(s, undefined);

export function fromDraft(s: FieldShape, d: Draft): unknown {
  switch (s.kind) {
    case 'number':
      if (d === '') return null;
      return s.paise ? Math.round(Number(d) * 100) : Number(d);
    case 'text':
      return d === '' && s.nullable ? null : d;
    case 'boolean':
    case 'choices':
      return d;
    case 'choice':
      return d === '' ? null : s.options[Number(d)]!.value;
    case 'list':
      // An empty row is posted too: the server refuses it by row number, nothing vanishes unseen.
      return (d as Draft[]).map((x) => fromDraft(s.of, x));
    case 'group': {
      const g = d as GroupDraft;
      if (s.nullable && !g.on) return null;
      return Object.fromEntries(s.fields.map((f) => [f.key, fromDraft(f, g.fields[f.key]!)]));
    }
    case 'fixed':
      return s.value;
    case 'json':
      try {
        return JSON.parse(d as string);
      } catch {
        return d; // the server refuses it in words
      }
  }
}

const LIST_SHOWN = 6;
const LINE_MAX = 90;
const names = (items: string[]) =>
  items.length
    ? items.slice(0, LIST_SHOWN).join(', ') +
      (items.length > LIST_SHOWN ? ` and ${items.length - LIST_SHOWN} more` : '')
    : 'None';
const shortText = (s: string) => {
  const one = s.replace(/\s+/g, ' ');
  return one.length > LINE_MAX ? `${one.slice(0, LINE_MAX)}…` : one;
};

/** The value as one plain line for a list: a name, not its code; long text cut short. */
export function settingLine(s: FieldShape, v: unknown): string {
  if (s.kind === 'json') return s.line;
  if (s.kind === 'fixed') return s.text;
  if (v === null || v === undefined) return 'Not set';
  switch (s.kind) {
    case 'number': {
      const n = v as number;
      return s.paise
        ? rupees(n / 100)
        : s.label.includes('₹')
          ? rupees(n)
          : s.label.endsWith('(%)')
            ? `${n} %`
            : counted(n, s.unit);
    }
    case 'text': {
      const t = v as string;
      return t === ''
        ? 'None'
        : /^[A-Z][A-Z0-9_]+$/.test(t)
          ? settingFieldName(t.toLowerCase())
          : shortText(t);
    }
    case 'boolean':
      return v ? 'Yes' : 'No';
    case 'choice':
      return s.options.find((o) => o.value === v)?.label ?? String(v);
    case 'choices':
      return names(
        (v as PlainValue[]).map((x) => s.options.find((o) => o.value === x)?.label ?? String(x)),
      );
    case 'list':
      return names((v as unknown[]).map((x) => settingLine(s.of, x)));
    case 'group': {
      const stored = v as Record<string, unknown>;
      const name = s.fields.find((f) => f.key === 'label');
      if (name) return settingLine(name, stored.label);
      const [only, ...rest] = s.fields;
      return only && !rest.length && only.kind !== 'boolean'
        ? settingLine(only, stored[only.key])
        : s.fields.map((f) => `${f.label}: ${settingLine(f, stored[f.key])}`).join(' · ');
    }
  }
}
