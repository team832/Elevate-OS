/**
 * Appointment reads (OPS-008): the list (own scope = organised by or involving the caller),
 * "My meetings" (D-073), one appointment with participants, messages and changes, and pickers.
 */
import { and, asc, count, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  opsAppointmentChanges,
  opsAppointmentParticipants,
  opsAppointments as appointments,
  opsEventMessages,
  opsLeads,
  staffMembers,
  students,
  users,
  type Database,
} from '@elevate/database';
import { scopeFor } from '@elevate/authorization';
import type { StaffMemberId, StudentIdentityId } from '@elevate/shared-types';
import { addDays } from '../domain';
import type { AppointmentFilters } from './appointments-schemas';
import {
  accessScope,
  assertScope,
  notFound,
  staffIdForUser,
  type AccessScope,
  type Actor,
} from './context';
import { fieldError } from './ops-common';
import { involving } from './appointments-slots';

type Row = typeof appointments.$inferSelect;

const listColumns = {
  a: appointments,
  staffName: staffMembers.fullName,
  studentName: students.fullName,
  studentSample: students.isSample,
  leadName: opsLeads.studentName,
  // Events: people listed (staff and removed excluded, as on the event page) and the latest message.
  participantCount: sql<number>`(SELECT count(*)::int FROM ${opsAppointmentParticipants} WHERE ${opsAppointmentParticipants.appointmentId} = ${appointments.id} AND ${opsAppointmentParticipants.kind} <> 'staff' AND ${opsAppointmentParticipants.removedAt} IS NULL)`,
  latestMessageStatus: sql<
    (typeof opsEventMessages.$inferSelect)['status'] | null
  >`(SELECT ${opsEventMessages.status} FROM ${opsEventMessages} WHERE ${opsEventMessages.appointmentId} = ${appointments.id} ORDER BY ${opsEventMessages.createdAt} DESC, ${opsEventMessages.id} DESC LIMIT 1)`,
};

const baseSelect = (db: Database) =>
  db
    .select(listColumns)
    .from(appointments)
    .innerJoin(staffMembers, eq(staffMembers.id, appointments.staffId))
    .leftJoin(students, eq(students.id, appointments.studentId))
    .leftJoin(opsLeads, eq(opsLeads.id, appointments.leadId));

const flatten = ({
  a,
  ...r
}: Awaited<ReturnType<ReturnType<typeof baseSelect>['execute']>>[number]) => ({
  ...a,
  ...r,
  personName: a.title ?? r.studentName ?? r.leadName ?? 'Unknown student',
});
export type AppointmentListRow = ReturnType<typeof flatten>;

function ownFilter(db: Database, access: AccessScope): SQL | undefined {
  if (access.scope === 'all') return undefined;
  if (!access.staffId) return sql`false`;
  return or(eq(appointments.organiserStaffId, access.staffId), involving(db, [access.staffId]));
}

/** Appointments whose student or lead name contains `q` (subqueries, so the count query needs no joins). */
function nameMatches(db: Database, q: string) {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return or(
    inArray(
      appointments.studentId,
      db
        .select({ id: students.id })
        .from(students)
        .where(sql`${students.fullName} ILIKE ${like}`),
    ),
    inArray(
      appointments.leadId,
      db
        .select({ id: opsLeads.id })
        .from(opsLeads)
        .where(sql`${opsLeads.studentName} ILIKE ${like}`),
    ),
  );
}

