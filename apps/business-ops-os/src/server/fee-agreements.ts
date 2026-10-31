/**
 * Annual fee agreements (owner brief 2026-10-21 §9, D-039): one agreement per admission bundle
 * (student) and academic year, tuition split by `fees.tuition_split` (50/25/25, remainder to the
 * last instalment), due dates entered by staff. Its ledger is ops.fee_records linked by plan_id
 * (fee-ledger.ts). Rules: domain/fee-plans.ts. Manually recorded figures, never verified payments.
 *
 * Every version (the first one too) is activated only by its OWN approval (`feeAgreementPolicy`,
 * subject = the fee_plans row), decided by someone who is neither the requester nor the version's
 * maker. An accepted (active) agreement is changed or closed only with `ops:admissions:approve` and
 * a reason; a change is a new DRAFT version (`supersedes_plan_id`) plus its approval request.
 * Receipts stay on the version they were recorded on and keep counting for every later version; a
 * new agreement for a student and year whose agreement was closed continues that version chain.
 *
 * For F-APPLY: `createFeeAgreement(tx, actor, admission, input)` (inside the confirmation
 * transaction, no permission check) and `feeAgreementPreview(db, tuitionPaise, dueDates)`.
 */
import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import { z } from 'zod';
import {
  approvals,
  opsAdmissions,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  opsLeads,
  students,
  type Database,
  type OpsFeePlanId,
} from '@elevate/database';
import {
  decideApproval,
  findPendingApproval,
  requestApproval,
  withTransaction,
} from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  isoDateSchema,
  ValidationError,
} from '@elevate/shared-contracts';
import type { AdmissionId, StudentIdentityId } from '@elevate/shared-types';
import { istToday } from '../domain';
import {
  agreementPositions,
  checkAgreementInput,
  splitTuition,
  studentFeeStatus,
  type StudentFeeStatus,
} from '../domain/fee-plans';
import { acceptedVersions } from '../domain/fee-year';
import { chargeSummary, FEE_DIRECTIONS, FEE_METHODS, MANUAL_FEE_DISCLAIMER } from '../domain/fees';
import { lockAccessible, namesOf, ownAdmissionFilter, readinessOf } from './admissions';
import { feeAgreementPolicy } from './approval-policies';
import { accessScope, clean, type Actor } from './context';
import {
  amountFields,
  asLike,
  issuesError,
  optText,
  paiseOf,
  present,
  recordFee,
} from './fee-ledger';
import { groupBy, inOrder, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';

export type FeePlanRow = typeof opsFeePlans.$inferSelect;

/** Readiness gaps that block asking for a fee approval (BR-OPS-7, same rule as the admission path). */
const FEE_VERIFICATION_GAPS: readonly string[] = [
  'fee_verification_1',
  'fee_verification_2',
  'fee_verifiers_not_distinct',
];

const money = { totalPaise: z.int().nullish(), totalRupees: z.string().trim().max(20).nullish() };
/** Form posts send indexed objects (`dueDates.0`); the API sends arrays. */
const dueDates = z.preprocess(
  (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v) : v),
  z.array(isoDateSchema).min(1).max(12),
);
const academicYear = z.string().trim().max(7);

export const feePlanCreateBody = z
  .object({
    admissionId: z.uuid().optional(),
    admissionCode: z.string().trim().max(40).optional(),
    studentId: z.uuid(),
    label: z.string().trim().min(1).max(120),
    pricingReference: optText(300),
    academicYear,
    ...money,
    dueDates,
  })
  .strict()
  .refine((b) => Boolean(b.admissionId) !== Boolean(b.admissionCode), {
    error: 'Give the admission (id or code)',
    path: ['admissionCode'],
  });
export type FeePlanCreateInput = z.output<typeof feePlanCreateBody>;

