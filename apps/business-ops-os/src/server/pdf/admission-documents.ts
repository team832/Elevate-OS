/**
 * Admission documents (owner brief §6–§7) on the structure of the owner's paper "Student
 * Admission & Fee Record" (21 Oct 2026): the form of one application version, the
 * acknowledgement with the final admission number, and the ID card. Built on ./document.ts
 * (A4 / CR80, light paper). Nothing is invented: unknown answers print as blank lines to fill
 * by hand, no declaration text unless the owner approved it, no number before confirmation,
 * ledger figures only where recorded, no guardian IDs, no QR.
 */
import { INSTITUTE } from '@elevate/shared-ui';
import {
  declarationSections,
  DOCUMENT_STATE_LABELS,
  EMPTY_FORM_FIELDS,
  type documentChecklist,
  type feeSummary,
  type TrackerRow,
} from '../../domain/admission-form';
import { DELIVERY_MODE_LABELS, type ApplicationSnapshot } from '../../domain/applications';
import { CLASS_CATEGORY_LABELS } from '../../domain/demos';
import { formatPaise } from '../../domain/fees';
import { createPdf, type PdfBuilder } from './document';

export const FORM_TEMPLATE_VERSION = 'admission-form/2';
const ACK_TEMPLATE_VERSION = 'admission-acknowledgement/2';
const CARD_TEMPLATE_VERSION = 'id-card/1';
const BLANK = '____________________';
/** A value, or a blank line to fill in by hand (never "0"). */
const fill = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? BLANK : String(v);
const money = (p: number | null) => (p === null ? BLANK : formatPaise(p));
/** Narrow table cells get a shorter line to fill. */
const cell = (v: string | null) => v ?? '________';
const cellMoney = (p: number | null) => (p === null ? '________' : formatPaise(p));
const label = (map: Record<string, string>, v: string | null) => (v ? (map[v] ?? v) : null);
const RELATIONSHIP: Record<string, string> = {
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  other: 'Other',
};
// No box glyph in the print font; no-break spaces keep an empty box from wrapping or collapsing to "[]".
const box = (on: boolean) => (on ? '[x]' : '[\u00a0\u00a0]');
const SIGNERS = [
  { label: 'Student signature' },
  { label: 'Parent / guardian signature' },
  { label: 'Authorized signature & seal' },
];
/** IST calendar date as on paper, e.g. 04 May 2010 (null stays null). */
const day = (d: string | null | undefined) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

export interface AdmissionRecord {
  reference: string;
  version: number;
  generatedAt: Date;
  snapshot: ApplicationSnapshot;
  documents: ReturnType<typeof documentChecklist>;
  summary: ReturnType<typeof feeSummary>;
  tracker: TrackerRow[];
  /** Fee verifiers (BR-OPS-7 checks), by name. */
  checkedBy: string[];
  /** Null before final confirmation. */
  admission: { number: string; date: string; approvedBy: string | null } | null;
}

function institute(pdf: PdfBuilder) {
  pdf.paragraph(
    `${INSTITUTE.address} · ${INSTITUTE.phone.replace('+91 ', '')} · ${INSTITUTE.email} · GSTIN ${INSTITUTE.gstin}`,
    { muted: true },
  );
}

function declarations(s: ApplicationSnapshot) {
  const sections = s.declarations ? declarationSections(s.declarations.text) : [];
  const find = (re: RegExp) => sections.find((x) => x.title && re.test(x.title));
  const terms = find(/^terms/i);
  const fee = find(/^fee/i);
  return { terms, fee, declaration: sections.find((x) => x !== terms && x !== fee) };
}

/** Only when no approved declaration exists at all (approval is the setting's state, not parsing). */
const notApproved = (pdf: PdfBuilder) =>
  pdf.banner(
    'Declaration text not configured or not approved — owner to supply. Nothing is printed here, and this admission cannot be confirmed until approved text is set.',
  );

function feeTables(pdf: PdfBuilder, r: AdmissionRecord) {
  pdf.heading('07  Fee summary');
  pdf.keyValues([
    ['Registration / admission fee', money(r.summary.registrationPaise)],
    ['Course fee (annual tuition)', money(r.summary.coursePaise)],
    ['Discount / scholarship', money(r.summary.discountPaise)],
    ['Net fee payable', money(r.summary.netPaise)],
  ]);
  pdf.heading('08  Instalment & payment tracker');
  pdf.table(
    [
      { header: 'Payment', width: 0.16 },
      { header: 'Due date', width: 0.13 },
      { header: 'Due amount', width: 0.15, align: 'right' },
      { header: 'Received', width: 0.15, align: 'right' },
      { header: 'Date of receipt', width: 0.14 },
      { header: 'Mode', width: 0.12 },
      { header: 'Balance', width: 0.15, align: 'right' },
    ],
    r.tracker.map((t) => [
      t.label,
      cell(day(t.dueDate)),
      cellMoney(t.duePaise),
      cellMoney(t.receivedPaise),
      cell(day(t.lastReceiptDate)),
      cell(t.mode),
      cellMoney(t.balancePaise),
    ]),
  );
  pdf.paragraph(
    'Amounts are recorded by staff (manual entries, not a payment gateway). A blank means nothing is recorded yet.',
    { muted: true },
  );
}

