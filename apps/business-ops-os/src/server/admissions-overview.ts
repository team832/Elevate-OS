/**
 * Admissions overview (owner brief 21 Oct 2026 §4): one read for the KPI screen. Loads plain rows
 * in one Promise.all and hands them to the pure functions in domain/admissions-kpis.ts. Demo
 * counts that the demo list also shows come from `listDemos` itself, so a tile and its list agree.
 * Permission `ops:admissions:read` (own scope = the counsellor's cases); fee figures only with
 * `ops:fees:read`. Missing is never zero.
 */
import { and, eq, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissionApprovals,
  opsAdmissions,
  opsApplications,
  opsDemos,
  opsDemoSessions,
  opsFeePlans,
  opsFeeRecords,
  opsLeads,
  opsMaterialIssues,
  opsOnboardingItemEvents,
  opsOnboardingItems,
  opsOnboardingTemplates,
  programmes,
  students,
  type Database,
} from '@elevate/database';
import { addDays, istToday, type IsoDate, type KpiWindow } from '../domain';
import {
  admissionsConfirmed,
  applicationsAwaiting,
  AWAITING_STATUSES,
  demoDayProgress,
  demoToAdmissionConversion,
  feeCollections,
  overdueOnboarding,
  tuitionOutstanding,
} from '../domain/admissions-kpis';
import type { FeeRecordLike } from '../domain/fees';
import { itemStatus, netIssued, type OnboardingTemplateItem } from '../domain/onboarding';
import { studentPopulation } from '../domain/student-lifecycle';
import { ownAdmissionFilter } from './admissions';
import { classesWithMarks, marksReader, type MarksReader } from './academic-summary';
import { approvalChecks } from './applications';
import { accessScope, type Actor } from './context';
import { listDemos } from './demos';
import { inForceOf, plansWithLedger } from './fee-agreements';
import { groupBy } from './ops-common';
import { loadSettings } from './settings';

export interface OverviewOptions {
  from?: string;
  to?: string;
  /** Programme code; demos by the demo's programme, everything else by the case's. */
  programme?: string;
  now?: Date;
  /** Shared when other blocks of the same screen count demo classes too. */
  marks?: MarksReader;
}