export async function listAppointments(
  db: Database,
  actor: Actor,
  filters: Partial<AppointmentFilters> = {},
  pageSize = 25,
) {
  const access = await accessScope(db, actor, 'ops:appointments:read');
  const where = and(
    ownFilter(db, access),
    filters.type ? eq(appointments.type, filters.type) : undefined,
    filters.status ? eq(appointments.status, filters.status) : undefined,
    filters.staffId ? involving(db, [filters.staffId as StaffMemberId]) : undefined,
    filters.studentId
      ? eq(appointments.studentId, filters.studentId as StudentIdentityId)
      : undefined,
    filters.q ? nameMatches(db, filters.q) : undefined,
    filters.from
      ? gte(appointments.startsAt, new Date(`${filters.from}T00:00:00+05:30`))
      : undefined,
    filters.to
      ? lt(appointments.startsAt, new Date(`${addDays(filters.to, 1)}T00:00:00+05:30`))
      : undefined,
  );
  if (filters.from && filters.to && filters.from > filters.to)
    throw fieldError('to', '"To" must not be before "from".');
  const page = filters.page ?? 1;
  const [rows, [total]] = await Promise.all([
    baseSelect(db)
      .where(where)
      .orderBy(asc(appointments.startsAt), asc(appointments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(appointments).where(where),
  ]);
  return { rows: rows.map(flatten), total: total?.n ?? 0, page, pageSize };
}

/**
 * "My meetings" (D-073): appointments and events the caller takes part in (assigned or as a
 * participant), whatever their scope; null when their login has no staff record.
 */
export async function listMyMeetings(
  db: Database,
  actor: Actor,
  filters: Partial<Pick<AppointmentFilters, 'from' | 'to' | 'page'>>,
  pageSize = 25,
) {
  const staffId = await staffIdForUser(db, actor.id);
  return staffId ? listAppointments(db, actor, { ...filters, staffId }, pageSize) : null;
}

export async function getAppointment(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:appointments:read');
  const [found] = await baseSelect(db).where(eq(appointments.id, id as Row['id']));
  if (!found) notFound('Appointment');
  const row = flatten(found);
  const [participants, messages] = await Promise.all([
    db
      .select({
        p: opsAppointmentParticipants,
        staffName: staffMembers.fullName,
        studentName: students.fullName,
      })
      .from(opsAppointmentParticipants)
      .leftJoin(staffMembers, eq(staffMembers.id, opsAppointmentParticipants.staffId))
      .leftJoin(students, eq(students.id, opsAppointmentParticipants.studentId))
      .where(eq(opsAppointmentParticipants.appointmentId, row.id))
      .orderBy(asc(opsAppointmentParticipants.addedAt)),
    db
      .select()
      .from(opsEventMessages)
      .where(eq(opsEventMessages.appointmentId, row.id))
      .orderBy(asc(opsEventMessages.createdAt)),
  ]);
  assertScope(
    access,
    [row.staffId, row.organiserStaffId, ...participants.map((p) => p.p.staffId)],
    'appointments',
  );
  const changes = await db
    .select({ c: opsAppointmentChanges, actorName: users.displayName })
    .from(opsAppointmentChanges)
    .leftJoin(users, eq(users.id, opsAppointmentChanges.actorUserId))
    .where(eq(opsAppointmentChanges.appointmentId, row.id))
    .orderBy(asc(opsAppointmentChanges.at));
  // Names only, never a contact; a guardian's name needs ops:student_private:read.
  // All-scope only: an own-scope holder may see private data of their own students, not of a cohort.
  const privateData = scopeFor(actor, 'ops:student_private:read') === 'all';
  return {
    ...row,
    participants: participants.map(({ p, staffName, studentName }) => ({
      ...p,
      name:
        p.kind === 'guardian' && !privateData
          ? 'Guardian (restricted)'
          : (p.nameSnapshot ?? staffName ?? studentName ?? 'Not recorded'),
      nameSnapshot: p.kind === 'guardian' && !privateData ? null : p.nameSnapshot,
    })),
    messages,
    changes: changes.map(({ c, actorName }) => ({ ...c, actorName })),
  };
}

/** Student options for the schedule form (canonical identities; names only, no contacts). */
export async function studentPickerOptions(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:appointments:manage');
  const rows = await db
    .select({ id: students.id, fullName: students.fullName, isSample: students.isSample })
    .from(students)
    .orderBy(asc(students.fullName))
    .limit(500);
  return rows.map((s) => ({
    value: s.id,
    label: s.isSample ? `${s.fullName} — sample` : s.fullName,
  }));
}
