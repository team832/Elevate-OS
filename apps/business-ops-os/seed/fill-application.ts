/**
 * Owner, 31 Oct 2026: "made up everything". A sample case's KYC, documents and application, taken as
 * far as its row in ./samples.ts says through the real services: form answers, ready, the printed
 * form, signatures. The one shortcut is the last step: the real confirmation asks the approver for a
 * password, so `confirmSample` (sample cases only) does what it does without that question. Dates go
 * back to the day the case was admitted, so the record reads as it happened.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  opsAdmissionApprovals,
  opsAdmissions,
  opsApplicationForms,
  opsApplications,
  opsGuardians,
  opsKycDocuments,
  opsLeads,
  opsSignatureConfirmations,
  type Database,
} from '@elevate/database';
import { knownPerson, samplePerson } from '@elevate/database/seed';
import { withTransaction } from '@elevate/server-kit';
import type { AdmissionId } from '@elevate/shared-types';
import { addDays, istInstant, type IsoDate } from '../src/domain/dates';
import {
  confirmationCheck,
  gapSettings,
  markReady,
  saveApplication,
} from '../src/server/applications';
import {
  confirmSignatures,
  generateForm,
  withdrawApplication,
} from '../src/server/applications-signing';
import { verifyLegacyAdmission } from '../src/server/applications-confirm';
import { assignAdmissionNumber } from '../src/server/conversion';
import { publishEnrolmentRequest } from '../src/server/enrolment';
import { recordKycDocument, verifyKycDocument } from '../src/server/kyc';
import { opsAudit, rowById } from '../src/server/ops-common';
import { applyTransition, lockAdmission } from '../src/server/pipeline';
import { loadSettings } from '../src/server/settings';
import { addGuardian } from '../src/server/students';
import type { seedActor } from './samples';

export type Seeded = NonNullable<Awaited<ReturnType<typeof seedActor>>>;
export type People = Record<'manager' | 'counsellor' | 'director' | 'finance', Seeded>;
type Actor = Seeded['actor'];

/** How far a converted case's application goes. `legacy`: admitted before this system, no form. */
export type CaseStage =
  | 'draft'
  | 'ready'
  | 'form'
  | 'signed'
  | 'withdrawn'
  | 'confirmed'
  | 'legacy'
  | 'legacy_verified';

/** A stable number per first name: one case always reads the same, cases differ from each other. */
export const nameNo = (first: string) => [...first].reduce((n, c) => n + c.charCodeAt(0), 0);
const of = <T>(list: readonly T[], first: string, shift = 0) =>
  list[(nameNo(first) + shift) % list.length]!;

/** What a lead holds about the person, and which parent is the other one. */
export function leadDetails(first: string, relationship: string | null) {
  const p = samplePerson(first);
  if (!p) return null;
  const [parent, other] = relationship === 'father' ? [p.father, p.mother] : [p.mother, p.father];
  return {
    person: p,
    parent,
    other,
    lead: {
      preferredName: first,
      studentPhone: p.phone,
      guardianPhone: parent.phone,
      city: p.city,
      schoolBoard: p.board,
      previousSchool: p.school,
      dateOfBirth: p.dateOfBirth,
      address: p.address,
      emergencyContactName: other.fullName,
      emergencyContactPhone: other.phone,
    },
  };
}

const PARENT_NOTES = [
  'Prefers a call after 6 pm on weekdays.',
  'Reads messages in the evening; call only if urgent.',
  'Works shifts, so mornings before 9 suit best.',
  'Comes to the centre on Saturdays and likes to talk in person.',
];
const OTHER_CONSENT = ['given', 'given', 'not_recorded', 'refused', 'withdrawn'] as const;