export const feePlanActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('activate') }).strict(),
  z.object({ action: z.literal('close'), reason: z.string().trim().min(1).max(500) }).strict(),
  z
    .object({
      action: z.literal('adjust'),
      ...money,
      dueDates,
      /** Only for an agreement recorded before academic years were kept. */
      academicYear: academicYear.optional(),
      reason: z.string().trim().min(10, 'Give the reason (at least 10 characters).').max(1000),
    })
    .strict(),
]);
export type FeePlanActionInput = z.output<typeof feePlanActionBody>;
export const feePlanDecisionBody = z
  .object({ decision: z.enum(['approved', 'rejected']), comment: optText(1000) })
  .strict();

/** Tuition entries; refunds and reversals go through POST /fees/{id} (they name their entry). */
export const feePlanEntryBody = z
  .object({
    kind: z.enum(['received', 'discount', 'waiver', 'adjustment']),
    direction: z.enum(FEE_DIRECTIONS).nullish(),
    ...amountFields,
    instalmentId: z.uuid().nullish(),
    receiptReference: optText(120),
    method: z.enum(FEE_METHODS).nullish(),
    paymentDate: isoDateSchema.nullish(),
    demoId: z.uuid().nullish(),
    notes: optText(1000),
  })
  .strict();
export const feePlanListQuery = z.object({ studentId: z.uuid() });

const splitSetting = async (db: Database) =>
  (await loadSettings(db))['fees.tuition_split'].value.sharesPercent;

/**
 * What an agreement for `tuitionPaise` would look like under the current settings (no writes,
 * no permission check): the instalments (amount null while the tuition is not valid; due date
 * null until entered), the registration fee (null = "Registration fee not configured") and
 * whether a paid demo fee would be credited (proposed setting, off by default).
 */
export async function feeAgreementPreview(
  db: Database,
  tuitionPaise: number | null,
  dueDates: readonly (string | null)[] = [],
) {
  const settings = await loadSettings(db);
  const shares = settings['fees.tuition_split'].value.sharesPercent;
  const amounts =
    tuitionPaise !== null && Number.isSafeInteger(tuitionPaise) && tuitionPaise > 0
      ? splitTuition(tuitionPaise, shares)
      : null;
  const registrationPaise = settings['fees.registration'].value.amountPaise;
  return {
    instalments: shares.map((sharePercent, i) => ({
      sequence: i + 1,
      sharePercent,
      amountPaise: amounts?.[i] ?? null,
      dueDate: dueDates[i] ?? null,
    })),
    registration: {
      amountPaise: registrationPaise,
      message: registrationPaise === null ? 'Registration fee not configured' : null,
    },
    demoCreditTowardTuition: settings['fees.demo_credit'].value.creditTowardTuition,
    disclaimer: MANUAL_FEE_DISCLAIMER,
  };
}

export interface FeeAgreementInput {
  /** When given, must be the admission's student (never chosen freely). */
  studentId?: string | null;
  academicYear: string;
  label: string;
  tuitionPaise: number;
  /** One per instalment (3 for 50/25/25), not decreasing. */
  dueDates: readonly string[];
  pricingReference?: string | null;
}

async function insertInstalments(
  tx: Database,
  planId: OpsFeePlanId,
  tuition: number,
  dates: readonly string[],
  shares: readonly number[],
) {
  const amounts = splitTuition(tuition, shares);
  return tx
    .insert(opsFeeInstalments)
    .values(
      amounts.map((amountPaise, n) => ({
        planId,
        sequence: n + 1,
        dueDate: dates[n]!,
        amountPaise,
      })),
    )
    .returning();
}

/**
 * Create the annual agreement inside `tx` (NO permission check: the caller checks). One per
 * student and academic year: if the bundle already has one, it is returned with `created: false`
 * (several programme enrolments are charged once). A draft until the fee arrangement is approved.
 */
