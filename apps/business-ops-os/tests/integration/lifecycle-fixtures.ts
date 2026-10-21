/**
 * Admission cases written straight to the database (fictional, `Sample …`, @example.test), so
 * lifecycle and event tests do not depend on the conversion flow.
 */
import { eq } from 'drizzle-orm';
import { opsAdmissions, opsLeads, programmes, students, type Database } from '@elevate/database';
import type { AdmissionStatus } from '../../src/domain';
import { nextCode } from '../../src/server/context';

let n = 0;

/** One student identity (null = a case without one yet). */
export async function identity(db: Database, name: string) {
  const [s] = await db.insert(students).values({ fullName: name, isSample: true }).returning();
  return s!.id;
}

/** A case of `studentId` at `status`, on a new lead unless `leadId` is given. */
export async function caseOf(
  db: Database,
  createdBy: string,
  studentId: string | null,
  status: AdmissionStatus,
  options: {
    programme?: string;
    leadId?: string;
    heldFromStatus?: AdmissionStatus;
    counsellorStaffId?: string;
  } = {},
) {
  n += 1;
  const [programme] = await db
    .select({ id: programmes.id })
    .from(programmes)
    .where(eq(programmes.code, options.programme ?? 'CLAT'));
  const leadId =
    options.leadId ??
    (
      await db
        .insert(opsLeads)
        .values({
          code: await nextCode(db, 'lead', 'ops.leads'),
          studentName: `Sample Exit Student ${n}`,
          studentEmail: `sample-exit-${n}@example.test`,
          firstReceivedAt: new Date(),
          createdBy: createdBy as never,
        })
        .returning()
    )[0]!.id;
  const [a] = await db
    .insert(opsAdmissions)
    .values({
      code: await nextCode(db, 'admission', 'ops.admissions'),
      leadId: leadId as never,
      programmeId: programme!.id,
      studentId: studentId as never,
      status,
      heldFromStatus: options.heldFromStatus ?? null,
      counsellorStaffId: (options.counsellorStaffId ?? null) as never,
      admittedAt: new Date(),
      admissionNumber: String(n).padStart(3, '0'),
      enrolledBatchId: crypto.randomUUID() as never,
      ...(status === 'enrolled' || options.heldFromStatus === 'enrolled'
        ? {
            enrolmentId: crypto.randomUUID() as never,
            academicStudentId: crypto.randomUUID() as never,
          }
        : {}),
      createdBy: createdBy as never,
    })
    .returning();
  return a!;
}