/** Both parents of a student, each once: the first is primary, the other the emergency contact. */
export async function addParents(
  db: Database,
  actor: Actor,
  studentId: string,
  first: string,
  relationship: string | null,
) {
  const d = leadDetails(first, relationship);
  if (!d) return;
  const live = await db
    .select({ email: opsGuardians.email })
    .from(opsGuardians)
    .where(eq(opsGuardians.studentId, studentId as never));
  const rows = [
    { who: d.parent, isEmergency: false, consentStatus: 'given', contact: 'call', shift: 0 },
    {
      who: d.other,
      isEmergency: true,
      consentStatus: of(OTHER_CONSENT, first),
      contact: of(['whatsapp', 'call', 'email'], first),
      shift: 1,
    },
  ];
  for (const r of rows) {
    if (live.some((x) => x.email === r.who.email)) continue;
    await addGuardian(db, actor, studentId, {
      fullName: r.who.fullName,
      relationship: r.who.relationship,
      email: r.who.email,
      phone: r.who.phone,
      address: d.person.address,
      isEmergency: r.isEmergency,
      preferredContact: r.contact,
      consentStatus: r.consentStatus,
      notes: of(PARENT_NOTES, first, r.shift),
    } as never);
  }
}

const FEMALE = new Set(
  'Tanisha Meera Riya Zoya Sana Diya Kavya Anaya Myra Ira Saanvi Harini Neha Tanya Ruhi Bhumi'.split(
    ' ',
  ),
);
const OCCUPATIONS = [
  'Runs a textile shop',
  'Government school teacher',
  'Chartered accountant',
  'Bank officer',
  'Grain trader',
  'Civil engineer',
  'Pharmacist',
  'Insurance adviser',
];
const OFFICES = [
  'Station Road, Sikar',
  'Collectorate Circle, Sikar',
  'Main Bazaar, Fatehpur',
  'Bus Stand Road, Laxmangarh',
];
const TIMINGS = ['Morning, 8 am to 11 am', 'Afternoon, 2 pm to 5 pm', 'Evening, 5 pm to 8 pm'];
const GRADES = ['72.4%', '81.2%', '88.6%', '76.0%', 'A2 grade', '91.4%', '68.8%'];
const STREAMS = [
  'Commerce with Mathematics',
  'Commerce with Informatics Practices',
  'Commerce with Economics',
];
const QUALIFICATION: Record<string, [string, string]> = {
  class_11: ['Class 10 passed', '2025'],
  class_12: ['Class 11 passed', '2026'],
  gap_year: ['Class 12 passed', '2026'],
};

/** The paper form's other answers. Only a few families have not agreed to result publicity. */
export function formAnswers(first: string, stage: string, relationship: string | null) {
  const p = knownPerson(first);
  const other = relationship === 'father' ? p.mother : p.father;
  const [qualification, yearOfPassing] = QUALIFICATION[stage] ?? QUALIFICATION.class_12!;
  return {
    gender: FEMALE.has(first) ? 'Female' : 'Male',
    whatsapp: p.phone,
    guardianOccupation: of(OCCUPATIONS, first),
    guardianOfficeAddress: of(OFFICES, first),
    guardianAlternateContact: other.phone,
    qualification,
    yearOfPassing,
    percentageOrGrade: of(GRADES, first),
    subjectsOrStream: of(STREAMS, first),
    batchTiming: of(TIMINGS, first),
  };
}

const last4 = (first: string, shift: number) =>
  String(1000 + ((nameNo(first) * 37 + shift * 211) % 8999));