export async function createFeeAgreement(
  tx: Database,
  actor: Actor,
  admission: { id: AdmissionId; studentId: StudentIdentityId | null },
  input: FeeAgreementInput,
  requestId?: string,
) {
  const shares = await splitSetting(tx);
  const issues = checkAgreementInput({
    tuitionPaise: input.tuitionPaise,
    academicYear: input.academicYear,
    dueDates: input.dueDates,
    sharesPercent: shares,
  });
  const studentId = admission.studentId;
  if (!studentId)
    issues.push({
      path: 'admissionId',
      message: 'This admission has no student record yet; link the student first.',
    });
  else if (input.studentId && input.studentId !== studentId)
    issues.push({ path: 'studentId', message: 'That student is not on this admission.' });
  if (!studentId || issues.length) throw issuesError(issues);
  // Lock the student: the "one agreement per student and year" check below is then serial.
  await tx
    .select({ id: students.id })
    .from(students)
    .where(eq(students.id, studentId))
    .for('update');
  const open = await tx
    .select()
    .from(opsFeePlans)
    .where(
      and(
        ne(opsFeePlans.status, 'closed'),
        or(
          eq(opsFeePlans.admissionId, admission.id),
          and(
            eq(opsFeePlans.studentId, studentId),
            eq(opsFeePlans.academicYear, input.academicYear),
          ),
        ),
      ),
    );
  const same = open.find((p) => p.studentId === studentId && p.academicYear === input.academicYear);
  if (same)
    return {
      created: false as const,
      /** The existing agreement's tuition is not the one asked for: the caller must say so. */
      tuitionDiffers: same.totalPaise !== input.tuitionPaise,
      plan: same,
      instalments: await tx
        .select()
        .from(opsFeeInstalments)
        .where(eq(opsFeeInstalments.planId, same.id)),
    };
  if (open.length)
    throw new ConflictError('This admission already has an open fee agreement; close it first.');
  // A closed agreement of the same student and year is continued, so its receipts keep counting.
  const sameYear = await tx
    .select()
    .from(opsFeePlans)
    .where(
      and(eq(opsFeePlans.studentId, studentId), eq(opsFeePlans.academicYear, input.academicYear)),
    );
  const replaced = new Set(sameYear.map((p) => p.supersedesPlanId));
  const previous = sameYear.find((p) => !replaced.has(p.id));
  const [plan] = await tx
    .insert(opsFeePlans)
    .values({
      admissionId: admission.id,
      studentId,
      label: input.label,
      pricingReference: clean(input.pricingReference),
      totalPaise: input.tuitionPaise,
      academicYear: input.academicYear,
      ...(previous && {
        version: previous.version + 1,
        supersedesPlanId: previous.id,
        adjustmentReason: `New agreement after version ${previous.version} was closed: ${previous.closeReason}`,
      }),
      createdBy: actor.id,
    })
    .returning();
  if (!plan) throw new Error('fee plan insert returned no row');
  const instalments = await insertInstalments(
    tx,
    plan.id,
    input.tuitionPaise,
    input.dueDates,
    shares,
  );
  await opsAudit('fee_plan')(
    tx,
    actor,
    plan.id,
    'fee_plan.created',
    { after: { ...plan, instalments }, metadata: { admissionId: admission.id, split: shares } },
    requestId,
  );
  return { created: true as const, tuitionDiffers: false, plan, instalments };
}

async function admissionForPlan(tx: Database, input: FeePlanCreateInput) {
  if (input.admissionId) return input.admissionId;
  const [row] = await tx
    .select({ id: opsAdmissions.id })
    .from(opsAdmissions)
    .where(eq(opsAdmissions.code, (input.admissionCode ?? '').toUpperCase()));
  if (!row) throw issuesError([{ path: 'admissionCode', message: 'No admission has that code.' }]);
  return row.id;
}

/** POST /fee-plans — a draft annual agreement; a second one for the same student and year is 409. */
export async function createFeePlan(
  db: Database,
  actor: Actor,
  input: FeePlanCreateInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:fees:record');
  const tuitionPaise = paiseOf(input.totalPaise, input.totalRupees) ?? Number.NaN;
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, await admissionForPlan(tx, input));
    const r = await createFeeAgreement(tx, actor, admission, { ...input, tuitionPaise }, requestId);
    if (!r.created)
      throw new ConflictError(
        `This student already has a fee agreement for ${input.academicYear}; one agreement covers every programme in the bundle.`,
      );
    return { ...r.plan, instalments: r.instalments, disclaimer: MANUAL_FEE_DISCLAIMER };
  });
}

