/**
 * Weekly schedule of counselling and demo classes. Counselling lives in
 * ./appointments.ts, demo booking and sessions in ./demos.ts.
 */
import { and, asc, eq, gte, lt, type SQL } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAppointments,
  opsDemos,
  opsDemoSessions,
  opsLeads,
  staffMembers,
  type Database,
} from '@elevate/database';
import { ValidationError } from '@elevate/shared-contracts';
import { addDays, istToday, istWeekContaining, type IsoDate } from '../domain';
import { accessScope, type Actor } from './context';

type DemoExtras = {
  leadCode: string;
  studentName: string;
  sessions: (typeof opsDemoSessions.$inferSelect & { teacherName: string | null })[];
};

/** Counselling and demos in a date range (default: this IST week). */
export async function listSchedule(
  db: Database,
  actor: Actor,
  range: { from?: string; to?: string } = {},
  now = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const week = istWeekContaining(istToday(now));
  const from = (range.from ?? week.from) as IsoDate;
  const to = (range.to ?? week.to) as IsoDate;
  if (from > to) throw new ValidationError('"from" must not be after "to".');
  const own = access.scope === 'own' ? access.staffId : undefined;
  if (own === null) return { from, to, counselling: [], demos: [] };
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${addDays(to, 1)}T00:00:00+05:30`);
  const cWhere: SQL[] = [gte(opsAppointments.startsAt, start), lt(opsAppointments.startsAt, end)];
  if (own) cWhere.push(eq(opsAppointments.staffId, own));
  const counselling = await db
    .select({
      s: opsAppointments,
      leadCode: opsLeads.code,
      studentName: opsLeads.studentName,
      counsellorName: staffMembers.fullName,
    })
    .from(opsAppointments)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAppointments.leadId))
    .innerJoin(staffMembers, eq(staffMembers.id, opsAppointments.staffId))
    .where(and(...cWhere))
    .orderBy(asc(opsAppointments.startsAt));
  const demoSessions = await db
    .select({
      d: opsDemos,
      leadCode: opsLeads.code,
      studentName: opsLeads.studentName,
      session: opsDemoSessions,
      teacherName: staffMembers.fullName,
    })
    .from(opsDemoSessions)
    .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .leftJoin(staffMembers, eq(staffMembers.id, opsDemoSessions.teacherStaffId))
    .where(
      and(
        gte(opsDemoSessions.startsAt, start),
        lt(opsDemoSessions.startsAt, end),
        own ? eq(opsAdmissions.counsellorStaffId, own) : undefined,
      ),
    )
    .orderBy(asc(opsDemoSessions.startsAt));
  const demos = new Map<string, (typeof demoSessions)[number]['d'] & DemoExtras>();
  for (const { d, session, teacherName, ...r } of demoSessions) {
    const demo = demos.get(d.id) ?? { ...d, ...r, sessions: [] };
    demo.sessions.push({ ...session, teacherName });
    demos.set(d.id, demo);
  }
  return {
    from,
    to,
    counselling: counselling.map(({ s, ...c }) => ({ ...s, ...c })),
    /** Demos with a class in the range, each with only its classes in the range. */
    demos: [...demos.values()],
  };
}
