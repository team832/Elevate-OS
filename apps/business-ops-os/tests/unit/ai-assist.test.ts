/** AI draft helpers: redaction, value shapes, the adapter's not-set-up state, client imports. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { namesToMask, redact, redactContacts, shapeOf } from '../../src/domain/ai-assist';
import { aiAssist } from '../../src/server/adapters/ai-assist';

describe('redact (feedback text before it is sent)', () => {
  it.each([
    ['Asha found the pace too fast', ['Sample Asha Verma'], '[name] found the pace too fast'],
    ['Call 98290 12345 or +91-98290-12345', [], 'Call [phone] or [phone]'],
    ['mail asha@example.test please', [], 'mail [email] please'],
    ['ADM no SAMPLE-ADM-1 / EE-2026-00042 / EL/2026/001', [], 'ADM no [code] / [code] / [code]'],
    ['admission 00042 in batch IPMAT-C12-APR27', [], 'admission [number] in batch [code]'],
    ['Mr Kumar and Rahul Sharma helped', [], 'Mr [name] and [name] helped'],
    [
      'Doubts were not cleared, classes felt rushed.',
      [],
      'Doubts were not cleared, classes felt rushed.',
    ],
    ['batch IPMATC12APR27, EE2026001, Class 12th', [], 'batch [code], [code], Class 12th'],
    ['Roll no. 7 and roll 42 complained', [], 'Roll [number] and roll [number] complained'],
    ['Om explains well', ['Om Prakash'], '[name] explains well'],
    ['राहुल सर अच्छा पढ़ाते हैं', [], '[name] सर अच्छा पढ़ाते हैं'],
  ])('%s', (text, names, out) => expect(redact(text, names)).toBe(out));

  it.each([
    '+91 98290 12345',
    '+91-98290-12345',
    '+919829012345',
    '(+91) 98290 12345',
    '09829012345',
    '98290 12345',
    '9829012345',
  ])('phone %s is masked', (p) => expect(redactContacts(`call ${p} now`)).toBe('call [phone] now'));

  it.each(['2026-09-16', '30-10-2026', '30/10/2026', '30.10.2026'])('date %s stays', (d) =>
    expect(redactContacts(`due ${d} at 09:30`)).toBe(`due ${d} at 09:30`),
  );

  it('facts mode (own work report) keeps counts, dates and titles; masks names and codes', () =>
    expect(
      redact(
        'Graded 120 papers for Asha, EL/2026/014, due 2026-09-16: Prepare Physics Notes',
        ['Asha Verma'],
        'facts',
      ),
    ).toBe('Graded 120 papers for [name], [code], due 2026-09-16: Prepare Physics Notes'));
});

describe('namesToMask (only real names; readable text stays readable)', () => {
  const names = namesToMask(
    [
      'Sample Maths Teacher',
      'X Sample Student',
      'Priya Malhotra',
      'Rohit Physics Jain',
      'Riya Sharma',
    ],
    ['IPMAT', 'Integrated Programme in Management'],
  );
  it('drops sample people and role, subject and catalogue words', () =>
    expect(names).toEqual(['Priya Malhotra', 'Rohit Jain', 'Riya Sharma']));
  it.each([
    [
      'The teacher explains integration well in Maths',
      'The teacher explains integration well in Maths',
    ],
    ['priya and rohit copy; Priya copies', '[name] and [name] copy; [name] copies'],
    ['riya sharma was late, riya too', '[name] was late, riya too'],
    ['Riya was late on 16-09-2026 and 2026-09-16', '[name] was late on 16-09-2026 and 2026-09-16'],
  ])('%s', (text, out) => expect(redact(text, names)).toBe(out));
});

describe('shapeOf (a CSV value is never sent, only its shape)', () => {
  it.each([
    ['', 'empty'],
    ['2026-10-19', 'date'],
    ['2026-10-19 09:02', 'date and time'],
    ['09:02', 'time'],
    ['4', 'small whole number (1-10)'],
    ['250', 'number'],
    ['9829012345', 'phone'],
    ['a@example.test', 'email'],
    ['DEMO-T01', 'code (letters and digits)'],
    ['in', 'yes/no or in/out word'],
    ['Sample Asha', 'short text'],
    ['Explains well but the pace is far too fast for most of us', 'long text'],
  ])('%s → %s', (v, shape) => expect(shapeOf(v)).toBe(shape));
});

describe('aiAssist adapter', () => {
  it.each([{}, { OPENAI_API_KEY: 'test-only-k' }, { OPENAI_MODEL: 'test-model' }])(
    'not configured without both key and model (no default model): %o',
    (env) => expect(aiAssist(env).status).toBe('not_configured'),
  );
  it.each(['http://ai.example.test/v1', 'ftp://x'])('refuses a non-https address %s', (url) =>
    expect(
      aiAssist({ OPENAI_API_KEY: 'test-only-k', OPENAI_MODEL: 'm', OPENAI_BASE_URL: url }).status,
    ).toBe('not_configured'),
  );
  it('configured with both', () =>
    expect(aiAssist({ OPENAI_API_KEY: 'test-only-k', OPENAI_MODEL: 'test-model' }).status).toBe(
      'configured',
    ));
});

describe('client components never import server code', () => {
  const src = path.resolve(__dirname, '../../src');
  it.each(['ui/ai-draft.tsx', 'app/hr/attendance/_components/import-upload.tsx'])('%s', (file) => {
    const code = readFileSync(path.join(src, file), 'utf8');
    expect(code.startsWith("'use client'")).toBe(true);
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => /server|adapters/.test(i!))).toEqual([]);
    expect(code).not.toContain('process.env');
  });
});