function verification(pdf: PdfBuilder, r: AdmissionRecord) {
  pdf.heading('10  Accounts / office verification');
  pdf.keyValues([
    ['Admission approved by', fill(r.admission?.approvedBy)],
    ['Checked by', fill(r.checkedBy.join(', '))],
    ['Date', fill(day(r.admission?.date))],
    ['Remarks', BLANK],
    ['Authorized signature & seal', BLANK],
  ]);
}

/** The printable form of one application version: 3 pages like the owner's paper form. */
export async function admissionFormPdf(
  r: AdmissionRecord,
  /** Test hook: every text line drawn. */
  inspect?: (lines: readonly string[]) => void,
) {
  const s = r.snapshot;
  const st = s.student;
  const f = { ...EMPTY_FORM_FIELDS, ...s.form }; // versions saved before the paper form have none
  const pdf = await createPdf({
    title: 'Student Admission & Fee Record',
    reference: `${r.reference} · version ${r.version}`,
    templateVersion: `Template ${FORM_TEMPLATE_VERSION}`,
    generatedAt: r.generatedAt,
    size: 'a4-dense',
  });
  institute(pdf);
  if (!r.admission)
    pdf.banner('Application — admission pending. This is not an admission until it is confirmed.');
  const pending = 'On confirmation';
  pdf.table(
    [
      { header: 'Application no.', width: 0.25 },
      { header: 'Admission date', width: 0.25 },
      { header: 'Admission no.', width: 0.25 },
      { header: 'Course start', width: 0.25 },
    ],
    [
      [
        r.reference,
        day(r.admission?.date) ?? pending,
        r.admission?.number ?? pending,
        fill(day(s.startDate)),
      ],
    ],
  );

  // Short blank lines inside the two-per-line grid (a long one would wrap).
  const v = (x: string | null | undefined) => (x ? x : '________');
  pdf.heading('01  Student profile');
  pdf.keyValuePairs(
    [
      ['Student name', st.fullName, 'Date of birth', v(day(st.dateOfBirth))],
      ['Gender', v(f.gender), 'Mobile', v(st.phone)],
      ['WhatsApp', v(f.whatsapp), 'Email', v(st.email)],
      ['Address', v([st.address, st.city].filter(Boolean).join(', '))],
    ],
    { photo: true },
  );

  pdf.heading('02  Parent / guardian');
  const g = s.guardians.find((x) => x.isPrimary) ?? s.guardians[0];
  pdf.keyValuePairs([
    [
      'Parent / guardian',
      v(g?.fullName),
      'Relationship',
      v(label(RELATIONSHIP, g?.relationship ?? null)),
    ],
    ['Mobile no.', v(g?.phone), 'Alternate contact', v(f.guardianAlternateContact)],
    ['Occupation', v(f.guardianOccupation), 'Office address', v(f.guardianOfficeAddress)],
  ]);
  const others = s.guardians.filter((x) => x !== g);
  if (others.length)
    pdf.table(
      [
        { header: 'Other guardian', width: 0.4 },
        { header: 'Relationship', width: 0.2 },
        { header: 'Mobile', width: 0.2 },
        { header: 'Email', width: 0.2 },
      ],
      others.map((o) => [o.fullName, label(RELATIONSHIP, o.relationship), o.phone, o.email]),
    );

  pdf.heading('03  Academic details');
  pdf.keyValuePairs([
    ['School / college', v(st.previousSchool), 'Board / university', v(st.schoolBoard)],
    [
      'Class / qualification',
      v(f.qualification ?? label(CLASS_CATEGORY_LABELS, st.currentStage)),
      'Year of passing',
      v(f.yearOfPassing),
    ],
    ['Percentage / grade', v(f.percentageOrGrade), 'Subjects / stream', v(f.subjectsOrStream)],
  ]);

  pdf.heading('04  Course & batch');
  pdf.keyValuePairs([
    [
      'Course name',
      v(s.programmes.map((p) => p.name).join(' + ')),
      'Course code',
      v(s.programmes.map((p) => p.code).join(' + ')),
    ],
    [
      'Batch',
      s.intendedBatchId ? 'Assigned by Academic OS' : 'To be assigned',
      'Mode',
      `${box(s.deliveryMode === 'offline')} Offline    ${box(s.deliveryMode === 'online')} Online`,
    ],
    ['Start date', v(day(s.startDate)), 'Timing', v(f.batchTiming)],
    ['Counsellor', v(s.counsellorName)],
  ]);

  pdf.heading('05  Document check');
  // One line like the paper: a tick for verified, the state only when something is recorded.
  pdf.paragraph(
    r.documents
      .map(
        (d) =>
          `${box(d.state === 'verified')} ${d.label}${d.state === 'not_recorded' ? '' : ` (${DOCUMENT_STATE_LABELS[d.state].toLowerCase()})`}`,
      )
      .join('    '),
  );

  const decl = declarations(s);
  pdf.heading('06  Student / parent declaration');
  if (!s.declarations) notApproved(pdf);
  else for (const line of decl.declaration?.lines ?? []) pdf.paragraph(`${box(false)} ${line}`);
  pdf.signatures(SIGNERS);

  pdf.pageBreak(); // the fee sheet is signed and re-printed on its own, as on paper
  feeTables(pdf, r);
  pdf.heading('09  Fee acknowledgement');
  if (!s.declarations) notApproved(pdf);
  else if (decl.fee) for (const line of decl.fee.lines) pdf.paragraph(`${box(false)} ${line}`);
  else pdf.paragraph('Covered by the approved declaration on page 1.', { muted: true });
  pdf.signatures(SIGNERS);
  verification(pdf, r);

  pdf.pageBreak(); // terms and conditions: their own signed sheet
  const [termsTitle, termsScope] = (decl.terms?.title ?? 'Terms & Conditions').split(' — ');
  pdf.heading(termsTitle!);
  if (termsScope || s.declarations)
    pdf.paragraph(
      [
        termsScope?.replace(/^./, (c) => c.toUpperCase()),
        s.declarations && `declaration version ${s.declarations.version}`,
      ]
        .filter(Boolean)
        .join(' · '),
      { muted: true },
    );
  if (!s.declarations) notApproved(pdf);
  else if (decl.terms) for (const line of decl.terms.lines) pdf.paragraph(line);
  else pdf.paragraph('Covered by the approved declaration on page 1.', { muted: true });
  const consent = f.resultPublicityConsent;
  pdf.keyValues([
    [
      'Result publicity consent',
      consent?.given
        ? `Consent given (recorded ${day(consent.recordedAt.slice(0, 10))})`
        : `${box(false)} Consent given    ${box(true)} Not given`,
    ],
  ]);
  pdf.signatures(SIGNERS);
  inspect?.(pdf.lines);
  return pdf.finish();
}

