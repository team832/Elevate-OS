/** The owner's paper form as data: document checklist, fee tracker/summary from recorded rows only, declaration sections. */
import { describe, expect, it } from 'vitest';
import {
  declarationSections,
  documentChecklist,
  EMPTY_FORM_FIELDS,
  feeSummary,
  feeTracker,
  type TrackerRecord,
} from '../../src/domain/admission-form';
import type { ApplicationSnapshot } from '../../src/domain/applications';
import type { IsoDate } from '../../src/domain/dates';
import { allocateInstalments, planTotals, type InstalmentLike } from '../../src/domain/fee-plans';
import { SETTING_DEFINITIONS } from '../../src/domain/policies';

const s = {
  registrationFeePaise: 5_000_00,
  feeAgreement: {
    planId: 'p',
    version: 1,
    label: 'x',
    totalPaise: 100_000_00,
    academicYear: '2026-27',
    instalments: [50_000_00, 25_000_00, 25_000_00].map((amountPaise, i) => ({
      sequence: i + 1,
      dueDate: `2026-1${i}-01`,
      amountPaise,
    })),
  },
  form: EMPTY_FORM_FIELDS,
} as unknown as ApplicationSnapshot;
const rec = (r: Partial<TrackerRecord> & Pick<TrackerRecord, 'kind' | 'amountPaise'>) =>
  ({ status: 'recorded', direction: null, chargeCategory: 'tuition', ...r }) as TrackerRecord;

describe('document checklist (section 05)', () => {
  it('ID proof is met by any identity type; the best state wins; nothing recorded is not "no"', () => {
    const rows = documentChecklist([
      { documentType: 'pan', verificationStatus: 'rejected' },
      { documentType: 'aadhaar', verificationStatus: 'verified' },
      { documentType: 'photograph', verificationStatus: 'unverified' },
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.key, r.state]))).toEqual({
      id_proof: 'verified',
      photograph: 'unverified',
      previous_marksheet: 'not_recorded',
      address_proof: 'not_recorded',
      other: 'not_recorded',
    });
  });
});

describe('fee tracker and summary (sections 07, 08) reuse the Fees tab maths', () => {
  const TODAY = '2026-10-21' as IsoDate;
  const inst: InstalmentLike[] = s.feeAgreement!.instalments.map((i) => ({
    ...i,
    id: `i${i.sequence}`,
  }));
  const plan = (r: Parameters<typeof rec>[0]) => rec({ planId: 'p', ...r });

  it('nothing recorded: received, dates and modes stay blank (null), balances are the due amounts', () => {
    const rows = feeTracker(s, [], inst, TODAY);
    expect(rows.map((r) => r.label)).toEqual([
      'Registration',
      '1st instalment',
      '2nd instalment',
      '3rd instalment',
      'Other',
    ]);
    expect(rows.every((r) => r.receivedPaise === null && r.mode === null)).toBe(true);
    expect(rows.map((r) => r.balancePaise)).toEqual([
      5_000_00,
      50_000_00,
      25_000_00,
      25_000_00,
      null,
    ]);
    expect(feeSummary(s, [], inst)).toEqual({
      registrationPaise: 5_000_00,
      coursePaise: 100_000_00,
      discountPaise: null,
      netPaise: 105_000_00,
    });
  });

  it('an unlinked payment and a credit adjustment give exactly the Fees tab allocation and totals', () => {
    const ledger = [
      plan({
        id: 'a',
        kind: 'received',
        amountPaise: 30_000_00,
        instalmentId: 'i1',
        paymentDate: '2026-10-02',
        method: 'upi',
      }),
      plan({
        id: 'b',
        kind: 'received',
        amountPaise: 40_000_00,
        paymentDate: '2026-10-05',
        method: 'cash',
      }),
      plan({ id: 'c', kind: 'adjustment', direction: 'credit', amountPaise: 2_000_00 }),
      plan({ id: 'd', kind: 'received', amountPaise: 9_00, instalmentId: 'i2', status: 'voided' }),
      rec({ id: 'e', kind: 'received', amountPaise: 5_000_00, chargeCategory: 'registration' }),
      rec({ id: 'f', kind: 'received', amountPaise: 700_00, chargeCategory: 'demo' }),
    ];
    const rows = feeTracker(s, ledger, inst, TODAY);
    const canonical = allocateInstalments(
      inst,
      ledger.filter((r) => r.planId === 'p'),
      TODAY,
    );
    expect(rows.slice(1, 4).map((r) => [r.receivedPaise, r.balancePaise])).toEqual(
      canonical.map((a) => [a.paidPaise || null, a.remainingPaise]),
    );
    expect(rows[1]).toMatchObject({ lastReceiptDate: '2026-10-02', mode: 'upi' });
    expect(rows[0]!.balancePaise).toBe(0);
    expect(rows[4]!.receivedPaise).toBe(700_00);
    expect(feeSummary(s, ledger, inst).discountPaise).toBe(
      planTotals(
        100_000_00,
        inst,
        ledger.filter((r) => r.planId === 'p'),
      ).reductionsPaise,
    );
  });

  it('net is unknown when the registration fee is not set (never treated as 0)', () => {
    const noReg = { ...s, registrationFeePaise: null } as ApplicationSnapshot;
    expect(
      feeSummary(noReg, [plan({ kind: 'discount', amountPaise: 2_000_00 })], inst),
    ).toMatchObject({ discountPaise: 2_000_00, netPaise: null });
  });
});

describe('declaration sections', () => {
  it('the approved v2 text splits into declaration, fee acknowledgement and 12 terms', () => {
    const v2 = SETTING_DEFINITIONS['admissions.declarations'].defaultValue.text!;
    const sections = declarationSections(v2);
    expect(sections.map((x) => x.title?.slice(0, 18))).toEqual([
      'Student / parent d',
      'Fee acknowledgemen',
      'Terms & Conditions',
    ]);
    expect(sections[2]!.lines).toHaveLength(12);
  });
  it('untitled text is one section', () => {
    expect(declarationSections('One line of text.\nAnother.')).toEqual([
      { title: null, lines: ['One line of text.', 'Another.'] },
    ]);
  });
});