/** Masked references as the Identity documents screen asks for them (D-043: never a full number). */
const MASK: Record<string, (digits: string) => string> = {
  aadhaar: (d) => `XXXX-XXXX-${d}`,
  pan: (d) => `XXXXX${d}X`,
  passport: (d) => `XXXX${d}`,
  school_id: (d) => `SCH-XX-${d}`,
  photograph: () => 'XX-PHOTO-ON-FILE',
  previous_marksheet: (d) => `MKS-XXXX-${d}`,
  address_proof: (d) => `XXXX-XXXX-${d}`,
  other: (d) => `MIG-XXXX-${d}`,
};
type DocCase = [type: keyof typeof MASK, outcome: 'verified' | 'unverified' | string];
const VERIFIED = 'verified';
const FULL_SET: DocCase[] = [
  ['aadhaar', VERIFIED],
  ['photograph', VERIFIED],
  ['previous_marksheet', VERIFIED],
  ['address_proof', VERIFIED],
  ['other', VERIFIED],
];
/** A case's documents: any other text as the outcome is the reason it was rejected. */
const DOCUMENTS: Record<string, DocCase[]> = {
  Diya: [
    ['aadhaar', VERIFIED],
    ['photograph', VERIFIED],
    ['previous_marksheet', VERIFIED],
    ['address_proof', 'The address on the copy cannot be read; a clearer copy was asked for.'],
    ['other', VERIFIED],
  ],
  Vihaan: [
    ['school_id', VERIFIED],
    ['photograph', VERIFIED],
    ['previous_marksheet', 'unverified'],
    ['address_proof', 'unverified'],
  ],
  Saanvi: [
    ['aadhaar', 'unverified'],
    ['photograph', 'unverified'],
  ],
  Mohit: [
    ['school_id', VERIFIED],
    ['photograph', 'unverified'],
    ['previous_marksheet', 'The marksheet copy is of Class 9, not Class 10.'],
  ],
  Neha: [
    ['passport', VERIFIED],
    ['photograph', VERIFIED],
    ['previous_marksheet', VERIFIED],
    ['address_proof', VERIFIED],
  ],
  Sana: [
    ['pan', VERIFIED],
    ['photograph', VERIFIED],
  ],
};
const VERIFY_NOTES = [
  'Checked against the original at the front desk.',
  'Original seen and returned to the parent.',
  'Copy matches the original; initialled by the counsellor.',
];

/**
 * Documents in every state through the real services: recorded by the counsellor, decided by the
 * operations manager. Arjun's Aadhaar is entered twice (the older row is kept as replaced), and
 * Zoya's mother gives her own ID (a guardian's document).
 */
export async function recordDocuments(
  db: Database,
  { manager, counsellor }: People,
  studentId: string,
  first: string,
  day: IsoDate,
) {
  const docs = DOCUMENTS[first] ?? FULL_SET;
  const record = (documentType: string, shift: number, guardianId: string | null = null) =>
    recordKycDocument(db, counsellor.actor, studentId, {
      subjectType: guardianId ? 'guardian' : 'student',
      guardianId,
      documentType,
      maskedReference: MASK[documentType]!(last4(first, shift)),
    } as never);
  const decide = (id: string, outcome: string, shift: number) =>
    outcome === 'unverified'
      ? null
      : verifyKycDocument(
          db,
          manager.actor,
          studentId,
          id,
          (outcome === VERIFIED
            ? { status: 'verified', note: VERIFY_NOTES[(nameNo(first) + shift) % 3] }
            : { status: 'rejected', note: outcome }) as never,
        );
  for (const [i, [type, outcome]] of docs.entries()) {
    if (first === 'Arjun' && type === 'aadhaar') {
      const old = await record(type, 9);
      await decide(old.id, 'The last four digits on the copy did not match the original.', i);
    }
    const row = await record(type, i);
    await decide(row.id, outcome, i);
  }
  if (first === 'Zoya') {
    const [mother] = await db
      .select({ id: opsGuardians.id })
      .from(opsGuardians)
      .where(and(eq(opsGuardians.studentId, studentId as never), eq(opsGuardians.isPrimary, true)));
    if (mother) await decide((await record('aadhaar', 7, mother.id)).id, VERIFIED, 7);
  }
  const at = istInstant(addDays(day, -1), '12:00');
  await db
    .update(opsKycDocuments)
    .set({
      createdAt: at,
      verifiedAt: sql`CASE WHEN ${opsKycDocuments.verifiedAt} IS NULL THEN NULL ELSE ${istInstant(day, '10:00').toISOString()}::timestamptz END`,
      supersededAt: sql`CASE WHEN ${opsKycDocuments.supersededAt} IS NULL THEN NULL ELSE ${istInstant(addDays(day, -1), '15:00').toISOString()}::timestamptz END`,
    })
    .where(eq(opsKycDocuments.studentId, studentId as never));
}

