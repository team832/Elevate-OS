/**
 * The two feedback directions (owner brief 20 Oct 2026 §8H, §12; 21 Oct §3, §5), in two tables:
 * - teacher → student (the single review store): written by the teacher or a feedback manager;
 *   it references a demo class (`demo_session`), an Academic enrolment (`enrolment`) or neither.
 *   A demo-class review is always by that class's teacher (substitutes included); own-scope
 *   teachers write only about students they taught. Visibility is `internal` by default; raw
 *   reviews are for authorised staff only and never reach guardian/student reports. Final rows
 *   are versioned, never overwritten; draft edits are audited (before/after, actor, time).
 * - student/guardian → teacher: recorded by staff on their behalf, moderated; no route
 *   edits it and the teacher it is about can neither edit nor moderate it.
 */
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissions,
  opsAppointments as appointments,
  opsDemos,
  opsDemoSessions,
  opsLeads,
  opsStudentTeacherFeedback as aboutTeachers,
  type OpsDemoSessionId,
  opsTeacherStudentFeedback as aboutStudents,
  staffMembers,
  students,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { EnrolmentId, StaffMemberId, StudentIdentityId } from '@elevate/shared-types';
import type { z } from 'zod';
import { canModerate, demoReviewGrid, teacherFeedbackEdit } from '../domain/feedback';
import type { moderationBody, studentTeacherFeedbackBody } from './appointments-schemas';
import { fetchAcademicStudentSummary, staffNames } from './academic-summary';
import type { teacherFeedbackBody, teacherFeedbackUpdateBody } from './report-schemas';
import { involving } from './appointments';
import {
  accessScope,
  activeStaff,
  scopeCovers,
  staffIdForUser,
  type AccessScope,
  type Actor,
} from './context';
import { opsAudit, rowById } from './ops-common';

const auditAboutStudent = opsAudit('teacher_student_feedback');
const auditAboutTeacher = opsAudit('student_teacher_feedback');

/** Has the teacher met this student (an appointment they run or join, or a demo class they teach)? */
async function teaches(db: Database, teacherId: StaffMemberId, studentId: StudentIdentityId) {
  const [row] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(eq(appointments.studentId, studentId), involving(db, [teacherId])))
    .limit(1);
  if (row) return true;
  const [demo] = await db
    .select({ id: opsDemoSessions.id })
    .from(opsDemoSessions)
    .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .where(
      and(eq(opsDemoSessions.teacherStaffId, teacherId), eq(opsAdmissions.studentId, studentId)),
    )
    .limit(1);
  return Boolean(demo);
}

/** Write access: managers write for anyone; others as themselves (own: taught students only). */
async function writer(db: Database, actor: Actor) {
  const manage = can(actor, 'ops:feedback:manage');
  const access: AccessScope = manage
    ? { scope: 'all' }
    : await accessScope(db, actor, 'ops:feedback:write');
  return { manage, access, me: await staffIdForUser(db, actor.id) };
}

const reviewTargetError = (path: string, message: string) =>
  new ValidationError(message, { details: [{ location: 'body', path: [path], message }] });

/**
 * The review must point at this student's own demo class or enrolment. A demo-class review is
 * by that class's teacher; own-scope teachers need evidence they taught the student: the class,
 * Academic's teachers of the enrolment (fail closed when Academic cannot be read), or for a
 * general review an appointment or demo class.
 */
async function assertReviewTarget(
  db: Database,
  input: z.output<typeof teacherFeedbackBody>,
  studentId: StudentIdentityId,
  teacherId: StaffMemberId,
  own: boolean,
) {
  if (input.scope === 'demo_session') {
    const [session] = await db
      .select({ teacher: opsDemoSessions.teacherStaffId, studentId: opsAdmissions.studentId })
      .from(opsDemoSessions)
      .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
      .where(eq(opsDemoSessions.id, input.demoSessionId as OpsDemoSessionId));
    if (!session || session.studentId !== studentId)
      throw reviewTargetError('demoSessionId', 'That demo class is not one of this student’s.');
    if (session.teacher !== teacherId)
      throw new ForbiddenError(
        'A demo-class review is written by the teacher who took that class.',
      );
    return;
  }
  if (input.scope === 'enrolment') {
    const [admission] = await db
      .select({ academicStudentId: opsAdmissions.academicStudentId })
      .from(opsAdmissions)
      .where(
        and(
          eq(opsAdmissions.studentId, studentId),
          eq(opsAdmissions.enrolmentId, input.enrolmentId as EnrolmentId),
        ),
      );
    if (!admission?.academicStudentId)
      throw reviewTargetError('enrolmentId', 'That enrolment is not one of this student’s.');
    if (!own) return;
    const r = await fetchAcademicStudentSummary(admission.academicStudentId);
    const taught =
      r.status === 'available' &&
      r.data.enrolments.some(
        (e) =>
          e.enrolmentId === input.enrolmentId && e.teachers.some((t) => t.staffId === teacherId),
      );
    if (!taught)
      throw new ForbiddenError(
        r.status === 'available'
          ? 'Academic OS does not list you as a teacher of this enrolment.'
          : `Academic OS could not confirm that you teach this enrolment (${r.reason}). Try again later.`,
      );
    return;
  }
  if (own && !(await teaches(db, teacherId, studentId)))
    throw new ForbiddenError('You can only write feedback about students you teach or have met.');
}