/**
 * An agreement version is activated only by its own latest plan-bound approval, decided `approved`
 * by someone other than its maker (no fallback to admission-level approvals).
 */
async function activationPatch(tx: Database, plan: FeePlanRow) {
  const [approval] = await tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.policy, feeAgreementPolicy.key), eq(approvals.subjectId, plan.id)))
    .orderBy(desc(approvals.requestedAt), desc(approvals.id))
    .limit(1);
  if (approval?.status !== 'approved' || !approval.decidedBy || !approval.decidedAt)
    throw new InvalidStateTransitionError(
      'This agreement is not approved yet: request approval for it; a different approver decides.',
    );
  if (approval.decidedBy === plan.createdBy)
    throw new InvalidStateTransitionError(
      'The approval was decided by the person who made this agreement; a different approver must decide.',
    );
  return {
    status: 'active',
    approvalId: approval.id,
    approvedBy: approval.decidedBy,
    approvedAt: approval.decidedAt,
  } as const;
}

const needsApprove = (actor: Actor, plan: FeePlanRow, what: string) => {
  if (plan.status === 'active' && !can(actor, 'ops:admissions:approve'))
    throw new ForbiddenError(
      `${what} an accepted fee agreement needs the fee-approval permission.`,
    );
};

/**
 * POST /fee-plans/{id} — `activate` (needs this version's own approval, decided by someone other
 * than its maker), `close` (reason; an active agreement needs `ops:admissions:approve`) or `adjust` (new
 * draft version + approval request; same permission). Receipts are never touched.
 */
export async function feePlanAction(
  db: Database,
  actor: Actor,
  planId: string,
  input: FeePlanActionInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:fees:record');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsFeePlans, planId, 'Fee plan', true);
    await lockAccessible(tx, access, before.admissionId);
    if (before.status === 'closed')
      throw new InvalidStateTransitionError('The agreement is closed.');
    const audit = (action: string, after: unknown) =>
      opsAudit('fee_plan')(
        tx,
        actor,
        before.id,
        action,
        { before, after, metadata: { admissionId: before.admissionId } },
        requestId,
      );
    if (input.action === 'adjust') return adjust(tx, actor, before, input, audit, requestId);
    let patch: Partial<typeof opsFeePlans.$inferInsert>;
    if (input.action === 'activate') {
      if (before.status !== 'draft')
        throw new InvalidStateTransitionError(`A ${before.status} plan cannot be activated.`);
      patch = await activationPatch(tx, before);
    } else {
      needsApprove(actor, before, 'Closing');
      patch = {
        status: 'closed',
        closedBy: actor.id,
        closedAt: new Date(),
        closeReason: input.reason,
      };
    }
    const [after] = await tx
      .update(opsFeePlans)
      .set(patch)
      .where(eq(opsFeePlans.id, before.id))
      .returning();
    await audit(input.action === 'activate' ? 'fee_plan.activated' : 'fee_plan.closed', patch);
    return after;
  });
}

