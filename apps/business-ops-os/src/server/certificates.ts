/**
 * Certificates (F4-02): issued from a student record by `ops:certificates:issue` holders once the
 * owner has approved the wording (setting `certificates.types`), numbered per type per financial
 * year from series `certificate.<type>/<year>` with no gaps, the wording kept exactly as printed.
 * Read = whoever may read the student (`ops:students:read`, own scope). From the second print the
 * PDF says "Duplicate"; a revoked certificate stays in the register with who, when and why.
 */
import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  OPS_CERTIFICATE_STATUSES,
  opsAdmissions,
  opsApplications,
  opsCertificates,
  opsLeads,
  programmes,
  students,
  users,
  type Database,
} from '@elevate/database';
import { toCsv, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { StudentIdentityId } from '@elevate/shared-types';
import { istToday } from '../domain';
import {
  CERTIFICATE_PLACEHOLDERS,
  documentNumber,
  fillWording,
  financialYearOf,
  type CertificateValues,
} from '../domain/documents';
import { fmtDate, fmtDateTime, humanise } from '../ui/format';
import { ownAdmissionFilter } from './admissions-lookups';
import { accessScope, scopeCovers, type AccessScope, type Actor } from './context';
import { takeNumber } from './document-numbers';
import { fieldError, opsAudit, rowById } from './ops-common';
import { certificatePdf } from './pdf/certificate';
import { loadSettings } from './settings';

const typeCode = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
export const issueCertificateBody = z.strictObject({ admissionId: z.uuid(), type: typeCode });
export const revokeCertificateBody = z.strictObject({ reason: z.string().trim().min(5).max(500) });
export const certificateListQuery = z.object({
  type: typeCode.optional().catch(undefined),
  status: z.enum(OPS_CERTIFICATE_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});
export type CertificateListQuery = z.output<typeof certificateListQuery>;
export const CERTIFICATE_PAGE_SIZE = 50;

const audit = opsAudit('certificate');
type CertificateRow = typeof opsCertificates.$inferSelect;

/** Own scope: students of the cases the reader counsels or whose lead they own. */
const inScope = (db: Database, access: AccessScope) =>
  access.scope === 'all'
    ? undefined
    : inArray(
        opsCertificates.studentId,
        db
          .select({ id: opsAdmissions.studentId })
          .from(opsAdmissions)
          .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
          .where(and(isNotNull(opsAdmissions.studentId), ownAdmissionFilter(access))),
      );

/** Issue a certificate of `type` on a student's case (student, programme and batch from that case). */
export async function issueCertificate(
  db: Database,
  actor: Actor,
  input: z.output<typeof issueCertificateBody>,
  requestId?: string,
  now = new Date(),
) {
  await accessScope(db, actor, 'ops:certificates:issue');
  return withTransaction(db, async (tx) => {
    const setting = (await loadSettings(tx))['certificates.types'];
    if (setting.decisionState !== 'approved')
      throw new ConflictError(
        'The certificate wording is not approved yet. The owner approves it in Settings (Certificate types and wording).',
      );
    const type = setting.value.types.find((t) => t.code === input.type);
    if (!type) throw fieldError('type', 'Choose a certificate type listed in Settings.');
    const [c] = await tx
      .select({
        a: opsAdmissions,
        student: students.fullName,
        isSample: students.isSample,
        programme: programmes.name,
        academicYear: opsApplications.academicYear,
        studentNumber: sql<
          string | null
        >`(select min(x.admission_number) from ${opsAdmissions} x where x.student_id = ${opsAdmissions.studentId})`,
      })
      .from(opsAdmissions)
      .innerJoin(students, eq(students.id, opsAdmissions.studentId))
      .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
      .leftJoin(opsApplications, eq(opsApplications.id, opsAdmissions.applicationId))
      .where(eq(opsAdmissions.id, input.admissionId as never));
    if (!c) throw fieldError('admissionId', 'That admission has no student record yet.');
    const issueDate = istToday(now);
    const values: Record<keyof CertificateValues, string | null> = {
      student: c.student,
      'admission number': c.a.admissionNumber ?? c.studentNumber,
      programme: c.programme,
      'academic year': c.academicYear,
      'issue date': fmtDate(issueDate),
      institute: 'Elevate Education',
    };
    const missing = CERTIFICATE_PLACEHOLDERS.filter(
      (p) => values[p] === null && type.template.includes(`{${p}}`),
    );
    if (missing.length)
      throw new ConflictError(
        `The wording needs what this student’s record does not have yet: ${missing.join(', ')}.`,
      );
    const year = financialYearOf(issueDate);
    const { n, sequence, mark } = await takeNumber(
      tx,
      `certificate.${type.code}/${year}`,
      c.isSample,
    );
    const [row] = await tx
      .insert(opsCertificates)
      .values({
        certificateType: type.code,
        certificateNumber:
          mark +
          documentNumber(
            [setting.value.numberPrefix, type.code.toUpperCase().replace(/_/g, '-'), year],
            n,
            4,
          ),
        financialYear: year,
        sequence,
        studentId: c.a.studentId!,
        programmeId: c.a.programmeId,
        batchId: c.a.enrolledBatchId,
        issueDate,
        body: fillWording(type.template, values as CertificateValues),
        issuedBy: actor.id,
        issuedAt: now,
      })
      .returning();
    await audit(tx, actor, row!.id, 'certificate.issued', { after: row }, requestId);
    return row!;
  });
}

export async function revokeCertificate(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof revokeCertificateBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:certificates:issue');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsCertificates, id, 'Certificate', true);
    if (before.status === 'revoked')
      throw new InvalidStateTransitionError('This certificate is already revoked.');
    const [after] = await tx
      .update(opsCertificates)
      .set({
        status: 'revoked',
        revokedBy: actor.id,
        revokedAt: new Date(),
        revokeReason: input.reason,
      })
      .where(eq(opsCertificates.id, before.id))
      .returning();
    await audit(tx, actor, id, 'certificate.revoked', { before, after }, requestId);
    return after!;
  });
}