/**
 * Review state per demo day per teacher (F-DEMO screen): pending / draft / submitted / not due,
 * from the classes actually taught. States and teacher names need the demo (ops:leads:read; own =
 * demo/case counsellor or lead owner) or feedback access (own = a teacher of one of its classes);
 * review ids only for readers of that teacher's feedback (own = their own).
 */
export async function demoFeedbackByDay(db: Database, actor: Actor, demoId: string) {
  const [feedback, leads] = await Promise.all(
    (['ops:feedback:read', 'ops:leads:read'] as const).map((p) =>
      can(actor, p) ? accessScope(db, actor, p) : null,
    ),
  );
  if (!feedback && !leads) await accessScope(db, actor, 'ops:leads:read');
  const demo = await rowById(db, opsDemos, demoId, 'Demo');
  const sessions = await db
    .select()
    .from(opsDemoSessions)
    .where(eq(opsDemoSessions.demoId, demo.id))
    .orderBy(asc(opsDemoSessions.dayNumber), asc(opsDemoSessions.sessionNumber));
  const teachesHere =
    feedback &&
    scopeCovers(
      feedback,
      sessions.map((s) => s.teacherStaffId),
    );
  if (!teachesHere && !(leads && scopeCovers(leads, await demoOwners(db, demo)))) {
    throw new ForbiddenError('You can only see reviews for demos you run or teach.');
  }
  const reviews = sessions.length
    ? await db
        .select()
        .from(aboutStudents)
        .where(
          inArray(
            aboutStudents.demoSessionId,
            sessions.map((s) => s.id),
          ),
        )
    : [];
  const superseded = new Set(reviews.map((r) => r.supersedesId).filter(Boolean));
  const grid = demoReviewGrid(
    sessions,
    reviews.map((r) => ({ ...r, superseded: superseded.has(r.id) })),
  );
  const names = await staffNames(
    db,
    grid.flatMap((d) => d.teachers.map((t) => t.staffId)),
  );
  const mayRead = (staffId: string) => Boolean(feedback && scopeCovers(feedback, [staffId]));
  return grid.map((d) => ({
    ...d,
    teachers: d.teachers.map(({ reviewIds, ...t }) => ({
      ...t,
      teacherName: names.get(t.staffId) ?? 'Unknown teacher',
      reviewIds: mayRead(t.staffId) ? reviewIds : [],
    })),
  }));
}

async function demoOwners(db: Database, demo: typeof opsDemos.$inferSelect) {
  const [row] = await db
    .select({ caseCounsellor: opsAdmissions.counsellorStaffId, leadOwner: opsLeads.ownerStaffId })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(eq(opsAdmissions.id, demo.admissionId));
  return [demo.counsellorStaffId, row?.caseCounsellor, row?.leadOwner];
}

/** Demo classes a teacher took where the student attended and no review exists yet (pending). */
export async function demoReviewsDue(db: Database, actor: Actor, teacherStaffId: string) {
  const access = await accessScope(db, actor, 'ops:feedback:read');
  if (access.scope === 'own' && access.staffId !== teacherStaffId) return [];
  const rows = await db
    .select({
      sessionId: opsDemoSessions.id,
      dayNumber: opsDemoSessions.dayNumber,
      startsAt: opsDemoSessions.startsAt,
      subject: opsDemoSessions.subject,
      studentId: students.id,
      studentName: students.fullName,
      isSample: students.isSample,
      reviewId: aboutStudents.id,
    })
    .from(opsDemoSessions)
    .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .innerJoin(students, eq(students.id, opsAdmissions.studentId))
    .leftJoin(
      aboutStudents,
      and(
        eq(aboutStudents.demoSessionId, opsDemoSessions.id),
        eq(aboutStudents.teacherStaffId, teacherStaffId as StaffMemberId),
      ),
    )
    .where(
      and(
        eq(opsDemoSessions.teacherStaffId, teacherStaffId as StaffMemberId),
        inArray(opsDemoSessions.attendance, ['present', 'late']),
      ),
    )
    .orderBy(asc(opsDemoSessions.startsAt));
  return rows.filter((r) => !r.reviewId);
}