async function adjust(
  tx: Database,
  actor: Actor,
  before: FeePlanRow,
  input: Extract<FeePlanActionInput, { action: 'adjust' }>,
  audit: (action: string, after: unknown) => Promise<unknown>,
  requestId?: string,
) {
  needsApprove(actor, before, 'Changing');
  const shares = await splitSetting(tx);
  const tuitionPaise = paiseOf(input.totalPaise, input.totalRupees) ?? Number.NaN;
  if (before.academicYear && input.academicYear && input.academicYear !== before.academicYear)
    throw issuesError([
      { path: 'academicYear', message: `This agreement is for ${before.academicYear}.` },
    ]);
  const year = before.academicYear ?? input.academicYear ?? '';
  const issues = checkAgreementInput({
    tuitionPaise,
    academicYear: year,
    dueDates: input.dueDates,
    sharesPercent: shares,
  });
  if (issues.length) throw issuesError(issues);
  const version = before.version + 1;
  await tx
    .update(opsFeePlans)
    .set({
      status: 'closed',
      closedBy: actor.id,
      closedAt: new Date(),
      closeReason: `Replaced by version ${version}: ${input.reason}`,
    })
    .where(eq(opsFeePlans.id, before.id));
  const [plan] = await tx
    .insert(opsFeePlans)
    .values({
      admissionId: before.admissionId,
      studentId: before.studentId,
      label: before.label,
      pricingReference: before.pricingReference,
      totalPaise: tuitionPaise,
      academicYear: year,
      version,
      supersedesPlanId: before.id,
      adjustmentReason: input.reason,
      createdBy: actor.id,
    })
    .returning();
  if (!plan) throw new Error('fee plan insert returned no row');
  const instalments = await insertInstalments(tx, plan.id, tuitionPaise, input.dueDates, shares);
  // New terms need their own approval, decided by someone else (POST /fee-plans/{id}/decision).
  if (before.status === 'active')
    await requestApproval(tx, {
      policy: feeAgreementPolicy,
      subjectId: plan.id,
      requestedBy: actor,
      comment: `Fee agreement version ${version}: ${input.reason}`,
      requestId,
    });
  await audit('fee_plan.adjusted', { ...plan, instalments });
  return { ...plan, instalments, disclaimer: MANUAL_FEE_DISCLAIMER };
}

export const feePlanApprovalRequestBody = z.object({ comment: optText(1000) }).strict();

/**
 * POST /fee-plans/{id}/approval-request — ask for the approval of a DRAFT agreement version, after
 * both fee verifications (BR-OPS-7). Core approvals: one pending request per version; the
 * requester can never decide it.
 */
export async function requestFeePlanApproval(
  db: Database,
  actor: Actor,
  planId: string,
  input: z.output<typeof feePlanApprovalRequestBody>,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  return withTransaction(db, async (tx) => {
    const plan = await rowById(tx, opsFeePlans, planId, 'Fee plan', true);
    const admission = await lockAccessible(tx, access, plan.admissionId);
    if (plan.status !== 'draft')
      throw new InvalidStateTransitionError(
        `A ${plan.status} agreement needs no approval request.`,
      );
    const { gaps } = await readinessOf(tx, admission);
    if (gaps.some((g) => FEE_VERIFICATION_GAPS.includes(g)))
      throw new ValidationError(
        'Record both fee verifications, by two different people, before asking for approval.',
      );
    if (await findPendingApproval(tx, feeAgreementPolicy, plan.id))
      throw new ConflictError('An approval request is already pending for this agreement.');
    return requestApproval(tx, {
      policy: feeAgreementPolicy,
      subjectId: plan.id,
      requestedBy: actor,
      comment: input.comment ?? `Fee agreement version ${plan.version}`,
      requestId,
    });
  });
}

/**
 * POST /fee-plans/{id}/decision (also used by the approvals inbox) — an approver decides the
 * pending request of a DRAFT version: never the requester (core), never the version's maker.
 * Approving does not activate it: someone with `ops:fees:record` activates it afterwards.
 */
export async function decideFeePlan(
  db: Database,
  actor: Actor,
  planId: string,
  input: z.output<typeof feePlanDecisionBody>,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:approve');
  return withTransaction(db, async (tx) => {
    const plan = await rowById(tx, opsFeePlans, planId, 'Fee plan', true);
    await lockAccessible(tx, access, plan.admissionId);
    if (plan.status !== 'draft')
      throw new InvalidStateTransitionError(`A ${plan.status} agreement has nothing to decide.`);
    if (plan.createdBy === actor.id)
      throw new ForbiddenError('You made this agreement; a different approver must decide it.');
    const pending = await findPendingApproval(tx, feeAgreementPolicy, plan.id);
    if (!pending) throw new InvalidStateTransitionError('No approval is pending for it.');
    return decideApproval(tx, {
      policy: feeAgreementPolicy,
      approvalId: pending.id,
      decider: actor,
      decision: input.decision,
      comment: input.comment ?? null,
      requestId,
    });
  });
}