export async function buildAdmissionsOverview(
  db: Database,
  actor: Actor,
  options: OverviewOptions = {},
) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const now = options.now ?? new Date();
  const today = istToday(now);
  const window: KpiWindow = {
    from: (options.from ?? addDays(today, -29)) as IsoDate,
    to: (options.to ?? today) as IsoDate,
  };
  const fees = can(actor, 'ops:fees:read');
  const read = options.marks ?? marksReader(db);
  const own = ownAdmissionFilter(access);
  const scoped = db
    .select({ id: opsAdmissions.id })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(own);
  /** The caller's cases (own scope) and the programme filter (each query joins `programmes`). */
  const where = (caseId: SQLWrapper, ...more: SQLWrapper[]) =>
    and(
      own ? inArray(caseId as never, scoped) : undefined,
      options.programme ? eq(programmes.code, options.programme) : undefined,
      ...(more as never[]),
    );

  const [settings, demoList, sessions, applications, approvals, items, feeRecords, feePlans] =
    await Promise.all([
      loadSettings(db),
      can(actor, 'ops:leads:read')
        ? listDemos(db, actor, { programme: options.programme }, now, read)
        : null,
      db
        .select({
          id: opsDemoSessions.id,
          academicSessionRef: opsDemoSessions.academicSessionRef,
          demoId: opsDemos.id,
          plannedDayCount: opsDemos.plannedDayCount,
          dayNumber: opsDemoSessions.dayNumber,
          attendance: opsDemoSessions.attendance,
          startsAt: opsDemoSessions.startsAt,
          confirmedAt: opsAdmissionApprovals.approvedAt,
        })
        .from(opsDemoSessions)
        .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
        .leftJoin(programmes, eq(programmes.id, opsDemos.programmeId))
        .leftJoin(
          opsAdmissionApprovals,
          eq(
            opsAdmissionApprovals.admissionId,
            sql`coalesce(${opsDemos.convertedAdmissionId}, ${opsDemos.admissionId})`,
          ),
        )
        .where(where(opsDemos.admissionId)),
      db
        .select({ app: opsApplications, admission: opsAdmissions })
        .from(opsApplications)
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsApplications.admissionId))
        .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
        .where(
          where(opsApplications.admissionId, inArray(opsApplications.status, AWAITING_STATUSES)),
        ),
      db
        .select({
          approvedAt: opsAdmissionApprovals.approvedAt,
          admissionNumber: opsAdmissionApprovals.admissionNumber,
          studentId: opsAdmissions.studentId,
          studentName: students.fullName,
          isSample: students.isSample,
          programme: programmes.name,
        })
        .from(opsAdmissionApprovals)
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsAdmissionApprovals.admissionId))
        .leftJoin(students, eq(students.id, opsAdmissions.studentId))
        .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
        .where(where(opsAdmissions.id)),
      db
        .select({
          id: opsOnboardingItems.id,
          admissionId: opsOnboardingItems.admissionId,
          itemKey: opsOnboardingItems.itemKey,
          label: opsOnboardingItems.label,
          kind: opsOnboardingItems.kind,
          dueDate: opsOnboardingItems.dueDate,
          templateItems: opsOnboardingTemplates.items,
          status: opsAdmissions.status,
          heldFromStatus: opsAdmissions.heldFromStatus,
          admittedAt: opsAdmissions.admittedAt,
          studentId: opsAdmissions.studentId,
          studentName: students.fullName,
          isSample: students.isSample,
        })
        .from(opsOnboardingItems)
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsOnboardingItems.admissionId))
        .leftJoin(students, eq(students.id, opsAdmissions.studentId))
        .leftJoin(
          opsOnboardingTemplates,
          eq(opsOnboardingTemplates.id, opsOnboardingItems.templateId),
        )
        .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
        .where(where(opsAdmissions.id)),
      fees
        ? db
            .select({ r: opsFeeRecords, isSample: opsLeads.isSample })
            .from(opsFeeRecords)
            .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
            .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
            .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
            .where(where(opsAdmissions.id))
        : null,
      fees
        ? db
            .select({ p: opsFeePlans, isSample: opsLeads.isSample })
            .from(opsFeePlans)
            .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
            .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
            .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
            .where(where(opsAdmissions.id))
        : null,
    ]);

  // Demo rows: one per demo with its classes, counted as the demo list counts them.
  const { classes } = await classesWithMarks(db, sessions, { now, window, read });
  const demoRows = [...groupBy(classes, (s) => s.demoId).values()].map((rows) => ({
    ...rows[0]!,
    sessions: rows,
  }));
  const conversionDays = settings['kpi.conversion'].value.windowDays;

  // Applications at "signatures confirmed": what the confirmation gap check still finds (oldest
  // first, at most APPROVAL_CHECK_LIMIT). Onboarding: status events and material moves of the
  // current students' items, in the same round trip.
  const current = items.filter((i) => studentPopulation(i) !== 'former');
  const itemIds = current.map((i) => i.id);
  const [checks, events, moves] = await Promise.all([
    approvalChecks(db, applications, settings),
    itemIds.length
      ? db
          .select({
            itemId: opsOnboardingItemEvents.itemId,
            status: opsOnboardingItemEvents.status,
            at: opsOnboardingItemEvents.at,
          })
          .from(opsOnboardingItemEvents)
          .where(inArray(opsOnboardingItemEvents.itemId, itemIds))
      : [],
    itemIds.length
      ? db
          .select({
            itemId: opsMaterialIssues.itemId,
            kind: opsMaterialIssues.kind,
            quantity: opsMaterialIssues.quantity,
          })
          .from(opsMaterialIssues)
          .where(inArray(opsMaterialIssues.itemId, itemIds))
      : [],
  ]);
  const eventsOf = groupBy(events, (e) => e.itemId);
  const movesOf = groupBy(moves, (m) => m.itemId);
  const checklist = current.map((i) => {
    const required =
      (i.templateItems as OnboardingTemplateItem[] | null)?.find((t) => t.key === i.itemKey)
        ?.requiredQuantity ?? 1;
    const net = netIssued(movesOf.get(i.id) ?? []);
    return { ...i, status: itemStatus(i.kind, eventsOf.get(i.id) ?? [], net, required) };
  });

  // The whole version chain, wherever it lives: the case filter chooses agreements, never receipts.
  const standing = feePlans
    ? await plansWithLedger(
        db,
        await inForceOf(
          db,
          feePlans.map(({ p }) => p),
        ),
        now,
      )
    : [];
  const sample = new Set(feePlans?.filter((x) => x.isSample).map((x) => x.p.id as string));
  const confirmed = admissionsConfirmed(approvals, window);
  const onboarding = overdueOnboarding(checklist, now);
  return {
    window,
    scope: access.scope,
    demos: {
      /** From the demo list (null without ops:leads:read). */
      list: demoList?.kpis ?? null,
      days: demoDayProgress(demoRows, window),
    },
    conversion: {
      ...demoToAdmissionConversion(demoRows, window, conversionDays, now),
      windowDays: conversionDays,
      setting: settings['kpi.conversion'],
    },
    applications: {
      awaiting: applicationsAwaiting(
        applications.map((a) => a.app),
        now,
      ),
      approvalChecked: checks.length,
      approvalBlocked: checks.filter((c) => c.gaps.length > 0).length,
    },
    confirmed: {
      metric: confirmed.metric,
      rows: confirmed.rows.sort((a, b) => +b.approvedAt - +a.approvedAt),
    },
    onboarding: {
      ...onboarding,
      rows: onboarding.rows.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
      /** Current students' checklist items done (completed or not applicable) of all, right now. */
      completion: {
        done: checklist.filter((i) => i.status === 'completed' || i.status === 'not_applicable')
          .length,
        total: checklist.length,
      },
    },
    fees:
      feeRecords && feePlans
        ? {
            collected: feeCollections(
              feeRecords.map(({ r, isSample }) => ({
                ...(r as FeeRecordLike & { paymentDate: string | null }),
                isSample,
              })),
              window,
            ),
            outstanding: tuitionOutstanding(
              standing.map((d) => ({ ...d.totals, isSample: sample.has(d.plan.id) })),
            ),
          }
        : null,
  };
}
