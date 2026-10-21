import { describe, expect, it } from 'vitest';
import {
  compareContacts,
  findDuplicateMatches,
  jaroWinkler,
  nameSimilarity,
  normaliseEmail,
  normaliseName,
  normalisePhone,
  type ContactRecord,
} from '../../src/domain';

describe('normalisePhone (A-01)', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['0 98765 43210', '+919876543210'],
    ['91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['+91 (0) 98765 43210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['091 9876543210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
    ['  +919876543210  ', '+919876543210'],
  ])('normal: %s → %s', (raw, e164) => {
    const r = normalisePhone(raw);
    expect(r).toMatchObject({ ok: true, e164, kind: 'india_mobile' });
  });

  it('classifies a landline (STD code without trunk 0)', () => {
    expect(normalisePhone('0141 2345678')).toEqual({
      ok: true,
      e164: '+911412345678',
      kind: 'india_landline',
    });
  });

  it('keeps international numbers given with + or 00', () => {
    expect(normalisePhone('+1 415 555 0100')).toEqual({
      ok: true,
      e164: '+14155550100',
      kind: 'international',
    });
    expect(normalisePhone('0044 20 7946 0000')).toEqual({
      ok: true,
      e164: '+442079460000',
      kind: 'international',
    });
  });

  it('missing: empty, blank, null and undefined', () => {
    for (const raw of ['', '   ', null, undefined])
      expect(normalisePhone(raw)).toEqual({ ok: false, reason: 'missing' });
  });

  it('invalid characters: letters, extensions, a + in the middle', () => {
    expect(normalisePhone('98765abcde')).toEqual({ ok: false, reason: 'invalid_characters' });
    expect(normalisePhone('9876543210 ext 12')).toEqual({
      ok: false,
      reason: 'invalid_characters',
    });
    expect(normalisePhone('98765+43210')).toEqual({ ok: false, reason: 'invalid_characters' });
  });

  it('boundary lengths: 9 and 11 digits (no trunk 0) are rejected', () => {
    expect(normalisePhone('987654321')).toEqual({ ok: false, reason: 'invalid_length' });
    expect(normalisePhone('98765432101')).toEqual({ ok: false, reason: 'invalid_length' });
    expect(normalisePhone('+91 98765 4321')).toEqual({ ok: false, reason: 'invalid_length' });
    expect(normalisePhone('+1234567')).toEqual({ ok: false, reason: 'invalid_length' });
  });

  it('a national number starting with 0 after prefixes is invalid', () => {
    expect(normalisePhone('1234567890')).toMatchObject({ ok: true });
    expect(normalisePhone('0000000000').ok).toBe(false); // read as a 00 international prefix → too short
    expect(normalisePhone('+91 0876543210')).toEqual({ ok: false, reason: 'invalid_number' });
  });

  it('is idempotent: normalising an E.164 result returns it unchanged', () => {
    const once = normalisePhone('098765 43210');
    if (!once.ok) throw new Error('expected ok');
    expect(normalisePhone(once.e164)).toMatchObject({ ok: true, e164: once.e164 });
  });
});

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Riya.Sharma@Example.TEST ')).toEqual({
      ok: true,
      email: 'riya.sharma@example.test',
    });
  });
  it('does not rewrite provider-specific forms (dots, +tags)', () => {
    expect(normaliseEmail('a.b+x@example.test')).toEqual({ ok: true, email: 'a.b+x@example.test' });
  });
  it('missing and invalid', () => {
    expect(normaliseEmail('')).toEqual({ ok: false, reason: 'missing' });
    expect(normaliseEmail('not-an-email')).toEqual({ ok: false, reason: 'invalid' });
    expect(normaliseEmail('a@b')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('names (weak signal)', () => {
  it('normaliseName strips honorifics, accents and punctuation', () => {
    expect(normaliseName('Ms. Riyá  SHARMA.')).toBe('riya sharma');
  });
  it('jaroWinkler: identical 1, disjoint 0, empty 0', () => {
    expect(jaroWinkler('martha', 'martha')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('', 'abc')).toBe(0);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
  });
  it('nameSimilarity handles swapped order and minor typos', () => {
    expect(nameSimilarity('Riya Sharma', 'Sharma Riya')).toBe(1);
    expect(nameSimilarity('Riya Sharma', 'Riya Sharmaa')).toBeGreaterThan(0.95);
    expect(nameSimilarity('Riya Sharma', 'Kabir Mehta')).toBeLessThan(0.7);
    // siblings share a surname: not "similar"
    expect(nameSimilarity('Riya Sharma', 'Kabir Sharma')).toBeLessThan(0.88);
    expect(nameSimilarity('Riya Sharma', 'Riya')).toBe(0.5);
    expect(nameSimilarity(null, 'Kabir')).toBe(0);
  });
});

const rec = (over: Partial<ContactRecord> & { id: string }): ContactRecord => ({
  code: `LEAD-${over.id.padStart(6, '0')}`,
  studentName: 'Riya Sharma',
  studentPhone: null,
  studentEmail: null,
  guardianPhone: null,
  guardianEmail: null,
  previousSchool: null,
  ...over,
});

describe('duplicate detection (A-02)', () => {
  const candidate = rec({
    id: '0',
    code: '',
    studentPhone: '+919800000001',
    guardianPhone: '+919800000009',
    previousSchool: 'Sunrise Public School',
  });

  it('exact: same student phone', () => {
    const m = compareContacts(
      candidate,
      rec({ id: '1', studentPhone: '+919800000001', studentName: 'Someone Else' }),
    );
    expect(m).toMatchObject({ level: 'exact', signals: ['student_phone'] });
  });

  it('exact: student contact equals the other record’s guardian contact', () => {
    const m = compareContacts(
      candidate,
      rec({ id: '2', guardianPhone: '+919800000001', studentName: 'Kabir Mehta' }),
    );
    expect(m?.level).toBe('exact');
    expect(m?.signals).toContain('student_contact_is_guardian_contact');
  });

  it('possible: only the guardian phone is shared (a sibling?) — never exact on its own', () => {
    const m = compareContacts(
      candidate,
      rec({ id: '3', guardianPhone: '+919800000009', studentName: 'Kabir Sharma' }),
    );
    expect(m).toMatchObject({ level: 'possible', signals: ['guardian_phone'] });
  });

  it('exact: shared guardian phone AND a similar name', () => {
    const m = compareContacts(
      candidate,
      rec({ id: '4', guardianPhone: '+919800000009', studentName: 'Riya Sharmaa' }),
    );
    expect(m?.level).toBe('exact');
    expect(m?.signals).toEqual(['guardian_phone', 'similar_name']);
  });

  it('possible: similar name + same school, no shared contact', () => {
    const m = compareContacts(
      candidate,
      rec({ id: '5', studentName: 'Riya Sharma', previousSchool: 'sunrise public school' }),
    );
    expect(m).toMatchObject({ level: 'possible', signals: ['same_school', 'similar_name'] });
  });

  it('weak signal: a similar name alone is never reported', () => {
    expect(compareContacts(candidate, rec({ id: '6', studentName: 'Riya Sharma' }))).toBeNull();
  });

  it('missing data: records without contacts or school do not match', () => {
    expect(compareContacts(rec({ id: '7' }), rec({ id: '8' }))).toBeNull();
  });

  it('same school alone does not match', () => {
    expect(
      compareContacts(
        candidate,
        rec({ id: '9', studentName: 'Kabir Mehta', previousSchool: 'Sunrise School' }),
      ),
    ).toBeNull();
  });

  it('emails compare after normalisation (caller normalises): exact on student email', () => {
    const a = rec({ id: '10', studentEmail: 'riya@example.test' });
    const b = rec({ id: '11', studentEmail: 'riya@example.test', studentName: 'R. S.' });
    expect(compareContacts(a, b)?.signals).toEqual(['student_email']);
  });

  it('findDuplicateMatches orders exact before possible, then by signal count, then code (deterministic)', () => {
    const existing = [
      rec({ id: '20', guardianPhone: '+919800000009', studentName: 'Kabir Sharma' }),
      rec({ id: '21', studentPhone: '+919800000001' }),
      rec({ id: '22', studentPhone: '+919800000001', guardianPhone: '+919800000009' }),
    ];
    const order = findDuplicateMatches(candidate, existing).map((m) => [m.code, m.level]);
    expect(order).toEqual([
      ['LEAD-000022', 'exact'],
      ['LEAD-000021', 'exact'],
      ['LEAD-000020', 'possible'],
    ]);
    expect(findDuplicateMatches(candidate, [...existing].reverse())).toEqual(
      findDuplicateMatches(candidate, existing),
    );
  });

  it('conflicting: a record never matches itself', () => {
    const self = rec({ id: '30', studentPhone: '+919800000001' });
    expect(compareContacts(self, self)).toBeNull();
  });
});