/**
 * The final confirmation of a sample case (applications-confirm.ts, step for step) without the
 * approver's password: the same check, the number from the real counter, the approval with the
 * accepted snapshot, every case of the bundle admitted, then handed to Academic.
 */
async function confirmSample(
  db: Database,
  approver: Actor,
  applicationId: string,
  day: IsoDate,
  requestEnrolment: boolean,
) {
  const settings = await loadSettings(db);
  const at = istInstant(day, '16:00');
  await withTransaction(db, async (tx) => {
    const app = await rowById(tx, opsApplications, applicationId, 'Application', true);
    const [row] = await tx
      .select({ a: opsAdmissions, isSample: opsLeads.isSample })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(eq(opsAdmissions.id, app.admissionId))
      .for('update');
    if (!row?.isSample) throw new Error('confirmSample is for sample cases only');
    const check = await confirmationCheck(tx, app, row.a, settings);
    if (check.gaps.length)
      throw new Error(
        `${app.reference} cannot be confirmed: ${check.gaps.map((g) => g.message).join('; ')}`,
      );
    const number = await assignAdmissionNumber(
      tx,
      approver,
      row.a,
      settings['admissions.number.format'].value,
    );
    await tx.insert(opsAdmissionApprovals).values({
      admissionId: row.a.id,
      applicationId: app.id,
      applicationVersion: app.currentVersion,
      approvedBy: approver.id,
      approvedAt: at,
      reauthMethod: 'password',
      reauthVerifiedAt: at,
      acceptedSnapshot: {
        application: check.saved,
        version: app.currentVersion,
        contentHash: check.current.contentHash,
        signature: check.signature,
        paymentGate: settings['admission.payment_gate'].value.rule,
        paid: check.paid,
        gapSettings: gapSettings(settings),
      } as never,
      admissionNumber: number,
    });
    const others = check.saved.programmes
      .map((p) => p.admissionId as AdmissionId)
      .filter((b) => b !== row.a.id);
    for (const id of [row.a.id, ...others]) {
      const admission =
        id === row.a.id ? { ...row.a, admissionNumber: number } : (await lockAdmission(tx, id))!;
      const admitted = await applyTransition(tx, {
        admission: { ...admission, admissionDate: day, admittedAt: at },
        to: 'admitted',
        actorUserId: approver.id,
        reason: `Admission confirmed (${app.reference} v${app.currentVersion}, number ${number})`,
        context: { readinessMissing: [] },
        patch: { admissionDate: day, admittedAt: at },
        settings,
      });
      if (requestEnrolment) await publishEnrolmentRequest(tx, approver, admitted, { settings });
    }
    await tx
      .update(opsApplications)
      .set({ status: 'admission_confirmed', updatedAt: at })
      .where(eq(opsApplications.id, app.id));
    await opsAudit('application')(tx, approver, app.id, 'admission.confirmed', {
      before: { status: app.status },
      after: { status: 'admission_confirmed', admissionNumber: number },
      metadata: { admissionId: row.a.id, applicationVersion: app.currentVersion },
    });
  });
}

/**
 * A record admitted before this system: a real number from the counter, no approval row,
 * `legacy_verification = 'required'` (the UI says "Legacy — verification required"), until an
 * approver checks the paper file (`legacy_verified`, through the real service).
 */
