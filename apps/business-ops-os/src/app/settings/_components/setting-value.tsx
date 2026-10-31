/**
 * A setting as people read it (never raw JSON): one plain line for lists, label/value rows for its
 * record, its status in words, and the one edit form both settings pages open.
 */
import type { ReactNode } from 'react';
import {
  IN_USE_NOT_APPROVED,
  settingLine,
  settingShape,
  SettingFields,
  StatusBadge,
  type Column,
} from '@elevate/shared-ui';
import { settingFieldName } from '@elevate/shared-types';
import {
  DECISION_STATE_LABELS,
  settingSchemas,
  type DecisionState,
  type ResolvedSetting,
  type SettingKey,
} from '../../../domain';
import type { ReminderSettings } from '../../../domain/task-notices';
import { ActionForm } from '../../../ui/action-form';
import { decisionTone, fmtPaise, humanise } from '../../../ui/format';
import { DetailTable, type DetailRow } from '../../../ui/sections';
import { ReminderPreview } from '../../../ui/task-notices';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Unit by the key's ending: amounts, day counts, minutes, percentages. */
const NUMBER_BY_SUFFIX: [RegExp, (n: number) => string][] = [
  [/Paise$/, fmtPaise],
  [/Inr$/, (n) => `₹${n.toLocaleString('en-IN')}`],
  [/Days$/, (n) => `${n} day${n === 1 ? '' : 's'}`],
  [/Minutes$/, (n) => `${n} minutes`],
  [/Percent$/, (n) => `${n} %`],
];
const code = (s: string) => (/^[a-z][a-z0-9_]*$/.test(s) ? humanise(s) : decisionWords(s));

function show(key: string, v: unknown): ReactNode {
  if (v === null || v === undefined) return 'Not set';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number')
    return (NUMBER_BY_SUFFIX.find(([re]) => re.test(key))?.[1] ?? String)(v);
  if (typeof v === 'string')
    return v.includes('\n') ? <p className="el-pre">{v}</p> : v === '' ? 'None' : code(v);
  if (Array.isArray(v)) {
    if (!v.length) return 'None';
    if (key === 'closedWeekdays') return v.map((d: number) => WEEKDAYS[d]).join(', ');
    if (key === 'departmentCodes')
      return v.map((d: string) => humanise(d.toLowerCase())).join(', ');
    if (typeof v[0] === 'object')
      return (
        <ul>
          {v.map((c: { code: string; label: string }) => (
            <li key={c.code}>{c.label}</li>
          ))}
        </ul>
      );
    return v.map((x) => show(key, x)).join(', ');
  }
  return <DetailTable rows={valueRows(v)} />;
}

export const valueRows = (value: object): DetailRow[] =>
  Object.entries(value).map(([key, v]) => ({
    label: settingFieldName(key),
    value: show(key, v),
  }));

/** A setting's state in words; Proposed reads as what it is: in use (holidays keep their own word). */
export const settingStateWord = (state: DecisionState) =>
  state === 'proposed' ? IN_USE_NOT_APPROVED : DECISION_STATE_LABELS[state];

export const StateBadge = ({ state }: { state: DecisionState }) => (
  <StatusBadge tone={decisionTone(state)}>{settingStateWord(state)}</StatusBadge>
);

type SettingValueOf = { key: SettingKey; value: unknown };

export const shapeOf = (s: SettingValueOf) =>
  settingShape(settingSchemas[s.key], s.value, {
    choices: { closedWeekdays: WEEKDAYS.map((label, value) => ({ value, label })) },
  });

export const valueLine = (s: SettingValueOf) => decisionWords(settingLine(shapeOf(s), s.value));

export const INVALID_STORED = 'Stored value invalid: default used';

/** Name, plain current value and status first; the long explanation stays behind a disclosure. */
export const SETTING_COLUMNS: Column<ResolvedSetting>[] = [
  { key: 'label', header: 'Setting' },
  { key: 'value', header: 'Current value', render: valueLine },
  {
    key: 'state',
    header: 'Status',
    render: (s) => (
      <>
        <StateBadge state={s.decisionState} />
        {s.origin === 'invalid_stored' ? (
          <StatusBadge tone="warning">{INVALID_STORED}</StatusBadge>
        ) : null}
        {s.editable ? null : <p className="el-field-hint">Fixed for now</p>}
      </>
    ),
  },
  {
    key: 'about',
    header: 'About',
    render: (s) => (
      <details className="el-explain">
        <summary>
          What it controls<span className="el-visually-hidden">: {s.label}</span>
        </summary>
        <p>{s.description}</p>
      </details>
    ),
  },
];

/** The preview of a task-reminders setting, for wherever that setting shows. */
export const remindersPreviewOf = (rows: readonly ResolvedSetting[]) => {
  const s = rows.find((r) => r.key === 'tasks.reminders');
  return s ? <ReminderPreview s={s.value as ReminderSettings} /> : null;
};

/** Saving posts `{ value, note }` to the setting's route, the server validates as before. */
export function SettingEditForm({
  s,
  api,
  close,
}: {
  s: ResolvedSetting;
  api: string;
  close: string;
}) {
  return (
    <ActionForm
      action={`${api}/${s.key}`}
      method="PUT"
      submitLabel="Save new value"
      redirectTo={close}
      secondary={<a href={close}>Cancel</a>}
      fields={[
        {
          name: 'value',
          label: 'New value',
          type: 'json',
          required: true,
          control: <SettingFields name="value" shape={shapeOf(s)} value={s.value} />,
          section: 'New value',
        },
        { name: 'note', label: 'Why (optional)', section: 'New value' },
      ]}
    />
  );
}

/** The owner's decision in words, without its decision-record codes. */
export const decisionWords = (ownerDecision: string) =>
  ownerDecision
    .replace(/\bOD-\d{3}(?:,\s*OD-\d{3})*/g, 'Still open')
    .replace(/\bD-\d{3}(?:,\s*D-\d{3})*/g, 'Decided');