const teacherColumns = { teacherName: staffMembers.fullName };

export async function listStudentFeedback(db: Database, actor: Actor, studentId: string) {
  const access = await accessScope(db, actor, 'ops:feedback:read');
  if (access.scope === 'own' && !access.staffId) return [];
  const rows = await db
    .select({ f: aboutStudents, ...teacherColumns })
    .from(aboutStudents)
    .innerJoin(staffMembers, eq(staffMembers.id, aboutStudents.teacherStaffId))
    .where(
      and(
        eq(aboutStudents.studentId, studentId as StudentIdentityId),
        access.scope === 'own' ? eq(aboutStudents.teacherStaffId, access.staffId!) : undefined,
      ),
    )
    .orderBy(desc(aboutStudents.observedOn), desc(aboutStudents.version));
  const superseded = new Set(rows.map((r) => r.f.supersedesId).filter(Boolean));
  return rows.map(({ f, teacherName }) => ({
    ...f,
    teacherName,
    superseded: superseded.has(f.id),
  }));
}

export async function createTeacherFeedback(
  db: Database,
  actor: Actor,
  input: z.output<typeof teacherFeedbackBody>,
  requestId?: string,
) {
  const { manage, access, me } = await writer(db, actor);
  if (input.teacherStaffId && input.teacherStaffId !== me && !manage)
    throw new ForbiddenError('You can only write feedback as yourself.');
  const teacherId = (manage ? (input.teacherStaffId ?? me) : me) as StaffMemberId | null;
  if (!teacherId)
    throw new ValidationError('Choose the teacher.', {
      details: [{ location: 'body', path: ['teacherStaffId'], message: 'Required' }],
    });
  await activeStaff(db, teacherId, 'teacherStaffId');
  const student = await rowById(db, students, input.studentId, 'Student');
  await assertReviewTarget(db, input, student.id, teacherId, access.scope === 'own');
  return withTransaction(db, async (tx) => {
    const { teacherStaffId: _t, ...fields } = input;
    const [row] = await tx
      .insert(aboutStudents)
      .values({
        ...fields,
        demoSessionId: (fields.demoSessionId ?? null) as OpsDemoSessionId | null,
        enrolmentId: (fields.enrolmentId ?? null) as EnrolmentId | null,
        studentId: student.id,
        teacherStaffId: teacherId,
        createdBy: actor.id,
      })
      .returning();
    await auditAboutStudent(
      tx,
      actor,
      row?.id,
      'feedback.teacher_student.created',
      { after: row },
      requestId,
    );
    return row;
  });
}

export async function updateTeacherFeedback(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof teacherFeedbackUpdateBody>,
  requestId?: string,
) {
  const { manage, me } = await writer(db, actor);
  return withTransaction(db, async (tx) => {
    const row = await rowById(tx, aboutStudents, id, 'Feedback', true);
    const [next] = await tx
      .select({ id: aboutStudents.id })
      .from(aboutStudents)
      .where(eq(aboutStudents.supersedesId, row.id));
    const edit = teacherFeedbackEdit(
      { ...row, superseded: Boolean(next) },
      { staffId: me, canManage: manage },
    );
    if (!edit.ok)
      throw edit.reason === 'not_author'
        ? new ForbiddenError('Only the teacher who wrote this feedback can change it.')
        : new InvalidStateTransitionError('A newer version exists; edit the latest version.');
    const [after] =
      edit.mode === 'in_place'
        ? await tx.update(aboutStudents).set(input).where(eq(aboutStudents.id, row.id)).returning()
        : await tx
            .insert(aboutStudents)
            .values({
              ...input,
              visibility: input.visibility ?? row.visibility,
              teacherStaffId: row.teacherStaffId,
              studentId: row.studentId,
              scope: row.scope,
              demoSessionId: row.demoSessionId,
              enrolmentId: row.enrolmentId,
              version: row.version + 1,
              supersedesId: row.id,
              createdBy: actor.id,
            })
            .returning();
    await auditAboutStudent(
      tx,
      actor,
      after?.id,
      edit.mode === 'in_place'
        ? 'feedback.teacher_student.updated'
        : 'feedback.teacher_student.versioned',
      { before: row, after },
      requestId,
    );
    return after;
  });
}

export async function listFeedbackByTeacher(db: Database, actor: Actor, teacherStaffId: string) {
  const access = await accessScope(db, actor, 'ops:feedback:read');
  if (access.scope === 'own' && access.staffId !== teacherStaffId) return [];
  const rows = await db
    .select({ f: aboutStudents, studentName: students.fullName, studentSample: students.isSample })
    .from(aboutStudents)
    .innerJoin(students, eq(students.id, aboutStudents.studentId))
    .where(eq(aboutStudents.teacherStaffId, teacherStaffId as StaffMemberId))
    .orderBy(desc(aboutStudents.observedOn));
  const superseded = new Set(rows.map((r) => r.f.supersedesId).filter(Boolean));
  return rows.filter((r) => !superseded.has(r.f.id)).map(({ f, ...s }) => ({ ...f, ...s }));
}

