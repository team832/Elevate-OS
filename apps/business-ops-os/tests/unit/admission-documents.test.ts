/** Admission form, acknowledgement and ID card PDFs (acceptance 18): long names, ₹, missing data, page sizes. */
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  documentChecklist,
  EMPTY_FORM_FIELDS,
  feeSummary,
  feeTracker,
  type TrackerRecord,
} from '../../src/domain/admission-form';
import type { ApplicationSnapshot } from '../../src/domain/applications';
import {
  acknowledgementPdf,
  admissionFormPdf,
  idCardPdf,
  type AdmissionRecord,
} from '../../src/server/pdf/admission-documents';
import { SETTING_DEFINITIONS } from '../../src/domain/policies';
import type { IsoDate } from '../../src/domain/dates';

const LONG = 'Sample Student With An Unusually Long Family Name '.repeat(3).trim();
const snapshot: ApplicationSnapshot = {
  student: {
    fullName: LONG,
    preferredName: null,
    phone: null,
    email: 'sample.student@example.test',
    dateOfBirth: '2010-05-04',
    currentStage: 'gap_year',
    schoolBoard: null,
    previousSchool: 'Sample Senior Secondary School',
    city: 'Sikar',
    address: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
  },
  guardians: Array.from({ length: 4 }, (_, i) => ({
    id: null,
    fullName: `${LONG} Parent ${i + 1}`,
    relationship: 'guardian',
    phone: null,
    email: `parent${i}@example.test`,
    address: null,
    isPrimary: i === 0,
    isEmergency: i === 1,
  })),
  programmes: [
    { admissionId: 'a', code: 'CLASS_12', name: 'Class 12 Commerce' },
    { admissionId: 'b', code: 'CLAT', name: 'CLAT' },
  ],
  intendedBatchId: null,
  deliveryMode: 'offline',
  startDate: '2026-11-01',
  academicYear: '2026-27',
  feeAgreement: {
    planId: 'p',
    version: 1,
    label: 'Sample agreement',
    totalPaise: 120_000_00,
    academicYear: '2026-27',
    instalments: [60_000_00, 30_000_00, 30_000_00].map((amountPaise, i) => ({
      sequence: i + 1,
      dueDate: `2026-1${i}-01`,
      amountPaise,
    })),
  },
  registrationFeePaise: null,
  declarations: null,
  form: EMPTY_FORM_FIELDS,
  counsellorName: 'Sample Counsellor',
};
const out = process.env.PDF_SAMPLE_OUT;
const v2 = SETTING_DEFINITIONS['admissions.declarations'].defaultValue;
const withDeclaration: ApplicationSnapshot = {
  ...snapshot,
  declarations: { text: v2.text!, version: v2.version! },
  form: { ...EMPTY_FORM_FIELDS, gender: 'Female', batchTiming: '4–6 pm' },
};
const ledger: TrackerRecord[] = [
  {
    id: 'r1',
    kind: 'received',
    direction: null,
    chargeCategory: 'registration',
    amountPaise: 5_000_00,
    status: 'recorded',
    paymentDate: '2026-10-21',
    method: 'upi',
  },
  {
    id: 'r2',
    kind: 'received',
    direction: null,
    chargeCategory: 'tuition',
    amountPaise: 60_000_00,
    status: 'recorded',
    instalmentId: 'i1',
    planId: 'p',
    paymentDate: '2026-10-22',
    method: 'cash',
  },
];
const INSTALMENTS = snapshot.feeAgreement!.instalments.map((i) => ({
  ...i,
  id: `i${i.sequence}`,
}));
/** A typical application: one guardian, a normal name, the approved v2 text. */
const typical: ApplicationSnapshot = {
  ...withDeclaration,
  student: { ...snapshot.student, fullName: 'Sample Student', address: '12 Sample Street' },
  guardians: [snapshot.guardians[0]!].map((g) => ({ ...g, fullName: 'Sample Parent' })),
  programmes: [{ admissionId: 'a', code: 'CLAT', name: 'CLAT' }],
};
const record = (
  s: ApplicationSnapshot,
  admission: AdmissionRecord['admission'] = null,
): AdmissionRecord => ({
  reference: 'APP-000123',
  version: 2,
  generatedAt: new Date('2026-10-21T06:00:00Z'),
  snapshot: s,
  documents: documentChecklist([{ documentType: 'aadhaar', verificationStatus: 'verified' }]),
  summary: feeSummary(s, ledger, INSTALMENTS),
  tracker: feeTracker(s, ledger, INSTALMENTS, '2026-10-22' as IsoDate),
  checkedBy: ['Sample Counsellor', 'Sample Manager'],
  admission,
});

describe('admission documents', () => {
  it('a typical form is exactly the owner’s 3 sheets; long values run longer but never clip', async () => {
    let lines: readonly string[] = [];
    const bytes = await admissionFormPdf(record(typical), (l) => (lines = l));
    if (out) writeFileSync(`${out}/form-v3.pdf`, bytes);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(lines).toContain('04 May 2010'); // dates as on paper, not ISO
    expect(lines.join(' ')).not.toMatch(/not approved/);
    const long = await PDFDocument.load(await admissionFormPdf(record(withDeclaration)));
    if (out) writeFileSync(`${out}/form-v3-long.pdf`, await long.save());
    expect(long.getPageCount()).toBeGreaterThanOrEqual(3);
    const doc2 = doc;
    expect(doc2.getPages().every((p) => Math.round(p.getWidth()) === 595)).toBe(true);
    expect(doc2.getTitle()).toBe('Student Admission & Fee Record — APP-000123 · version 2');
  });

  it('the not-approved block prints only without approved text; untitled approved text never triggers it', async () => {
    const text = (s: ApplicationSnapshot) =>
      admissionFormPdf(record(s), (l) => (seen = l.join(' '))).then(() => seen);
    let seen = '';
    expect(await text(snapshot)).toMatch(/not configured or not approved/);
    const untitled = {
      ...typical,
      declarations: { text: 'One approved paragraph.', version: 't' },
    };
    const printed = await text(untitled);
    expect(printed).not.toMatch(/not configured or not approved/);
    expect(printed).toMatch(/Covered by the approved declaration on page 1/);
  });

  it('acknowledgement and card open; the card is CR80', async () => {
    const ack = await acknowledgementPdf({
      record: {
        ...record(withDeclaration),
        admission: { number: '001', date: '2026-10-21', approvedBy: 'Sample Director' },
      },
      approvedAt: new Date('2026-10-21T06:00:00Z'),
      signedOn: '2026-10-21',
      signers: [`${LONG} (student)`],
      academicSetup: 'Admission confirmed — academic setup pending',
      showFees: true,
    });
    const card = await idCardPdf({
      fullName: LONG,
      admissionNumber: '1000',
      programmes: 'Class 12 Commerce + CLAT',
      academicYear: null,
    });
    if (out) {
      writeFileSync(`${out}/sample-ack.pdf`, ack);
      writeFileSync(`${out}/sample-id-card.pdf`, card);
    }
    expect((await PDFDocument.load(ack)).getPageCount()).toBeGreaterThanOrEqual(1);
    const page = (await PDFDocument.load(card)).getPage(0);
    expect([Math.round(page.getWidth()), Math.round(page.getHeight())]).toEqual([243, 153]);
  });
});