export async function admitLegacy(
  db: Database,
  people: People,
  admissionId: string,
  verified: boolean,
) {
  const settings = await loadSettings(db);
  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ a: opsAdmissions, isSample: opsLeads.isSample })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(eq(opsAdmissions.id, admissionId as never))
      .for('update');
    if (!row?.isSample) throw new Error('admitLegacy is for sample cases only');
    const actor = people.manager.actor;
    const number = await assignAdmissionNumber(
      tx,
      actor,
      row.a,
      settings['admissions.number.format'].value,
    );
    const admissionDate = row.a.intendedStartDate
      ? addDays(row.a.intendedStartDate as IsoDate, -1)
      : null;
    const admitted = await applyTransition(tx, {
      admission: { ...row.a, admissionNumber: number, admissionDate },
      to: 'admitted',
      actorUserId: actor.id,
      reason: 'Entered from the paper register: admitted before this system.',
      context: { readinessMissing: [] },
      patch: { legacyVerification: 'required', admissionDate },
      settings,
    });
    await publishEnrolmentRequest(tx, actor, admitted, { settings });
  });
  if (verified)
    await verifyLegacyAdmission(db, people.director.actor, admissionId, {
      note: 'Paper admission file checked: signed form, fee receipts and documents are all there.',
    });
}

export interface ApplicationWalk {
  first: string;
  classStage: string;
  /** The primary guardian: the other parent is the form's alternate contact. */
  relationship: string | null;
  stage: CaseStage;
  applicationId: string;
  academicYear: string;
  /** The day it was signed and confirmed. */
  day: IsoDate;
  requestEnrolment: boolean;
  /** A batch no longer in Academic: its enrolment request is refused there. */
  intendedBatchId?: string;
  withdrawReason?: string;
  /** A correction after signing: new version, signature invalidated, signed again. */
  correctAddress?: true;
}

const versionOf = async (db: Database, id: string) =>
  (await rowById(db, opsApplications, id as never, 'Application')).currentVersion;

export async function walkApplication(db: Database, people: People, w: ApplicationWalk) {
  const { manager, counsellor, director } = people;
  const id = w.applicationId;
  const refused = nameNo(w.first) % 5 === 0;
  await saveApplication(db, counsellor.actor, id, {
    version: await versionOf(db, id),
    academicYear: w.academicYear,
    form: formAnswers(w.first, w.classStage, w.relationship),
    resultPublicityConsent: !refused,
    ...(w.intendedBatchId ? { intendedBatchId: w.intendedBatchId } : {}),
  } as never);
  if (w.stage === 'withdrawn')
    return withdrawApplication(db, counsellor.actor, id, { reason: w.withdrawReason! });
  if (w.stage === 'draft') return;

  const printAndSign = async () => {
    const version = await versionOf(db, id);
    await markReady(db, counsellor.actor, id, { version });
    if (w.stage === 'ready') return false;
    await generateForm(db, manager.actor, id);
    await db
      .update(opsApplicationForms)
      .set({ generatedAt: istInstant(w.day, '11:00') })
      .where(eq(opsApplicationForms.applicationId, id as never));
    if (w.stage === 'form') return false;
    const [form] = await db
      .select({ id: opsApplicationForms.id })
      .from(opsApplicationForms)
      .where(
        and(
          eq(opsApplicationForms.applicationId, id as never),
          eq(opsApplicationForms.version, version),
        ),
      );
    await confirmSignatures(db, counsellor.actor, id, {
      version,
      formId: form!.id,
      signedOn: w.day,
      studentSigned: true,
      guardianSigned: true,
    });
    await db
      .update(opsSignatureConfirmations)
      .set({ confirmedAt: istInstant(w.day, '12:30') })
      .where(
        and(
          eq(opsSignatureConfirmations.applicationId, id as never),
          isNull(opsSignatureConfirmations.invalidatedAt),
        ),
      );
    return true;
  };

  if (!(await printAndSign())) return;
  if (w.correctAddress) {
    await saveApplication(db, counsellor.actor, id, {
      version: await versionOf(db, id),
      student: {
        address: knownPerson(w.first).address.replace(',', ', near the water tank,'),
      },
    } as never);
    await printAndSign();
  }
  if (w.stage === 'signed') return;
  await confirmSample(db, director.actor, id, w.day, w.requestEnrolment);
}
