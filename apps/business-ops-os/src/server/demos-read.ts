/**
 * Demo reads (owner brief 21 Oct 2026 §4, §5): the list by view with sorting, the full record
 * (days and classes with Academic's marks for linked classes, change history, KYC, demo fee from
 * the ledger, teacher reviews from Academic OS and older Ops ones, checklist, follow-ups, activity).
 * Fee, bookable cases and the day's classes for Academic: demos-lookups.ts.
 * Permission: ops:leads:read (counsellors: own scope = demo or case counsellor, or lead owner).
 */
import { and, asc, desc, eq, getTableColumns, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { can } from '@elevate/authorization';
import {
  auditEvents,
  opsAdmissions,
  opsAppointments,
  opsChecklistEntries,
  opsDemos,
  opsDemoSessionChanges,
  opsDemoSessions,
  opsFollowUps,
  opsLeads,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import { istToday } from '../domain';
import {
  DEMO_VIEWS,
  demoAttendanceStatus,
  demoChecklist,
  demoDays,
  demoFollowUp,
  demoMockStatus,
  demoProgress,
  demoView,
  nextSession,
  sessionsInRange,
  setupGaps,
  type DemoView,
} from '../domain/demos';
import { lockAccessible, namesOf, ownAdmissionFilter } from './admissions';
import { accessScope, assertScope, notFound, type AccessScope, type Actor } from './context';
import type { DemoListQuery, DEMO_SORTS } from './demos-schemas';
import { demoKyc } from './demos-intake';
import { academicDemoMarks, withMarks, type AcademicDemoMarks } from './academic-summary';
import { demoFeedbackByDay } from './feedback';
import { groupBy, inOrder, rowById } from './ops-common';
import { demoFees } from './demos-lookups';
import { loadSettings } from './settings';

export * from './demos-lookups';

const PAGE_SIZE = 25;
type Demo = typeof opsDemos.$inferSelect;

/** The demo (locked) and its case, for a caller with ops:leads:write on it. */
export async function lockDemo(tx: Database, actor: Actor, id: string) {
  const demo = await rowById(tx, opsDemos, id, 'Demo', true);
  const access = await accessScope(tx, actor, 'ops:leads:write');
  return { demo, admission: await lockAccessible(tx, access, demo.admissionId) };
}

export function ownDemoFilter(access: AccessScope): SQL | undefined {
  const own = ownAdmissionFilter(access);
  if (access.scope === 'all' || !access.staffId) return own;
  return or(own, eq(opsDemos.counsellorStaffId, access.staffId));
}

const convertedAdmissions = alias(opsAdmissions, 'converted_admissions');
const demoRows = (db: Database, where: SQL | undefined) =>
  db
    .select({
      demo: { ...getTableColumns(opsDemos), isSample: opsLeads.isSample },
      studentName: opsLeads.studentName,
      leadCode: opsLeads.code,
      leadOwnerStaffId: opsLeads.ownerStaffId,
      interests: opsLeads.interestedProgrammeCodes,
      admissionCode: opsAdmissions.code,
      admissionStatus: opsAdmissions.status,
      studentId: opsAdmissions.studentId,
      admissionCounsellorId: opsAdmissions.counsellorStaffId,
      programmeCode: programmes.code,
      programmeName: programmes.name,
      counsellorName: staffMembers.fullName,
      convertedCode: convertedAdmissions.code,
    })
    .from(opsDemos)
    .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .leftJoin(programmes, eq(programmes.id, opsDemos.programmeId))
    .leftJoin(staffMembers, eq(staffMembers.id, opsDemos.counsellorStaffId))
    .leftJoin(convertedAdmissions, eq(convertedAdmissions.id, opsDemos.convertedAdmissionId))
    .where(where);
type DemoRow = Awaited<ReturnType<typeof demoRows>>[number];

/** Classes Academic is asked about: started ones only, inside a list's date window if any. */
const askable = (
  sessions: readonly { id: string; startsAt: Date }[],
  now: Date,
  window: { from?: string; to?: string } = {},
) =>
  sessions
    .filter(
      (s) =>
        s.startsAt <= now &&
        (!window.from || istToday(s.startsAt) >= window.from) &&
        (!window.to || istToday(s.startsAt) <= window.to),
    )
    .map((s) => s.id);

/**
 * Academic's marks for one demo's started classes. Call it BEFORE a transaction opens: no
 * network call happens inside one (pass the result to demoWithChecklist / syncDemo).
 */
export async function marksForDemo(db: Database, demoId: string, now = new Date()) {
  const sessions = await db
    .select({ id: opsDemoSessions.id, startsAt: opsDemoSessions.startsAt })
    .from(opsDemoSessions)
    .where(eq(opsDemoSessions.demoId, demoId as Demo['id']));
  return academicDemoMarks(db, askable(sessions, now));
}

/**
 * Sessions (with teacher names, and Academic's mark and actual teachers for a linked class — R15,
 * one batched Academic call about started classes; Academic stays the only writer of the mark),
 * checklist entries and the cases' follow-ups for these demos. Inside a transaction, pass `marks`.
 */
async function demoExtras(
  db: Database,
  demos: readonly Demo[],
  opts: { marks?: AcademicDemoMarks; window?: { from?: string; to?: string }; now?: Date } = {},
) {
  const ids = demos.map((d) => d.id);
  const [sessions, entries, followUps] = await inOrder([
    db
      .select({ ...getTableColumns(opsDemoSessions), teacherName: staffMembers.fullName })
      .from(opsDemoSessions)
      .leftJoin(staffMembers, eq(staffMembers.id, opsDemoSessions.teacherStaffId))
      .where(inArray(opsDemoSessions.demoId, ids))
      .orderBy(asc(opsDemoSessions.sessionNumber)),
    db
      .select()
      .from(opsChecklistEntries)
      .where(
        and(
          eq(opsChecklistEntries.subjectType, 'demo'),
          inArray(opsChecklistEntries.subjectId, ids),
        ),
      )
      .orderBy(asc(opsChecklistEntries.at)),
    db
      .select()
      .from(opsFollowUps)
      .where(inArray(opsFollowUps.admissionId, [...new Set(demos.map((d) => d.admissionId))]))
      .orderBy(asc(opsFollowUps.dueDate)),
  ]);
  const marks =
    opts.marks ??
    (await academicDemoMarks(db, askable(sessions, opts.now ?? new Date(), opts.window)));
  const marked = withMarks(sessions, marks).map((s) => ({
    ...s,
    teacherName: s.academic?.teacherNames.join(', ') || s.teacherName,
  }));
  return {
    marks,
    sessions: groupBy(marked, (s) => s.demoId),
    entries: groupBy(entries, (e) => e.subjectId),
    followUps: groupBy(followUps, (f) => f.admissionId),
  };
}

/** One demo (optionally locked FOR UPDATE) with its resolved checklist; NOT_FOUND "Demo not found.". */
export async function demoWithChecklist(
  db: Database,
  id: string,
  lock = false,
  /** Required inside a transaction (read with marksForDemo before it opens). */
  marks?: AcademicDemoMarks,
) {
  const demo = await rowById(db, opsDemos, id, 'Demo', lock);
  const { entries, sessions } = await demoExtras(db, [demo], { marks });
  return {
    demo,
    checklist: demoChecklist(entries.get(demo.id) ?? [], sessions.get(demo.id) ?? []),
  };
}

function summarise(
  row: DemoRow,
  extras: Awaited<ReturnType<typeof demoExtras>>,
  now: Date,
  window: number,
) {
  const { demo } = row;
  const sessions = extras.sessions.get(demo.id) ?? [];
  return {
    ...row,
    sessions,
    days: demoDays(sessions, demo.plannedDayCount),
    view: demoView({ outcome: demo.outcome, sessions }, now),
    progress: demoProgress(sessions, demo.plannedDayCount),
    /** All classes recorded ("completed"): the outcome is still open until someone closes it. */
    completed: demo.completedAt !== null,
    attendance: demoAttendanceStatus(demo.outcome, sessions),
    ...nextSession(sessions, now),
    mock: demoMockStatus(sessions),
    checklist: demoChecklist(extras.entries.get(demo.id) ?? [], sessions),
    followUp: demoFollowUp(extras.followUps.get(demo.admissionId) ?? [], now, window),
    gaps: setupGaps(demo, sessions),
    /** Whether Academic's marks were readable; when not, linked classes wait (R15). */
    academicMarks: { status: extras.marks.status, checkedAt: extras.marks.checkedAt },
  };
}
export type DemoSummary = ReturnType<typeof summarise>;

const firstClass = (r: DemoSummary) =>
  r.sessions.length ? Math.min(...r.sessions.map((s) => +s.startsAt)) : Infinity;
const VIEW_SORT: Record<DemoView, (a: DemoSummary, b: DemoSummary) => number> = {
  current: (a, b) =>
    (a.next?.startsAt.getTime() ?? Infinity) - (b.next?.startsAt.getTime() ?? Infinity),
  upcoming: (a, b) => firstClass(a) - firstClass(b),
  previous: (a, b) => (b.demo.outcomeAt?.getTime() ?? 0) - (a.demo.outcomeAt?.getTime() ?? 0),
};
const SORTS: Record<(typeof DEMO_SORTS)[number], (a: DemoSummary, b: DemoSummary) => number> = {
  name: (a, b) => a.studentName.localeCompare(b.studentName),
  first_class: (a, b) => firstClass(a) - firstClass(b),
  follow_up: (a, b) =>
    (a.followUp?.dueDate ?? '9999-12-31').localeCompare(b.followUp?.dueDate ?? '9999-12-31'),
  recent: (a, b) => +b.demo.createdAt - +a.demo.createdAt,
};
/** Follow-up urgency states behind the `followUp` filter and the "Follow-ups due" tile. */
const FOLLOW_UP_FILTER: Record<'due' | 'overdue', readonly string[]> = {
  due: ['overdue', 'due_today'],
  overdue: ['overdue'],
};
const followUpIs = (filter: 'due' | 'overdue') => (r: DemoSummary) =>
  r.followUp !== null && FOLLOW_UP_FILTER[filter].includes(r.followUp.state);
const countByView = (rows: readonly DemoSummary[]) =>
  Object.fromEntries(DEMO_VIEWS.map((v) => [v, rows.filter((r) => r.view === v).length])) as Record<
    DemoView,
    number
  >;

/**
 * Demo list for one view. Every count (tabs and KPI tiles) comes from the same
 * filtered set as the rows: KPIs ignore the view and follow-up filters, tab counts
 * ignore only the view. `sort` overrides the view's default order.
 */
export async function listDemos(
  db: Database,
  actor: Actor,
  query: DemoListQuery,
  now = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const like = query.q ? `%${query.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  const [base, settings] = await Promise.all([
    demoRows(
      db,
      and(
        ownDemoFilter(access),
        like
          ? or(
              ilike(opsLeads.studentName, like),
              ilike(opsAdmissions.code, like),
              ilike(opsLeads.code, like),
            )
          : undefined,
        query.programme ? eq(programmes.code, query.programme) : undefined,
        query.counsellor
          ? eq(opsDemos.counsellorStaffId, query.counsellor as StaffMemberId)
          : undefined,
        query.outcome ? eq(opsDemos.outcome, query.outcome) : undefined,
        query.stage ? eq(opsAdmissions.status, query.stage) : undefined,
      ),
    ),
    loadSettings(db),
  ]);
  const window = settings['followups.due_rules'].value.upcomingWindowDays;
  const extras = await demoExtras(
    db,
    base.map((r) => r.demo),
    { window: { from: query.from, to: query.to }, now },
  );
  const rows = base
    .map((r) => summarise(r, extras, now, window))
    .filter((r) => sessionsInRange(r.sessions, query.from, query.to));
  const month = istToday(now).slice(0, 7);
  const all = countByView(rows);
  const kpis = {
    current: all.current,
    upcoming: all.upcoming,
    followUpsDue: rows.filter(followUpIs('due')).length,
    /** Where the due follow-ups sit, so the tile can open a tab that shows them. */
    followUpsDueByView: countByView(rows.filter(followUpIs('due'))),
    conversions: rows.filter(
      (r) =>
        r.demo.outcome === 'converted' &&
        r.demo.outcomeAt &&
        istToday(r.demo.outcomeAt).startsWith(month),
    ).length,
    pendingDecision: rows.filter((r) => r.admissionStatus === 'admission_pending').length,
  };
  const filtered = query.followUp ? rows.filter(followUpIs(query.followUp)) : rows;
  const view = query.view ?? 'current';
  const counts = countByView(filtered);
  const inView = filtered
    .filter((r) => r.view === view)
    .sort(query.sort ? SORTS[query.sort] : VIEW_SORT[view]);
  const page = query.page ?? 1;
  return {
    view,
    counts,
    kpis,
    month,
    total: inView.length,
    page,
    pageSize: PAGE_SIZE,
    rows: inView.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

/** The full demo record: days and classes with change history, KYC, fees, reviews, checklist, follow-ups, activity. */
export async function getDemo(db: Database, actor: Actor, id: string, now = new Date()) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const [row] = await demoRows(db, eq(opsDemos.id, id as Demo['id']));
  if (!row) notFound('Demo');
  assertScope(
    access,
    [row.demo.counsellorStaffId, row.admissionCounsellorId, row.leadOwnerStaffId],
    'demos',
  );
  const [settings, extras, changes, counselling, activity, kyc, fees] = await Promise.all([
    loadSettings(db),
    demoExtras(db, [row.demo]),
    db
      .select(getTableColumns(opsDemoSessionChanges))
      .from(opsDemoSessionChanges)
      .innerJoin(opsDemoSessions, eq(opsDemoSessions.id, opsDemoSessionChanges.sessionId))
      .where(eq(opsDemoSessions.demoId, row.demo.id))
      .orderBy(desc(opsDemoSessionChanges.at)),
    db
      .select({ s: opsAppointments, counsellorName: staffMembers.fullName })
      .from(opsAppointments)
      .leftJoin(staffMembers, eq(staffMembers.id, opsAppointments.staffId))
      .where(eq(opsAppointments.admissionId, row.demo.admissionId))
      .orderBy(desc(opsAppointments.startsAt)),
    db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'demo'), eq(auditEvents.entityId, row.demo.id)))
      .orderBy(desc(auditEvents.at))
      .limit(50),
    demoKyc(db, actor, row.demo),
    can(actor, 'ops:fees:read') ? demoFees(db, row.demo.id) : null,
  ]);
  const entries = extras.entries.get(row.demo.id) ?? [];
  const sessions = extras.sessions.get(row.demo.id) ?? [];
  const teacherIds = changes
    .filter((c) => c.field === 'teacher')
    .flatMap((c) => [c.previousValue, c.newValue])
    // Substitute rows hold "Substitute" / "Planned teacher", not staff ids.
    .filter((v): v is string => Boolean(v && z.uuid().safeParse(v).success));
  const [teachers, names, feedback] = await Promise.all([
    db
      .select({ id: staffMembers.id, fullName: staffMembers.fullName })
      .from(staffMembers)
      .where(inArray(staffMembers.id, teacherIds as StaffMemberId[])),
    namesOf(db, [
      ...changes.map((c) => c.actorUserId),
      ...entries.map((e) => e.actorUserId),
      ...sessions.map((s) => s.recordedBy),
      ...activity.map((a) => a.actorUserId),
      ...(fees?.records ?? []).map((f) => f.recordedBy),
      row.demo.outcomeBy,
    ]),
    demoFeedbackByDay(db, actor, row.demo.id, extras.marks),
  ]);
  return {
    ...summarise(row, extras, now, settings['followups.due_rules'].value.upcomingWindowDays),
    changes,
    kyc,
    fees,
    /** Review state per day per teacher, Academic reviews and older Ops ones (server/feedback.ts). */
    feedback: feedback.days,
    reviews: feedback.reviews,
    legacyReviews: feedback.legacy,
    checklistHistory: [...entries].reverse(),
    followUps: extras.followUps.get(row.demo.admissionId) ?? [],
    counselling: counselling.map(({ s, counsellorName }) => ({ ...s, counsellorName })),
    activity,
    checklistRequired: settings['admissions.demo.checklist_required'],
    extension: settings['admissions.demo.extension'],
    demoCredit: settings['fees.demo_credit'],
    /** Display names for staff ids in teacher changes, and for user ids (actors). */
    teacherNames: Object.fromEntries(teachers.map((s) => [s.id as string, s.fullName])),
    names: Object.fromEntries(names),
  };
}
export type DemoRecord = Awaited<ReturnType<typeof getDemo>>;