export interface AcknowledgementInput {
  record: AdmissionRecord & { admission: NonNullable<AdmissionRecord['admission']> };
  approvedAt: Date;
  signedOn: string | null;
  signers: string[];
  academicSetup: string;
  showFees: boolean;
}

/** Admission acknowledgement: final number, the accepted version, fees and the office block; no contacts. */
export async function acknowledgementPdf(a: AcknowledgementInput) {
  const r = a.record;
  const pdf = await createPdf({
    title: 'Admission acknowledgement',
    reference: `Admission no. ${r.admission.number}`,
    templateVersion: `Template ${ACK_TEMPLATE_VERSION}`,
  });
  institute(pdf);
  pdf.banner(`Admission confirmed — admission number ${r.admission.number}`, 'success');
  pdf.keyValues([
    ['Student', r.snapshot.student.fullName],
    ['Admission number', r.admission.number],
    ['Application reference', `${r.reference} (version ${r.version})`],
    [
      'Confirmed on',
      `${a.approvedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`,
    ],
    ['Confirmed by', r.admission.approvedBy],
    ['Form signed on', day(a.signedOn)],
    ['Signed by', a.signers.join(', ')],
    ['Academic setup', a.academicSetup],
    ['Course', r.snapshot.programmes.map((p) => `${p.name} (${p.code})`).join(' + ')],
    ['Academic year', r.snapshot.academicYear],
    ['Mode', label(DELIVERY_MODE_LABELS, r.snapshot.deliveryMode)],
    ['Start date', day(r.snapshot.startDate)],
  ]);
  pdf.paragraph(
    'This acknowledgement reflects the signed application version kept on record. Fee amounts are the agreement and staff-recorded entries, not gateway payments.',
    { muted: true },
  );
  if (a.showFees) feeTables(pdf, r);
  verification(pdf, r);
  return pdf.finish();
}

/** CR80 ID card: name, admission number, programme, academic year. No guardian data, no QR. */
export async function idCardPdf(c: {
  fullName: string;
  admissionNumber: string;
  programmes: string;
  academicYear: string | null;
}) {
  const pdf = await createPdf({
    title: 'Student ID card',
    reference: c.admissionNumber,
    templateVersion: CARD_TEMPLATE_VERSION,
    size: 'card',
  });
  pdf.logo(10, 143, 14);
  pdf.space(22);
  pdf.keyValues([
    ['Name', c.fullName],
    ['Admission no.', c.admissionNumber],
    ['Programme', c.programmes],
    ['Academic year', c.academicYear ?? 'Not set'],
  ]);
  return pdf.finish();
}
