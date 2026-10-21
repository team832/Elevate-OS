import { describe, expect, it } from 'vitest';
import {
  checkReportingLine,
  formatCode,
  parseCodeNumber,
  resolveSettings,
  SETTING_DEFINITIONS,
  settingSchemas,
  validateSettingChange,
} from '../../src/domain';
import { createPdf } from '../../src/server/pdf/document';

describe('staff rules (A-10)', () => {
  const manager: Record<string, string | null> = { a: 'b', b: 'c', c: null };
  const of = (id: string) => manager[id];
  it('rejects self-management and reporting loops; accepts a valid line', () => {
    expect(checkReportingLine('c', 'a', of)).toMatchObject({
      ok: false,
      path: ['c', 'a', 'b', 'c'],
    });
    expect(checkReportingLine('a', 'a', of).ok).toBe(false);
    expect(checkReportingLine('d', 'a', of)).toEqual({ ok: true });
    expect(checkReportingLine('a', null, of)).toEqual({ ok: true });
  });
});

describe('settings / policy register (OPS-022)', () => {
  it('defaults carry their decision states', () => {
    const s = resolveSettings([]);
    expect(s['demo.terms']).toMatchObject({ decisionState: 'approved' });
    // Session count moved to admissions.demo.day_count (D-038): tests/unit/demos.test.ts.
    expect(s['demo.fee']).toMatchObject({ decisionState: 'approved', value: { amountInr: 1000 } });
    expect(s['demo.limits']).toMatchObject({
      decisionState: 'open',
      ownerDecision: 'OD-012',
      value: { maxConsecutiveDays: null },
    });
    expect(s['pipeline.demo_skip'].decisionState).toBe('proposed');
    expect(s['kpi.conversion'].decisionState).toBe('proposed');
  });
  it('owner decisions of 21 Oct 2026: registration ₹5,000; the paper-form declaration (v2) is approved and printable', async () => {
    const s = resolveSettings([]);
    expect(s['fees.registration']).toMatchObject({
      decisionState: 'approved',
      value: { amountPaise: 5_000_00 },
    });
    const d = s['admissions.declarations'];
    expect(d).toMatchObject({ decisionState: 'approved', value: { version: '2' } });
    expect(settingSchemas['admissions.declarations'].parse(d.value)).toEqual(d.value);
    const text = d.value.text!;
    expect(text.split('\n')).toHaveLength(17);
    expect(text).toContain('1. Fees are non-refundable.');
    expect(text).not.toMatch(/\[[^\]]*\]/);
    const pdf = await createPdf({ title: 't', reference: 'r', templateVersion: 't' });
    pdf.paragraph(text);
    expect(pdf.unsupportedCharacters).toBe(false);
    expect(pdf.lines.join(' ')).toContain('accepted these Terms & Conditions.');
  });
  it('stored values override; invalid stored values fall back to defaults', () => {
    const s = resolveSettings([
      {
        key: 'pipeline.demo_skip',
        value: { allowed: false },
        decisionState: 'proposed',
        source: null,
        ownerDecision: null,
      },
      {
        key: 'kpi.conversion',
        value: { windowDays: 'soon' },
        decisionState: 'proposed',
        source: null,
        ownerDecision: null,
      },
    ]);
    expect(s['pipeline.demo_skip']).toMatchObject({ value: { allowed: false }, origin: 'stored' });
    expect(s['kpi.conversion']).toMatchObject({
      origin: 'invalid_stored',
      value: SETTING_DEFINITIONS['kpi.conversion'].defaultValue,
    });
  });
  it.each([
    ['admissions.number.format', { prefix: 'EE', separator: '-', includeYear: true, width: 4 }],
    ['fees.tuition_split', { sharesPercent: [100] }],
  ] as const)('a valid stored row never overrides the non-editable %s', (key, value) => {
    const s = resolveSettings([
      { key, value, decisionState: 'proposed', source: null, ownerDecision: null },
    ]);
    expect(s[key]).toMatchObject({
      origin: 'default',
      value: SETTING_DEFINITIONS[key].defaultValue,
    });
  });
  it('changes are validated, stay proposed, and legacy-approved records are read-only', () => {
    expect(validateSettingChange('demo.terms', { days: 3 })).toMatchObject({ ok: false });
    expect(validateSettingChange('nope', {})).toMatchObject({ ok: false });
    expect(validateSettingChange('kpi.conversion', { windowDays: 5 })).toMatchObject({ ok: false });
    expect(validateSettingChange('demo.fee', { amountInr: 1500 })).toEqual({
      ok: true,
      key: 'demo.fee',
      value: { amountInr: 1500 },
      decisionState: 'proposed',
    });
  });
});

describe('business codes', () => {
  it('codes are padded, parsed, and legacy codes never parse as new codes', () => {
    expect(formatCode('lead', 7)).toBe('LEAD-000007');
    expect(formatCode('feeRecord', 12)).toBe('FEE-000012');
    expect(parseCodeNumber('admission', 'ADM-000042')).toBe(42);
    expect(parseCodeNumber('lead', 'LEGACY-OPSWB-L-003')).toBeNull();
    expect(() => formatCode('admission', 0)).toThrow();
  });
});
