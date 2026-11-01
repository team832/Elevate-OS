/**
 * Owner, 31 Oct 2026: "made up everything". The one names table holds normal names, none repeated,
 * none a real teacher's, and phones no real line uses. The seeded rows are scanned in
 * ../integration/sample-fill.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  COVER_TEACHERS,
  DEMO_ACCOUNTS,
  DEV_ASSUMPTION_ACCOUNTS,
  everySampleName,
  FAKE_PHONE_PATTERN,
  fakePhone,
  knownPerson,
  SAMPLE_SCHAR,
  samplePerson,
  sampleStaffDetails,
  SEED_USERS,
  TEACHER_STAFF,
} from '@elevate/database/seed';
import { normalisePhone } from '@elevate/shared-contracts';
import { OWNER_SUPPLIED_STAFF } from '../../../business-ops-os/seed/teachers';

const names = everySampleName();
const realWords = OWNER_SUPPLIED_STAFF.flatMap((t) => t.fullName.split(' ')).filter(
  (w) => w !== "Ma'am",
);

describe('made-up names', () => {
  it('are two normal words in English letters, and no two people share one', () => {
    expect(names.length).toBeGreaterThan(200);
    expect(names.filter((n) => !/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(n))).toEqual([]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('hold no marker and no role word', () => {
    const wrong =
      /\b(sample|demo|test|mock|fictional|teacher|manager|parent|student|staff|admin|director|counsellor|coordinator|auditor|contributor|guardian)\b/i;
    expect(names.filter((n) => wrong.test(n))).toEqual([]);
  });

  it('use no first name or surname of the real teachers', () => {
    expect(realWords).toContain('Bhakte');
    expect(names.filter((n) => n.split(' ').some((w) => realWords.includes(w)))).toEqual([]);
  });

  it('give every email the first.last form on the reserved domain', () => {
    const p = knownPerson('Tanisha');
    for (const [name, email] of [
      [p.fullName, p.email],
      [p.father.fullName, p.father.email],
      [p.mother.fullName, p.mother.email],
    ])
      expect(email).toBe(`${name!.toLowerCase().replace(' ', '.')}@example.test`);
  });

  it('ask for a new case to be added to the table, and leave a renamed record alone', () => {
    expect(() => knownPerson('Nobody')).toThrow(/STUDENT_FIRST_NAMES/);
    expect(samplePerson('Nobody')).toBeNull();
    expect(sampleStaffDetails('Nobody Atall')).toBeNull();
  });
});

describe('sign-ins', () => {
  const logins = [...SEED_USERS, ...DEMO_ACCOUNTS, ...DEV_ASSUMPTION_ACCOUNTS];

  it('name no real teacher in an address or a display name', () => {
    const real = realWords.map((w) => w.toLowerCase());
    expect(
      logins.filter((l) =>
        real.some((w) => `${l.email} ${l.displayName}`.toLowerCase().includes(w)),
      ),
    ).toEqual([]);
  });

  it('that a person uses on the package are all on the organisation domain, Schar included', () => {
    expect(SAMPLE_SCHAR.email).toMatch(/@elevateeducation\.in$/);
    expect(
      DEV_ASSUMPTION_ACCOUNTS.filter((a) => !a.email.endsWith('@elevateeducation.in')),
    ).toEqual([]);
  });
});

describe('fakePhone', () => {
  it.each([0, 42, 99_999])('%i passes the one phone rule and stays what it was', (n) => {
    const phone = fakePhone(n);
    expect(normalisePhone(phone)).toMatchObject({ ok: true, e164: phone });
    expect(phone).toMatch(new RegExp(FAKE_PHONE_PATTERN));
  });

  it('is Delhi with a subscriber part starting 0, five digits after +9111000', () => {
    expect(fakePhone(42)).toBe('+911100000042');
  });

  it('the block rule refuses any other number', () => {
    for (const other of ['+919876543210', '+91110001234', '+9111000123456', 'x+911100012345'])
      expect(other).not.toMatch(new RegExp(FAKE_PHONE_PATTERN));
  });

  it('no two people share a number, parents of one family aside', () => {
    const phones = [
      ...['Tanisha', 'Aarav', 'Pari'].flatMap((first) => {
        const p = knownPerson(first);
        return [p.phone, p.father.phone, p.mother.phone];
      }),
      ...TEACHER_STAFF.flatMap(([, name]) => {
        const d = sampleStaffDetails(name)!;
        return [d.personalPhone, d.emergencyContactPhone];
      }),
    ];
    expect(new Set(phones).size).toBe(phones.length);
    expect(knownPerson('Ishika').father).toEqual(knownPerson('Ishita').father);
  });
});

describe('made-up teachers', () => {
  it('cover every subject the real teachers teach, each with an assignment', () => {
    const covered = COVER_TEACHERS.flatMap((t) => t.subjects as readonly string[]);
    expect(
      OWNER_SUPPLIED_STAFF.flatMap((t) => t.subjects).filter((s) => !covered.includes(s)),
    ).toEqual([]);
    expect(COVER_TEACHERS.filter((t) => !t.assignments.length)).toEqual([]);
  });
});