/**
 * POST /fee-plans/{id}/entries — append a tuition ledger row (payment, discount, waiver, adjustment).
 * Proposed rule (O2, owner to confirm): a discount, waiver or credit adjustment (other than a demo
 * fee credit) lowers agreed terms, so it needs `ops:admissions:approve`, a reason, and someone other
 * than the agreement's maker.
 */
export async function recordPlanEntry(
  db: Database,
  actor: Actor,
  planId: string,
  input: z.output<typeof feePlanEntryBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:fees:record');
  const plan = await rowById(db, opsFeePlans, planId, 'Fee plan');
  const lowers =
    input.kind === 'discount' ||
    input.kind === 'waiver' ||
    (input.kind === 'adjustment' && input.direction === 'credit' && !input.demoId);
  if (lowers && (!can(actor, 'ops:admissions:approve') || plan.createdBy === actor.id))
    throw new ForbiddenError(
      'A discount, waiver or credit on an agreement needs the fee-approval permission and someone other than the agreement’s maker.',
    );
  if (lowers && !input.notes)
    throw issuesError([{ path: 'notes', message: 'Give the reason for the reduction.' }]);
  return recordFee(
    db,
    actor,
    plan.admissionId,
    { ...input, chargeCategory: 'tuition', planId: plan.id },
    requestId,
  );
}

/**
 * Agreements with instalments, ledger, totals, allocation, status and version history, read by
 * agreementPositions (no permission check).
 */
export async function plansWithLedger(db: Database, plans: FeePlanRow[], now: Date) {
  if (!plans.length) return [];
  const family = await db
    .select()
    .from(opsFeePlans)
    .where(inArray(opsFeePlans.studentId, [...new Set(plans.map((p) => p.studentId))]));
  const ids = family.map((p) => p.id);
  const [instalments, ledger] = await inOrder([
    db.select().from(opsFeeInstalments).where(inArray(opsFeeInstalments.planId, ids)),
    db
      .select()
      .from(opsFeeRecords)
      .where(inArray(opsFeeRecords.planId, ids))
      .orderBy(desc(opsFeeRecords.recordedAt), desc(opsFeeRecords.code)),
  ]);
  return agreementPositions(plans, family, instalments, ledger, istToday(now));
}

/**
 * The versions in force (acceptedVersions) among `visible`, the plans a reader may see: a change
 * waiting for approval moves nothing, so its accepted version stays on every working list.
 */
export async function inForceOf(db: Database, visible: readonly FeePlanRow[]) {
  if (!visible.length) return [];
  const family = await db
    .select()
    .from(opsFeePlans)
    .where(inArray(opsFeePlans.studentId, [...new Set(visible.map((p) => p.studentId))]));
  const seen = new Set(visible.map((p) => p.id as string));
  return acceptedVersions(family).inForce.filter((p) => seen.has(p.id));
}

/**
 * GET /fee-plans?studentId= — the student's current agreements the caller may see (own scope:
 * admissions they counsel or whose lead they own), version history, the registration and demo
 * charges (separate balances), names and the disclaimer, newest first. During a change both the
 * accepted version (`inForce`: its figures stand, money posts on it) and its draft
 * (`proposedChange`) are listed.
 */