const listSelect = {
  c: opsCertificates,
  student: students.fullName,
  isSample: students.isSample,
  programme: programmes.name,
  issuedByName: users.displayName,
  admissionId: sql<string>`(select x.id from ${opsAdmissions} x where x.student_id = ${opsCertificates.studentId} order by x.created_at limit 1)`,
};

/** The register, newest first, under the filters and the reader's scope (one student's, or one). */
export async function listCertificates(
  db: Database,
  actor: Actor,
  q: Partial<CertificateListQuery> & { studentId?: string; id?: string },
  limit = CERTIFICATE_PAGE_SIZE,
) {
  const access = await accessScope(db, actor, 'ops:students:read');
  const where = and(
    inScope(db, access),
    q.studentId ? eq(opsCertificates.studentId, q.studentId as StudentIdentityId) : undefined,
    q.id ? eq(opsCertificates.id, q.id) : undefined,
    q.type ? eq(opsCertificates.certificateType, q.type) : undefined,
    q.status ? eq(opsCertificates.status, q.status) : undefined,
  );
  const page = q.page ?? 1;
  const [rows, [total], settings] = await Promise.all([
    db
      .select(listSelect)
      .from(opsCertificates)
      .innerJoin(students, eq(students.id, opsCertificates.studentId))
      .leftJoin(programmes, eq(programmes.id, opsCertificates.programmeId))
      .leftJoin(users, eq(users.id, opsCertificates.issuedBy))
      .where(where)
      .orderBy(desc(opsCertificates.issuedAt), desc(opsCertificates.certificateNumber))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ n: count() }).from(opsCertificates).where(where),
    loadSettings(db),
  ]);
  const types = settings['certificates.types'];
  const label = new Map(types.value.types.map((t) => [t.code, t.label]));
  return {
    rows: rows.map((r) => ({
      ...r,
      typeLabel: label.get(r.c.certificateType) ?? humanise(r.c.certificateType),
    })),
    total: total?.n ?? 0,
    page,
    pageSize: limit,
    types: types.value.types.map((t) => ({ value: t.code, label: t.label })),
    wordingApproved: types.decisionState === 'approved',
  };
}
export type CertificateListItem = Awaited<ReturnType<typeof listCertificates>>['rows'][number];

/** The register as a spreadsheet (every matching row, at most 5,000); audited. */
export async function certificatesCsv(db: Database, actor: Actor, q: CertificateListQuery) {
  const list = await listCertificates(db, actor, { ...q, page: 1 }, 5000);
  if (list.total > 5000)
    throw new ConflictError(`This list has ${list.total} rows. Narrow the filters to download it.`);
  await audit(db, actor, null, 'certificates.exported', {
    metadata: { type: q.type ?? null, status: q.status ?? null, rows: list.rows.length },
  });
  return toCsv(
    [
      'Certificate no.',
      'Type',
      'Student',
      'Programme',
      'Issue date',
      'Issued by',
      'Status',
      'Revoked',
      'Reason',
      'Prints',
      'Sample data',
    ],
    list.rows.map((r) => [
      r.c.certificateNumber,
      r.typeLabel,
      r.student,
      r.programme ?? 'Not recorded',
      r.c.issueDate,
      r.issuedByName,
      humanise(r.c.status),
      r.c.revokedAt ? fmtDateTime(r.c.revokedAt) : '',
      r.c.revokeReason ?? '',
      r.c.printCount,
      r.isSample ? 'Sample data' : '',
    ]),
  );
}

/** The PDF for a reader of the student; this print is counted, so the second says "Duplicate". */
export async function certificatePdfFor(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:students:read');
  const cert: CertificateRow = await rowById(db, opsCertificates, id, 'Certificate');
  if (access.scope === 'own') {
    const owners = await db
      .select({ c: opsAdmissions.counsellorStaffId, o: opsLeads.ownerStaffId })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(eq(opsAdmissions.studentId, cert.studentId));
    if (
      !scopeCovers(
        access,
        owners.flatMap((r) => [r.c, r.o]),
      )
    )
      throw new ForbiddenError('You can only open certificates of students assigned to you.');
  }
  const [printed] = await db
    .update(opsCertificates)
    .set({ printCount: sql`${opsCertificates.printCount} + 1` })
    .where(eq(opsCertificates.id, cert.id))
    .returning();
  const [item] = (await listCertificates(db, actor, { id: cert.id })).rows;
  const pdf = await certificatePdf({ ...item!, c: printed! });
  return { bytes: pdf.bytes, filename: `certificate-${cert.certificateNumber}.pdf` };
}
