/**
 * Teaching assignments of REAL staff from the owner brief of 23 Oct 2026 (§4; OA-3, R9, R10).
 * Not sample data: no tasks, attendance, logs, reviews or feedback are seeded for these people.
 * Staff come from the Ops seed `ops.teachers`, found by name. Pending = recorded without a batch:
 * it opens no batch or student until a coordinator sets one. Inserts only when the teacher has no
 * row for that subject and none was withdrawn, so a coordinator's edit, end or withdrawal stays.
 * Not recorded on purpose: Satish for CLAT (unconfirmed), Soma Tiwari for Economics (programme
 * not named yet, OA-2). Nikunj Bindal: the running CA Foundation course; level and batch are for
 * the owner to configure.
 */
import { and, eq, sql } from 'drizzle-orm';
import { academicBatches, academicCourses, academicSubjects, academicTeacherAssignments, auditEvents, staffMembers } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import { recordAudit } from '@elevate/server-kit';

export const OWNER_ASSIGNMENT_SOURCE = 'owner brief 23 Oct 2026';

export const OWNER_ASSIGNMENTS: readonly { staff: string; course: string; subject: string; batch?: string; academicYear?: string; startDate?: string }[] = [
  { staff: 'Satish Raghuvanshi', course: 'IPMAT-C12-2027', subject: 'QUANT', batch: 'IPMAT-C12-APR27', academicYear: '2027-28', startDate: '2026-10-23' },
  { staff: 'Satish Raghuvanshi', course: 'COM-C11-2627', subject: 'MATH', academicYear: '2026-27' },
  { staff: 'Satish Raghuvanshi', course: 'COM-C12-2627', subject: 'MATH', academicYear: '2026-27' },
  { staff: 'Nikunj Bindal', course: 'CAF-ACC-SEP27', subject: 'ACC' },
  { staff: 'Soma', course: 'CLAT-SYL-2027', subject: 'CA' },
];

export const ownerAssignmentsSeed = defineSeed({
  name: 'academic.owner-assignments',
  module: 'academic',
  dependsOn: ['academic.batches', 'academic.syllabus-drafts', 'academic.ca-foundation', 'ops.teachers'],
  description: `Real staff teaching assignments (${OWNER_ASSIGNMENT_SOURCE}): Satish IPMAT Quant active on IPMAT-C12-APR27; Class 11/12 Maths, CA Accounting, CLAT Current Affairs pending (no batch)`,
  async run({ db, log }) {
    const t = academicTeacherAssignments;
    for (const a of OWNER_ASSIGNMENTS) {
      const [staff] = await db.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.fullName, a.staff));
      if (!staff) {
        log(`  skipped ${a.staff} ${a.course}/${a.subject}: no staff record with that name (run ops.teachers)`);
        continue;
      }
      const [subject] = await db
        .select({ id: academicSubjects.id, courseId: academicSubjects.courseId })
        .from(academicSubjects)
        .innerJoin(academicCourses, eq(academicCourses.id, academicSubjects.courseId))
        .where(and(eq(academicCourses.code, a.course), eq(academicSubjects.code, a.subject)));
      if (!subject) throw new Error(`Subject ${a.course}/${a.subject} missing — run the curriculum seeds first.`);
      const [existing] = await db.select({ id: t.id }).from(t).where(and(eq(t.staffMemberId, staff.id), eq(t.subjectId, subject.id)));
      const [withdrawn] = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(and(eq(auditEvents.action, 'assignment.withdrawn'), sql`${auditEvents.before}->>'staffMemberId' = ${staff.id}`, sql`${auditEvents.before}->>'subjectId' = ${subject.id}`))
        .limit(1);
      if (existing || withdrawn) continue;
      const [batch] = a.batch ? await db.select({ id: academicBatches.id }).from(academicBatches).where(eq(academicBatches.code, a.batch)) : [];
      if (a.batch && !batch) throw new Error(`Batch ${a.batch} missing — run academic.batches first.`);
      const [row] = await db
        .insert(t)
        .values({ staffMemberId: staff.id, subjectId: subject.id, courseId: subject.courseId, batchId: batch?.id ?? null, status: batch ? 'active' : 'pending', role: 'primary', academicYear: a.academicYear ?? null, startDate: a.startDate ?? null })
        .returning();
      // The table has no source column: the audit row carries where this assignment came from.
      await recordAudit(db, { actorType: 'system', actorUserId: null, module: 'academic', action: 'assignment.seeded', entityType: 'teacher_assignment', entityId: row!.id, after: row, metadata: { source: OWNER_ASSIGNMENT_SOURCE } });
    }
  },
});