export async function studentFeePlans(
  db: Database,
  actor: Actor,
  studentId: string,
  now: Date = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const sid = studentId as StudentIdentityId;
  const [all, settings] = await inOrder([
    db
      .select()
      .from(opsFeePlans)
      .where(eq(opsFeePlans.studentId, sid))
      .orderBy(desc(opsFeePlans.createdAt)),
    () => loadSettings(db),
  ]);
  // The student's admissions plus those their agreements hang on, within the caller's scope.
  const visibleAdmissions = await db
    .select({ id: opsAdmissions.id, code: opsAdmissions.code })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(
      and(
        all.length
          ? or(
              eq(opsAdmissions.studentId, sid),
              inArray(
                opsAdmissions.id,
                all.map((p) => p.admissionId),
              ),
            )
          : eq(opsAdmissions.studentId, sid),
        ownAdmissionFilter(access),
      ),
    );
  const visible = new Set(visibleAdmissions.map((a) => a.id as string));
  const versions = acceptedVersions(all);
  const listed = new Set([
    ...versions.counted,
    ...versions.proposed,
    ...versions.drafts,
    ...versions.abandoned,
  ]);
  const shown = all.filter((p) => listed.has(p) && visible.has(p.admissionId));
  const [detailed, other] = await inOrder([
    () => plansWithLedger(db, shown, now),
    visible.size
      ? db
          .select()
          .from(opsFeeRecords)
          .where(
            and(
              inArray(opsFeeRecords.admissionId, [...visible] as AdmissionId[]),
              // Registration, demo, and tuition recorded outside any annual agreement (legacy path).
              or(ne(opsFeeRecords.chargeCategory, 'tuition'), isNull(opsFeeRecords.planId)),
            ),
          )
          .orderBy(desc(opsFeeRecords.recordedAt), desc(opsFeeRecords.code))
      : [],
  ]);
  const draftPlans = shown.filter((p) => p.status === 'draft');
  const drafts = draftPlans.map((p) => p.id as string);
  const pending = drafts.length
    ? await db
        .select({ subjectId: approvals.subjectId, requestedBy: approvals.requestedBy })
        .from(approvals)
        .where(
          and(
            eq(approvals.policy, feeAgreementPolicy.key),
            eq(approvals.status, 'pending'),
            inArray(approvals.subjectId, drafts),
          ),
        )
    : [];
  const activatable = new Set(
    (
      await inOrder(
        draftPlans.map(
          (p) => () =>
            activationPatch(db, p).then(
              () => p.id as string,
              () => null,
            ),
        ),
      )
    ).filter(Boolean),
  );
  const names = await namesOf(db, [
    ...detailed.flatMap((d) => [
      d.plan.approvedBy,
      ...d.versions.map((v) => v.createdBy),
      ...d.ledger.map((r) => r.recordedBy),
    ]),
    ...other.map((r) => r.recordedBy),
  ]);
  return {
    plans: detailed.map((d) => ({
      ...d,
      inForce: versions.inForce.includes(d.plan),
      proposedChange: versions.proposed.includes(d.plan),
      approvedByName: d.plan.approvedBy ? (names.get(d.plan.approvedBy) ?? null) : null,
      versions: d.versions.map((v) => ({ ...v, createdByName: names.get(v.createdBy) ?? null })),
      ledger: d.ledger.map((r) => present(r, names)),
      pendingApproval: pending.find((a) => a.subjectId === d.plan.id) ?? null,
      canActivate: activatable.has(d.plan.id),
    })),
    registration: {
      configuredPaise: settings['fees.registration'].value.amountPaise,
      summary: chargeSummary(asLike(other), 'registration'),
    },
    demo: chargeSummary(asLike(other), 'demo'),
    /** Tuition rows not on any agreement: shown and summed apart, never silently dropped. */
    tuitionOutsideAgreement: chargeSummary(
      asLike(other.filter((r) => r.chargeCategory === 'tuition')),
      'tuition',
    ),
    otherCharges: other.map((r) => present(r, names)),
    admissions: visibleAdmissions,
    disclaimer: MANUAL_FEE_DISCLAIMER,
  };
}

/**
 * Fee status per student for lists (Active Students): `paid | due | overdue | not_configured`,
 * from agreements in force only (a first draft is not configured yet). No permission check —
 * callers must hold `ops:fees:read` before showing it. No agreement → `not_configured`, never "paid".
 */
export async function feeStatusForStudents(
  db: Database,
  studentIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, StudentFeeStatus>> {
  if (!studentIds.length) return new Map();
  const family = await db
    .select()
    .from(opsFeePlans)
    .where(inArray(opsFeePlans.studentId, studentIds as StudentIdentityId[]));
  const detailed = await plansWithLedger(db, acceptedVersions(family).inForce, now);
  const statesOf = groupBy(detailed, (d) => d.plan.studentId);
  return new Map(
    studentIds.map((id) => [id, studentFeeStatus((statesOf.get(id) ?? []).map((d) => d.status))]),
  );
}
