/** A setting's value as label/value rows people can read (never raw JSON), plus its decision badge. */
import type { ReactNode } from 'react';
import { FeatureStatusBadge, StatusBadge } from '@elevate/shared-ui';
import { DECISION_STATE_LABELS, type DecisionState } from '../../../domain';
import { decisionTone, fmtPaise, humanise } from '../../../ui/format';
import { DetailTable, type DetailRow } from '../../../ui/sections';

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

/** `windowDays` → "Window days"; the unit is in the value, so `amountPaise` → "Amount". */
const labelOf = (key: string) =>
  humanise(
    key
      .replace(/(Paise|Inr|Percent)$/, '')
      .replace(/Codes$/, 's')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase(),
  );

export const valueRows = (value: object): DetailRow[] =>
  Object.entries(value).map(([key, v]) => ({
    label: labelOf(key),
    value: show(key, v),
  }));

export const StateBadge = ({ state }: { state: DecisionState }) =>
  state === 'proposed' ? (
    <FeatureStatusBadge status="Proposed" />
  ) : (
    <StatusBadge tone={decisionTone(state)}>{DECISION_STATE_LABELS[state]}</StatusBadge>
  );

/** The owner's decision in words, without its decision-record codes. */
export const decisionWords = (ownerDecision: string) =>
  ownerDecision
    .replace(/\bOD-\d{3}(?:,\s*OD-\d{3})*/g, 'Still open')
    .replace(/\bD-\d{3}(?:,\s*D-\d{3})*/g, 'Decided');