export async function recordStudentTeacherFeedback(
  db: Database,
  actor: Actor,
  input: z.output<typeof studentTeacherFeedbackBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:feedback:record');
  const teacher = await rowById(db, staffMembers, input.teacherStaffId, 'Teacher');
  if (input.studentId) await rowById(db, students, input.studentId, 'Student');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(aboutTeachers)
      .values({
        ...input,
        teacherStaffId: teacher.id,
        studentId: (input.studentId ?? null) as StudentIdentityId | null,
        recordedBy: actor.id,
      })
      .returning();
    await auditAboutTeacher(
      tx,
      actor,
      row?.id,
      'feedback.student_teacher.recorded',
      { after: row },
      requestId,
    );
    return row;
  });
}

export async function moderateStudentTeacherFeedback(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof moderationBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:feedback:moderate');
  const me = await staffIdForUser(db, actor.id);
  return withTransaction(db, async (tx) => {
    const row = await rowById(tx, aboutTeachers, id, 'Feedback', true);
    const check = canModerate(
      row.moderationStatus,
      input.action,
      { staffId: me },
      row.teacherStaffId,
    );
    if (!check.ok)
      throw check.reason === 'own_feedback'
        ? new ForbiddenError('Feedback about you must be moderated by someone else.')
        : new InvalidStateTransitionError(
            `Feedback that is ${row.moderationStatus} cannot be changed that way.`,
          );
    const [after] = await tx
      .update(aboutTeachers)
      .set({
        moderationStatus: check.to,
        moderationNote: input.note ?? row.moderationNote,
        visibility: input.visibility ?? row.visibility,
        moderatedBy: actor.id,
        moderatedAt: new Date(),
      })
      .where(eq(aboutTeachers.id, row.id))
      .returning();
    await auditAboutTeacher(
      tx,
      actor,
      row.id,
      `feedback.student_teacher.${input.action}`,
      { before: row, after },
      requestId,
    );
    return after;
  });
}

/**
 * Feedback about a teacher. Moderators see everything; the teacher (own scope) sees only
 * approved rows shared with them; other readers see approved rows. The summary averages
 * only rated, approved rows and states the denominator.
 */
export async function listFeedbackAboutTeacher(db: Database, actor: Actor, teacherStaffId: string) {
  const access = await accessScope(db, actor, 'ops:feedback:read');
  const moderator = can(actor, 'ops:feedback:moderate');
  if (access.scope === 'own' && access.staffId !== teacherStaffId)
    return { rows: [], summary: { approved: 0, rated: 0, averageRating: null } };
  const rows = await db
    .select()
    .from(aboutTeachers)
    .where(
      and(
        eq(aboutTeachers.teacherStaffId, teacherStaffId as StaffMemberId),
        moderator ? undefined : eq(aboutTeachers.moderationStatus, 'approved'),
        access.scope === 'own' ? eq(aboutTeachers.visibility, 'teacher_and_staff') : undefined,
      ),
    )
    .orderBy(asc(aboutTeachers.moderationStatus), desc(aboutTeachers.feedbackOn));
  const approved = rows.filter((r) => r.moderationStatus === 'approved');
  const rated = approved.filter((r) => r.rating !== null);
  return {
    rows,
    summary: {
      approved: approved.length,
      rated: rated.length,
      averageRating: rated.length
        ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length
        : null,
    },
  };
}

/** What a review can reference for this student: their demo classes and Academic enrolments. */
export async function reviewTargets(db: Database, studentId: StudentIdentityId) {
  const [sessions, enrolments] = await Promise.all([
    db
      .select({
        id: opsDemoSessions.id,
        dayNumber: opsDemoSessions.dayNumber,
        startsAt: opsDemoSessions.startsAt,
        subject: opsDemoSessions.subject,
        teacherName: staffMembers.fullName,
      })
      .from(opsDemoSessions)
      .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
      .leftJoin(staffMembers, eq(staffMembers.id, opsDemoSessions.teacherStaffId))
      .where(eq(opsAdmissions.studentId, studentId))
      .orderBy(asc(opsDemoSessions.startsAt)),
    db
      .select({ id: opsAdmissions.enrolmentId, code: opsAdmissions.code })
      .from(opsAdmissions)
      .where(and(eq(opsAdmissions.studentId, studentId), isNotNull(opsAdmissions.enrolmentId))),
  ]);
  return { sessions, enrolments: enrolments.map((e) => ({ id: e.id!, code: e.code })) };
}
