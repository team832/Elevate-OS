/**
 * Recruitment (OPS-040…OPS-044, D-028): requisitions, candidates, job
 * applications with stage history, interviews and feedback, offers, the
 * candidate-to-employee conversion and unsuccessful-candidate anonymisation.
 *
 * Access (checked here even when the route already did):
 * - `ops:recruitment:read|manage` at scope `all` (HR, operations manager) or
 *   `own` (recruiter): own = requisitions where they are the recruiter,
 *   candidates they recruit, applications on those, and applications they
 *   interview for. Interviewer-only coverage is read + feedback: it never
 *   allows stage changes, offers or candidate contact details.
 * - `ops:recruitment:decide` (HR manager, director, operations manager):
 *   approval to open, selection/rejection, offer approval, conversion,
 *   anonymisation. Never by the requester / preparer.
 * - Candidate email/phone are returned only to managers covering the
 *   candidate; never in lists or audit payloads.
 */
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  auditEvents,
  departments,
  opsCandidates,
  opsEmployeeRecords,
  opsInterviewPanelists,
  opsInterviews,
  opsJobApplications,
  opsJobApplicationStages,
  opsJobOffers,
  opsLifecycleCases,
  opsRequisitions,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId, UserId } from '@elevate/shared-types';
import { normaliseEmail, normalisePhone, PHONE_ERROR_MESSAGES } from '../../domain/contacts';
import { istToday, toIsoDate, TIMEZONE, type IsoDate } from '../../domain/dates';
import {
  anonymisationEligibility,
  applicationTargets,
  checkApplicationTransition,
  checkOfferTransition,
  checkRequisitionTransition,
  feedbackAllowed,
  INTERVIEW_STATUS_TRANSITIONS,
  isLiveOffer,
  isOpenApplication,
  isUnsuccessful,
  OFFER_STATUSES,
  REQUISITION_STATUSES,
  retentionStatus,
  type ApplicationStage,
  type InterviewStatus,
  type OfferStatus,
  type RecruitmentCheck,
  type RequisitionStatus,
} from '../../domain/hr/recruitment';
import { accessScope, activeStaff, clean, nextCode, staffIdForUser, type Actor } from '../context';
import { loadSettings } from '../settings';
import { withTransaction } from '@elevate/server-kit';
import { defined, rowById } from '../ops-common';
import { insertEmployee } from './employee-core';
import type {
  ApplicationListQuery,
  CandidateListQuery,
  ConvertInput,
  CreateCandidateInput,
  CreateInterviewInput,
  CreateOfferInput,
  CreateRequisitionInput,
  RequisitionListQuery,
  UpdateCandidateInput,
  UpdateRequisitionInput,
} from './lifecycle-schemas';
import {
  auditOf,
  fieldError,
  notifyPeople,
  openOnboardingCase,
  pageOf,
  search,
  sortBy,
} from './onboarding';

type RequisitionRow = typeof opsRequisitions.$inferSelect;
type ApplicationRow = typeof opsJobApplications.$inferSelect;

const LIVE_OFFER_STATUSES = OFFER_STATUSES.filter(isLiveOffer);
const offsetOf = (q: { page: number; pageSize: number }) => (q.page - 1) * q.pageSize;

/** Turn a failed domain check into the right AppError. */
function throwCheck(check: Exclude<RecruitmentCheck, { ok: true }>): never {
  if (check.code === 'REASON_REQUIRED') throw fieldError('reason', check.message);
  if (check.code === 'NOT_AUTHORISED' || check.code === 'SELF_APPROVAL')
    throw new ForbiddenError(check.message, { details: { code: check.code } });
  throw new InvalidStateTransitionError(check.message, { details: { code: check.code } });
}

/** Transition access: manage holders get manage coverage; decide-only holders (director) decide coverage. */
async function transitionAccess(db: Database, actor: Actor) {
  const canManage = can(actor, 'ops:recruitment:manage');
  const cov = await recruitmentCoverage(
    db,
    actor,
    canManage ? 'ops:recruitment:manage' : 'ops:recruitment:decide',
  );
  return { canDecide: can(actor, 'ops:recruitment:decide'), canManage, cov };
}

/** Throw unless the edge is legal and its authority is held (`manage` edges need coverage). */
function authorise(check: RecruitmentCheck, managed: boolean, what: string) {
  if (!check.ok) throwCheck(check);
  if (check.edge.authority === 'manage' && !managed) deny(what);
}

/** Targets the user may pick: legal edges whose authority they hold. */
function permitted<S extends string>(
  targets: readonly S[],
  check: (to: S) => RecruitmentCheck,
  canDecide: boolean,
  canManage: boolean,
): S[] {
  return targets.filter((to) => {
    const c = check(to);
    return c.ok && (c.edge.authority === 'decide' ? canDecide : canManage);
  });
}

/**
 * History panel: who did what and when, from core.audit_events. Only the
 * action and the actor are returned — never the before/after payloads.
 */
export async function entityHistory(db: Database, entityType: string, entityId: string) {
  const rows = await db
    .select({ at: auditEvents.at, action: auditEvents.action, actorName: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .orderBy(desc(auditEvents.at))
    .limit(100);
  return rows.map((r) => ({ at: r.at, action: r.action, actorName: r.actorName ?? 'System' }));
}

/** id → name lookup over the distinct, non-empty ids. */
function nameLookup(
  load: (db: Database, ids: string[]) => Promise<{ id: string; name: string }[]>,
) {
  return async (db: Database, ids: readonly (string | null | undefined)[]) => {
    const list = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    const rows = list.length ? await load(db, list) : [];
    return new Map<string, string>(rows.map((r) => [r.id, r.name]));
  };
}

export const staffNames = nameLookup((db, ids) =>
  db
    .select({ id: staffMembers.id, name: staffMembers.fullName })
    .from(staffMembers)
    .where(inArray(staffMembers.id, ids as StaffMemberId[])),
);

export const userNames = nameLookup((db, ids) =>
  db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, ids as UserId[])),
);

/** The name of `id` from a staffNames / userNames map; null when unset or unknown. */
export const nameOf = (names: Map<string, string>, id: string | null | undefined) =>
  id ? (names.get(id) ?? null) : null;

const auditRequisition = auditOf('requisition');
const auditCandidate = auditOf('candidate');
const auditApplication = auditOf('job_application');

/** Notification link + entity for an application. */
const applicationRef = (id: string) => ({
  link: `/ops/hr/recruitment/applications/${id}`,
  entityType: 'job_application',
  entityId: id,
});

// --- coverage (own scope) ----------------------------------------------------------------------

export interface Coverage {
  scope: 'all' | 'own';
  staffId: StaffMemberId | null;
  /** Applications the user manages (recruiter of the requisition or of the candidate). */
  managedApplicationIds: Set<string>;
  /** Applications the user interviews for. */
  interviewApplicationIds: Set<string>;
  requisitionIds: Set<string>;
  managedRequisitionIds: Set<string>;
  candidateIds: Set<string>;
  managedCandidateIds: Set<string>;
}

/**
 * Permission check + recruitment coverage. `all` scope covers everything; `own`
 * resolves the sets above for the staff member linked to the user. Even
 * all-scope users get their staff id (for "interviewing me" and no-self rules).
 */
export async function recruitmentCoverage(
  db: Database,
  actor: Actor,
  permission: 'ops:recruitment:read' | 'ops:recruitment:manage' | 'ops:recruitment:decide',
): Promise<Coverage> {
  const access = await accessScope(db, actor, permission);
  const me = access.scope === 'own' ? access.staffId : await staffIdForUser(db, actor.id);
  const cov: Coverage = {
    scope: access.scope,
    staffId: me,
    managedApplicationIds: new Set(),
    interviewApplicationIds: new Set(),
    requisitionIds: new Set(),
    managedRequisitionIds: new Set(),
    candidateIds: new Set(),
    managedCandidateIds: new Set(),
  };
  if (!me) return cov;
  const panel = await db
    .selectDistinct({ applicationId: opsInterviews.applicationId })
    .from(opsInterviewPanelists)
    .innerJoin(opsInterviews, eq(opsInterviews.id, opsInterviewPanelists.interviewId))
    .where(eq(opsInterviewPanelists.staffId, me));
  cov.interviewApplicationIds = new Set(panel.map((r) => r.applicationId as string));
  if (cov.scope === 'all') return cov;
  const reqIds = (
    await db
      .select({ id: opsRequisitions.id })
      .from(opsRequisitions)
      .where(eq(opsRequisitions.recruiterStaffId, me))
  ).map((r) => r.id as string);
  const candIds = (
    await db
      .select({ id: opsCandidates.id })
      .from(opsCandidates)
      .where(eq(opsCandidates.recruiterStaffId, me))
  ).map((r) => r.id as string);
  const myReqs = new Set(reqIds);
  const myCands = new Set(candIds);
  cov.managedRequisitionIds = new Set(reqIds);
  cov.requisitionIds = new Set(reqIds);
  cov.managedCandidateIds = new Set(candIds);
  cov.candidateIds = new Set(candIds);
  if (!reqIds.length && !candIds.length && !panel.length) return cov;
  // Applications on my requisitions or candidates (managed) and those I interview for (read).
  const apps = await db
    .select({
      id: opsJobApplications.id,
      candidateId: opsJobApplications.candidateId,
      requisitionId: opsJobApplications.requisitionId,
    })
    .from(opsJobApplications)
    .where(
      or(
        reqIds.length ? inArray(opsJobApplications.requisitionId, reqIds as never) : undefined,
        candIds.length ? inArray(opsJobApplications.candidateId, candIds as never) : undefined,
        panel.length
          ? inArray(opsJobApplications.id, [...cov.interviewApplicationIds] as never)
          : undefined,
      ),
    );
  for (const a of apps) {
    cov.candidateIds.add(a.candidateId);
    cov.requisitionIds.add(a.requisitionId);
    if (myReqs.has(a.requisitionId) || myCands.has(a.candidateId)) {
      cov.managedApplicationIds.add(a.id);
      cov.managedCandidateIds.add(a.candidateId);
    }
  }
  return cov;
}

const all = (c: Coverage) => c.scope === 'all';
const readsApplication = (c: Coverage, id: string) =>
  all(c) || c.managedApplicationIds.has(id) || c.interviewApplicationIds.has(id);
const managesApplication = (c: Coverage, id: string) => all(c) || c.managedApplicationIds.has(id);
const readsRequisition = (c: Coverage, id: string) => all(c) || c.requisitionIds.has(id);
const managesRequisition = (c: Coverage, id: string) => all(c) || c.managedRequisitionIds.has(id);
const readsCandidate = (c: Coverage, id: string) => all(c) || c.candidateIds.has(id);
const managesCandidate = (c: Coverage, id: string) => all(c) || c.managedCandidateIds.has(id);

function deny(what: string): never {
  throw new ForbiddenError(`You can only work on ${what} assigned to you.`);
}

/** Recruiter on create: own-scope users always recruit for themselves (`refusal` otherwise). */
function recruiterOnCreate(cov: Coverage, requested: string | null | undefined, refusal: string) {
  if (cov.scope === 'all') return (requested ?? null) as StaffMemberId | null;
  if (!cov.staffId) throw new ForbiddenError('Your account is not linked to a staff record.');
  if (requested && requested !== cov.staffId) throw new ForbiddenError(refusal);
  return cov.staffId;
}

// --- requisitions ------------------------------------------------------------------------------

async function validateDepartment(db: Database, id: string | null | undefined) {
  if (!id) return;
  const [row] = await db
    .select({ id: departments.id, status: departments.status })
    .from(departments)
    .where(eq(departments.id, id as DepartmentId));
  if (!row || row.status === 'archived')
    throw fieldError('departmentId', 'Unknown or archived department.', 'Unknown department');
}

export async function listRequisitions(db: Database, actor: Actor, q: RequisitionListQuery) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:read');
  if (cov.scope === 'own' && cov.requisitionIds.size === 0) return pageOf(q, []);
  const where = and(
    cov.scope === 'own' ? inArray(opsRequisitions.id, [...cov.requisitionIds] as never) : undefined,
    q.status ? eq(opsRequisitions.status, q.status) : undefined,
    q.q ? search(q.q, opsRequisitions.title, opsRequisitions.code) : undefined,
  );
  const sortCol = {
    code: opsRequisitions.code,
    title: opsRequisitions.title,
    status: opsRequisitions.status,
    updated: opsRequisitions.updatedAt,
  }[q.sort];
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(opsRequisitions)
    .where(where);
  const rows = await db
    .select({ r: opsRequisitions, departmentName: departments.name })
    .from(opsRequisitions)
    .leftJoin(departments, eq(departments.id, opsRequisitions.departmentId))
    .where(where)
    .orderBy(sortBy(q.dir, sortCol), asc(opsRequisitions.code))
    .limit(q.pageSize)
    .offset(offsetOf(q));
  const ids = rows.map((r) => r.r.id);
  const apps = ids.length
    ? await db
        .select({
          requisitionId: opsJobApplications.requisitionId,
          stage: opsJobApplications.stage,
        })
        .from(opsJobApplications)
        .where(inArray(opsJobApplications.requisitionId, ids))
    : [];
  const names = await staffNames(
    db,
    rows.map((r) => r.r.recruiterStaffId),
  );
  const mapped = rows.map(({ r, departmentName }) => {
    const mine = apps.filter((a) => a.requisitionId === r.id);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      departmentName,
      openings: r.openings,
      employmentType: r.employmentType,
      location: r.location,
      status: r.status,
      recruiterName: nameOf(names, r.recruiterStaffId),
      applications: mine.length,
      openApplications: mine.filter((a) => isOpenApplication(a.stage)).length,
      hired: mine.filter((a) => a.stage === 'hired').length,
      updatedAt: r.updatedAt,
    };
  });
  return pageOf(q, mapped, total);
}

export async function getRequisition(db: Database, actor: Actor, id: string) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:read');
  const r = await rowById(db, opsRequisitions, id, 'Requisition');
  if (!readsRequisition(cov, r.id)) deny('requisitions');
  const [dept] = r.departmentId
    ? await db
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.id, r.departmentId))
    : [];
  const names = await staffNames(db, [r.recruiterStaffId, r.hiringManagerStaffId]);
  const uNames = await userNames(db, [r.createdBy, r.approvedBy]);
  const apps = await db
    .select({
      id: opsJobApplications.id,
      stage: opsJobApplications.stage,
      stageChangedAt: opsJobApplications.stageChangedAt,
      candidateId: opsCandidates.id,
      candidateCode: opsCandidates.code,
      candidateName: opsCandidates.fullName,
    })
    .from(opsJobApplications)
    .innerJoin(opsCandidates, eq(opsCandidates.id, opsJobApplications.candidateId))
    .where(eq(opsJobApplications.requisitionId, r.id))
    .orderBy(desc(opsJobApplications.stageChangedAt));
  const canManage = can(actor, 'ops:recruitment:manage') && managesRequisition(cov, r.id);
  const canDecide = can(actor, 'ops:recruitment:decide');
  const isRequester = r.createdBy === actor.id;
  return {
    requisition: r,
    departmentName: dept?.name ?? null,
    recruiterName: nameOf(names, r.recruiterStaffId),
    hiringManagerName: nameOf(names, r.hiringManagerStaffId),
    requestedByName: nameOf(uNames, r.createdBy),
    approvedByName: nameOf(uNames, r.approvedBy),
    applications: apps.filter((a) => readsApplication(cov, a.id)),
    canManage,
    canDecide,
    isRequester,
    allowedTargets: permitted(
      REQUISITION_STATUSES,
      (to) =>
        checkRequisitionTransition(r.status, to, {
          canDecide,
          actorIsRequester: isRequester,
          reason: 'x',
        }),
      canDecide,
      canManage,
    ),
    history: await entityHistory(db, 'requisition', r.id),
  };
}

export async function createRequisition(
  db: Database,
  actor: Actor,
  input: CreateRequisitionInput,
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:manage');
  const recruiter = recruiterOnCreate(
    cov,
    input.recruiterStaffId,
    'You can only create requisitions you recruit for.',
  );
  await validateDepartment(db, input.departmentId);
  if (recruiter) await activeStaff(db, recruiter, 'recruiterStaffId');
  if (input.hiringManagerStaffId)
    await activeStaff(db, input.hiringManagerStaffId, 'hiringManagerStaffId');
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'requisition', 'ops.requisitions');
    const row = (
      await tx
        .insert(opsRequisitions)
        .values({
          code,
          title: input.title,
          departmentId: (input.departmentId as DepartmentId | null) ?? null,
          roleDescription: input.roleDescription ?? null,
          openings: input.openings,
          employmentType: input.employmentType,
          location: input.location ?? null,
          recruiterStaffId: recruiter,
          hiringManagerStaffId: (input.hiringManagerStaffId as StaffMemberId | null) ?? null,
          createdBy: actor.id,
        })
        .returning()
    )[0]!;
    await auditRequisition(tx, actor, row.id, 'requisition.created', {
      after: row,
      requestId,
    });
    return row;
  });
}

export async function updateRequisition(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateRequisitionInput,
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:manage');
  if (cov.scope === 'own' && input.recruiterStaffId !== undefined)
    throw new ForbiddenError('Only HR can reassign the recruiter.');
  await validateDepartment(db, input.departmentId);
  if (input.recruiterStaffId) await activeStaff(db, input.recruiterStaffId, 'recruiterStaffId');
  if (input.hiringManagerStaffId)
    await activeStaff(db, input.hiringManagerStaffId, 'hiringManagerStaffId');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsRequisitions, id, 'Requisition', true);
    if (!managesRequisition(cov, before.id)) deny('requisitions');
    if (before.status === 'filled' || before.status === 'cancelled')
      throw new ConflictError('A filled or cancelled requisition cannot be edited.');
    const patch = defined(input) as Partial<typeof opsRequisitions.$inferInsert>;
    const [after] = await tx
      .update(opsRequisitions)
      .set(patch)
      .where(eq(opsRequisitions.id, before.id))
      .returning();
    await auditRequisition(tx, actor, before.id, 'requisition.updated', {
      before,
      after,
      requestId,
    });
    return after as RequisitionRow;
  });
}

export async function transitionRequisition(
  db: Database,
  actor: Actor,
  id: string,
  input: { to: RequisitionStatus; reason?: string | null },
  requestId?: string,
) {
  const { canDecide, canManage, cov } = await transitionAccess(db, actor);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsRequisitions, id, 'Requisition', true);
    const check = checkRequisitionTransition(before.status, input.to, {
      canDecide,
      actorIsRequester: before.createdBy === actor.id,
      reason: input.reason,
    });
    authorise(check, canManage && managesRequisition(cov, before.id), 'requisitions');
    const now = new Date();
    const approving = before.status === 'draft' && input.to === 'open';
    const statusReason = clean(input.reason);
    const [after] = await tx
      .update(opsRequisitions)
      .set({
        status: input.to,
        statusReason,
        statusChangedAt: now,
        ...(approving ? { approvedBy: actor.id, approvedAt: now } : {}),
      })
      .where(eq(opsRequisitions.id, before.id))
      .returning();
    await auditRequisition(
      tx,
      actor,
      before.id,
      approving ? 'requisition.approved' : 'requisition.status_changed',
      {
        before: { status: before.status },
        after: { status: input.to, reason: statusReason },
        requestId,
      },
    );
    await notifyPeople(
      tx,
      actor,
      [before.recruiterStaffId],
      {
        kind: 'requisition.status_changed',
        title: `${before.code} ${before.title}: ${input.to.replace('_', ' ')}`,
        link: `/ops/hr/recruitment/requisitions/${before.id}`,
        entityType: 'requisition',
        entityId: before.id,
      },
      [before.createdBy],
    );
    return after as RequisitionRow;
  });
}

// --- candidates --------------------------------------------------------------------------------

/** Normalise contacts; invalid values → VALIDATION_FAILED with the field path. */
function normaliseContacts(input: { email?: string | null; phone?: string | null }) {
  const out: { email?: string | null; phone?: string | null } = {};
  if (input.email !== undefined) {
    const r = input.email?.trim() ? normaliseEmail(input.email) : null;
    if (r && !r.ok) throw fieldError('email', 'Email is not a valid address.', 'Invalid email');
    out.email = r?.ok ? r.email : null;
  }
  if (input.phone !== undefined) {
    const r = input.phone?.trim() ? normalisePhone(input.phone) : null;
    if (r && !r.ok) throw fieldError('phone', PHONE_ERROR_MESSAGES[r.reason]);
    out.phone = r?.ok ? r.e164 : null;
  }
  return out;
}

async function assertNoDuplicateCandidate(
  db: Database,
  contacts: { email?: string | null; phone?: string | null },
  exceptId?: string,
) {
  if (!contacts.email && !contacts.phone) return;
  const rows = await db
    .select({ id: opsCandidates.id, code: opsCandidates.code })
    .from(opsCandidates)
    .where(
      or(
        contacts.email ? eq(opsCandidates.email, contacts.email) : undefined,
        contacts.phone ? eq(opsCandidates.phone, contacts.phone) : undefined,
      ),
    );
  const clash = rows.find((r) => r.id !== exceptId);
  if (clash)
    throw new ConflictError(
      `A candidate with this email or phone already exists (${clash.code}); add an application to that candidate instead.`,
    );
}

type CandidateFacts = { stages: ApplicationStage[]; lastClosed: IsoDate | null };

/** Application stages per candidate and the last IST day one closed. */
async function candidateFacts(db: Database, candidateIds: readonly string[]) {
  const out = new Map<string, CandidateFacts>();
  for (const id of candidateIds) out.set(id, { stages: [], lastClosed: null });
  if (!candidateIds.length) return out;
  const apps = await db
    .select({
      candidateId: opsJobApplications.candidateId,
      stage: opsJobApplications.stage,
      closedAt: opsJobApplications.closedAt,
    })
    .from(opsJobApplications)
    .where(inArray(opsJobApplications.candidateId, candidateIds as never));
  for (const a of apps) {
    const entry = out.get(a.candidateId);
    if (!entry) continue;
    entry.stages.push(a.stage);
    if (a.closedAt) {
      const day = toIsoDate(a.closedAt, TIMEZONE);
      if (!entry.lastClosed || day > entry.lastClosed) entry.lastClosed = day;
    }
  }
  return out;
}

/** True when any of the applications has a live (draft…accepted) offer. */
async function hasLiveOffer(db: Database, applicationIds: readonly string[]) {
  if (!applicationIds.length) return false;
  const [live] = await db
    .select({ id: opsJobOffers.id })
    .from(opsJobOffers)
    .where(
      and(
        inArray(opsJobOffers.applicationId, applicationIds as never),
        inArray(opsJobOffers.status, LIVE_OFFER_STATUSES),
      ),
    )
    .limit(1);
  return Boolean(live);
}

export async function listCandidates(db: Database, actor: Actor, q: CandidateListQuery) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:read');
  const settings = await loadSettings(db);
  const retentionDays = settings['hr.candidate_retention'].value.retainUnsuccessfulDays;
  if (cov.scope === 'own' && cov.candidateIds.size === 0)
    return { ...pageOf(q, []), retentionDays };
  const sortCol = {
    code: opsCandidates.code,
    name: opsCandidates.fullName,
    updated: opsCandidates.updatedAt,
  }[q.sort];
  // Retention filtering needs every in-scope candidate's application facts (bounded).
  const found = await db
    .select({
      id: opsCandidates.id,
      code: opsCandidates.code,
      fullName: opsCandidates.fullName,
      source: opsCandidates.source,
      status: opsCandidates.status,
      recruiterStaffId: opsCandidates.recruiterStaffId,
      updatedAt: opsCandidates.updatedAt,
    })
    .from(opsCandidates)
    .where(
      and(
        cov.scope === 'own' ? inArray(opsCandidates.id, [...cov.candidateIds] as never) : undefined,
        q.status ? eq(opsCandidates.status, q.status) : undefined,
        q.q ? search(q.q, opsCandidates.fullName, opsCandidates.code) : undefined,
      ),
    )
    .orderBy(sortBy(q.dir, sortCol), asc(opsCandidates.code))
    .limit(5000);
  const facts = await candidateFacts(
    db,
    found.map((c) => c.id),
  );
  const today = istToday(new Date());
  const rows = found
    .map((c) => {
      const f = facts.get(c.id)!;
      const unsuccessful =
        c.status === 'active' && f.stages.length > 0 && f.stages.every(isUnsuccessful);
      return {
        ...c,
        applications: f.stages.length,
        openApplications: f.stages.filter(isOpenApplication).length,
        retention: unsuccessful ? retentionStatus(f.lastClosed, retentionDays, today) : null,
      };
    })
    .filter((r) => q.retention !== 'due' || r.retention === 'due');
  const names = await staffNames(
    db,
    rows.map((r) => r.recruiterStaffId),
  );
  const pageRows = rows
    .slice(offsetOf(q), offsetOf(q) + q.pageSize)
    .map((r) => ({ ...r, recruiterName: nameOf(names, r.recruiterStaffId) }));
  return { ...pageOf(q, pageRows, rows.length), retentionDays };
}

export async function getCandidate(db: Database, actor: Actor, id: string) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:read');
  const c = await rowById(db, opsCandidates, id, 'Candidate');
  if (!readsCandidate(cov, c.id)) deny('candidates');
  const showContacts = can(actor, 'ops:recruitment:manage') && managesCandidate(cov, c.id);
  const apps = await db
    .select({
      id: opsJobApplications.id,
      stage: opsJobApplications.stage,
      stageChangedAt: opsJobApplications.stageChangedAt,
      closedAt: opsJobApplications.closedAt,
      requisitionId: opsRequisitions.id,
      requisitionCode: opsRequisitions.code,
      requisitionTitle: opsRequisitions.title,
    })
    .from(opsJobApplications)
    .innerJoin(opsRequisitions, eq(opsRequisitions.id, opsJobApplications.requisitionId))
    .where(eq(opsJobApplications.candidateId, c.id))
    .orderBy(desc(opsJobApplications.createdAt));
  const settings = await loadSettings(db);
  const facts = (await candidateFacts(db, [c.id])).get(c.id)!;
  const eligibility = anonymisationEligibility({
    status: c.status,
    stages: facts.stages,
    hasLiveOffer: await hasLiveOffer(
      db,
      apps.map((a) => a.id),
    ),
  });
  const names = await staffNames(db, [c.recruiterStaffId]);
  return {
    candidate: {
      id: c.id,
      code: c.code,
      fullName: c.fullName,
      source: c.source,
      sourceDetail: showContacts ? c.sourceDetail : null,
      status: c.status,
      recruiterStaffId: c.recruiterStaffId,
      recruiterName: nameOf(names, c.recruiterStaffId),
      privacyNoticeAt: c.privacyNoticeAt,
      consentNote: showContacts ? c.consentNote : null,
      anonymisedAt: c.anonymisedAt,
      createdAt: c.createdAt,
    },
    /** null = not shown to this user (sensitive). */
    contacts: showContacts ? { email: c.email, phone: c.phone } : null,
    applications: apps.filter((a) => readsApplication(cov, a.id)),
    canManage: showContacts && c.status === 'active',
    anonymisation: {
      eligible: eligibility.ok,
      reason: eligibility.ok ? null : eligibility.message,
      canAnonymise: can(actor, 'ops:recruitment:decide'),
      retention: retentionStatus(
        facts.lastClosed,
        settings['hr.candidate_retention'].value.retainUnsuccessfulDays,
        istToday(new Date()),
      ),
      retentionSetting: settings['hr.candidate_retention'],
    },
    history: await entityHistory(db, 'candidate', c.id),
  };
}

export async function createCandidate(
  db: Database,
  actor: Actor,
  input: CreateCandidateInput,
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:manage');
  const recruiter = recruiterOnCreate(
    cov,
    input.recruiterStaffId,
    'You can only add candidates you recruit.',
  );
  if (recruiter) await activeStaff(db, recruiter, 'recruiterStaffId');
  const contacts = normaliseContacts({ email: input.email ?? null, phone: input.phone ?? null });
  return withTransaction(db, async (tx) => {
    await assertNoDuplicateCandidate(tx, contacts);
    const code = await nextCode(tx, 'candidate', 'ops.candidates');
    const row = (
      await tx
        .insert(opsCandidates)
        .values({
          code,
          fullName: input.fullName,
          email: contacts.email ?? null,
          phone: contacts.phone ?? null,
          source: input.source,
          sourceDetail: input.sourceDetail ?? null,
          recruiterStaffId: recruiter,
          privacyNoticeAt: input.privacyNoticeGiven ? new Date() : null,
          consentNote: input.consentNote ?? null,
          createdBy: actor.id,
        })
        .returning()
    )[0]!;
    // No contact details or consent text in the audit payload.
    await auditCandidate(tx, actor, row.id, 'candidate.created', {
      after: {
        code,
        source: row.source,
        recruiterStaffId: row.recruiterStaffId,
        hasEmail: Boolean(row.email),
        hasPhone: Boolean(row.phone),
        privacyNoticeGiven: Boolean(row.privacyNoticeAt),
      },
      requestId,
    });
    return { id: row.id, code: row.code, fullName: row.fullName, status: row.status };
  });
}

export async function updateCandidate(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateCandidateInput,
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:manage');
  if (cov.scope === 'own' && input.recruiterStaffId !== undefined)
    throw new ForbiddenError('Only HR can reassign the recruiter.');
  if (input.recruiterStaffId) await activeStaff(db, input.recruiterStaffId, 'recruiterStaffId');
  const contacts = normaliseContacts({ email: input.email, phone: input.phone });
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsCandidates, id, 'Candidate', true);
    if (!managesCandidate(cov, before.id)) deny('candidates');
    if (before.status === 'anonymised') throw new ConflictError('This candidate was anonymised.');
    await assertNoDuplicateCandidate(tx, contacts, before.id);
    const patch: Partial<typeof opsCandidates.$inferInsert> = {};
    if (input.fullName !== undefined) patch.fullName = input.fullName;
    if (contacts.email !== undefined) patch.email = contacts.email;
    if (contacts.phone !== undefined) patch.phone = contacts.phone;
    if (input.source !== undefined) patch.source = input.source;
    if (input.sourceDetail !== undefined) patch.sourceDetail = input.sourceDetail;
    if (input.recruiterStaffId !== undefined)
      patch.recruiterStaffId = input.recruiterStaffId as StaffMemberId | null;
    if (input.consentNote !== undefined) patch.consentNote = input.consentNote;
    if (input.privacyNoticeGiven && !before.privacyNoticeAt) patch.privacyNoticeAt = new Date();
    if (Object.keys(patch).length === 0) return { id: before.id, code: before.code };
    await tx.update(opsCandidates).set(patch).where(eq(opsCandidates.id, before.id));
    // Field names only: the values may be personal data.
    await auditCandidate(tx, actor, before.id, 'candidate.updated', {
      after: { fields: Object.keys(patch) },
      requestId,
    });
    return { id: before.id, code: before.code };
  });
}

/**
 * HL-A4: anonymise a closed unsuccessful candidate. Name, email, phone,
 * source detail and consent text are removed; interview feedback notes and
 * offer notes/references on their applications are cleared (recommendations
 * and every stage-history row are kept). Audited without personal data.
 */
export async function anonymiseCandidate(
  db: Database,
  actor: Actor,
  id: string,
  requestId?: string,
) {
  await recruitmentCoverage(db, actor, 'ops:recruitment:decide');
  return withTransaction(db, async (tx) => {
    const c = await rowById(tx, opsCandidates, id, 'Candidate', true);
    const apps = await tx
      .select({ id: opsJobApplications.id, stage: opsJobApplications.stage })
      .from(opsJobApplications)
      .where(eq(opsJobApplications.candidateId, c.id));
    const appIds = apps.map((a) => a.id);
    const eligibility = anonymisationEligibility({
      status: c.status,
      stages: apps.map((a) => a.stage),
      hasLiveOffer: await hasLiveOffer(tx, appIds),
    });
    if (!eligibility.ok) throw new ConflictError(eligibility.message);
    await tx
      .update(opsCandidates)
      .set({
        fullName: `Anonymised candidate (${c.code})`,
        email: null,
        phone: null,
        sourceDetail: null,
        consentNote: null,
        status: 'anonymised',
        anonymisedAt: new Date(),
        anonymisedBy: actor.id,
      })
      .where(eq(opsCandidates.id, c.id));
    if (appIds.length) {
      const interviews = await tx
        .select({ id: opsInterviews.id })
        .from(opsInterviews)
        .where(inArray(opsInterviews.applicationId, appIds));
      if (interviews.length)
        await tx
          .update(opsInterviewPanelists)
          .set({ feedbackNotes: null })
          .where(
            inArray(
              opsInterviewPanelists.interviewId,
              interviews.map((i) => i.id),
            ),
          );
      await tx
        .update(opsJobOffers)
        .set({ notes: null, compensationReference: null })
        .where(inArray(opsJobOffers.applicationId, appIds));
    }
    await auditCandidate(tx, actor, c.id, 'candidate.anonymised', {
      before: { status: c.status },
      after: { code: c.code, status: 'anonymised', applicationsKept: appIds.length },
      requestId,
    });
    return { id: c.id, code: c.code, status: 'anonymised' as const };
  });
}

// --- applications ------------------------------------------------------------------------------

export async function listApplications(db: Database, actor: Actor, q: ApplicationListQuery) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:read');
  const ids =
    q.view === 'interviewing_me'
      ? cov.interviewApplicationIds
      : cov.scope === 'own'
        ? new Set([...cov.managedApplicationIds, ...cov.interviewApplicationIds])
        : null;
  if (ids?.size === 0) return pageOf(q, []);
  const where = and(
    ids ? inArray(opsJobApplications.id, [...ids] as never) : undefined,
    q.stage ? eq(opsJobApplications.stage, q.stage) : undefined,
    q.requisitionId
      ? eq(opsJobApplications.requisitionId, q.requisitionId as RequisitionRow['id'])
      : undefined,
    q.q
      ? search(
          q.q,
          opsCandidates.fullName,
          opsCandidates.code,
          opsRequisitions.title,
          opsRequisitions.code,
        )
      : undefined,
  );
  const sortCol = {
    stage: opsJobApplications.stage,
    updated: opsJobApplications.stageChangedAt,
    candidate: opsCandidates.fullName,
  }[q.sort];
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(opsJobApplications)
    .innerJoin(opsCandidates, eq(opsCandidates.id, opsJobApplications.candidateId))
    .innerJoin(opsRequisitions, eq(opsRequisitions.id, opsJobApplications.requisitionId))
    .where(where);
  const rows = await db
    .select({
      id: opsJobApplications.id,
      stage: opsJobApplications.stage,
      stageChangedAt: opsJobApplications.stageChangedAt,
      candidateId: opsCandidates.id,
      candidateCode: opsCandidates.code,
      candidateName: opsCandidates.fullName,
      requisitionId: opsRequisitions.id,
      requisitionCode: opsRequisitions.code,
      requisitionTitle: opsRequisitions.title,
    })
    .from(opsJobApplications)
    .innerJoin(opsCandidates, eq(opsCandidates.id, opsJobApplications.candidateId))
    .innerJoin(opsRequisitions, eq(opsRequisitions.id, opsJobApplications.requisitionId))
    .where(where)
    .orderBy(sortBy(q.dir, sortCol), asc(opsJobApplications.id))
    .limit(q.pageSize)
    .offset(offsetOf(q));
  return pageOf(
    q,
    rows.map((r) => ({ ...r, interviewer: cov.interviewApplicationIds.has(r.id) })),
    total,
  );
}

/** The employee record and onboarding case a converted application produced. */
async function conversionOf(db: Database, app: ApplicationRow) {
  if (!app.employeeStaffId) return { employee: null, onboardingCase: null };
  const [employee] = await db
    .select({ staffId: opsEmployeeRecords.staffId, employeeCode: opsEmployeeRecords.employeeCode })
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.staffId, app.employeeStaffId));
  const [onboardingCase] = await db
    .select({
      id: opsLifecycleCases.id,
      code: opsLifecycleCases.code,
      status: opsLifecycleCases.status,
    })
    .from(opsLifecycleCases)
    .where(eq(opsLifecycleCases.applicationId, app.id));
  return { employee: employee ?? null, onboardingCase: onboardingCase ?? null };
}

export async function getApplication(db: Database, actor: Actor, id: string) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:read');
  const app = await rowById(db, opsJobApplications, id, 'Application');
  if (!readsApplication(cov, app.id)) deny('applications');
  /** Interviewer-only viewers see the application and their own feedback, nothing else. */
  const fullView = managesApplication(cov, app.id);
  const canManage = can(actor, 'ops:recruitment:manage') && fullView;
  const canDecide = can(actor, 'ops:recruitment:decide');
  const [cand] = await db
    .select({
      id: opsCandidates.id,
      code: opsCandidates.code,
      fullName: opsCandidates.fullName,
      status: opsCandidates.status,
    })
    .from(opsCandidates)
    .where(eq(opsCandidates.id, app.candidateId));
  const req = await rowById(db, opsRequisitions, app.requisitionId, 'Requisition');
  const stages = await db
    .select({ s: opsJobApplicationStages, actorName: users.displayName })
    .from(opsJobApplicationStages)
    .leftJoin(users, eq(users.id, opsJobApplicationStages.actorUserId))
    .where(eq(opsJobApplicationStages.applicationId, app.id))
    .orderBy(asc(opsJobApplicationStages.at), asc(opsJobApplicationStages.id));
  const interviews = await db
    .select()
    .from(opsInterviews)
    .where(eq(opsInterviews.applicationId, app.id))
    .orderBy(desc(opsInterviews.scheduledAt));
  const panel = interviews.length
    ? await db
        .select({ p: opsInterviewPanelists, fullName: staffMembers.fullName })
        .from(opsInterviewPanelists)
        .innerJoin(staffMembers, eq(staffMembers.id, opsInterviewPanelists.staffId))
        .where(
          inArray(
            opsInterviewPanelists.interviewId,
            interviews.map((i) => i.id),
          ),
        )
    : [];
  const offers = fullView
    ? await db
        .select()
        .from(opsJobOffers)
        .where(eq(opsJobOffers.applicationId, app.id))
        .orderBy(desc(opsJobOffers.createdAt))
    : [];
  const offerUsers = await userNames(
    db,
    offers.flatMap((o) => [o.preparedBy, o.approvedBy, o.extendedBy]),
  );
  const stage = app.stage;
  const { employee, onboardingCase } = await conversionOf(db, app);
  return {
    application: app,
    candidate: cand ?? null,
    requisition: {
      id: req.id,
      code: req.code,
      title: req.title,
      status: req.status,
      location: req.location,
    },
    fullView,
    canManage,
    canDecide,
    myStaffId: cov.staffId,
    stages: stages.map((s) => ({ ...s.s, actorName: s.actorName })),
    interviews: interviews.map((i) => ({
      ...i,
      panel: panel
        .filter((p) => p.p.interviewId === i.id)
        .map((p) => {
          const mine = p.p.staffId === cov.staffId;
          // Recommendations are decisions (all-scope readers see them); the free-text
          // notes go only to recruitment managers covering the application or the author.
          return {
            staffId: p.p.staffId,
            fullName: p.fullName,
            mine,
            submitted: Boolean(p.p.submittedAt),
            recommendation: fullView || mine ? p.p.recommendation : null,
            feedbackNotes: canManage || mine ? p.p.feedbackNotes : null,
            submittedAt: p.p.submittedAt,
          };
        }),
    })),
    offers: offers.map((o) => ({
      ...o,
      notes: canManage ? o.notes : null,
      compensationReference: canManage ? o.compensationReference : null,
      preparedByName: nameOf(offerUsers, o.preparedBy),
      approvedByName: nameOf(offerUsers, o.approvedBy),
      targets: permitted(
        OFFER_STATUSES,
        (to) =>
          checkOfferTransition(o.status, to, {
            canDecide,
            actorIsPreparer: o.preparedBy === actor.id,
            reason: 'x',
          }),
        canDecide,
        canManage,
      ),
    })),
    allowedTargets: permitted(
      applicationTargets(stage, canDecide),
      (to) => checkApplicationTransition(stage, to, { canDecide, reason: 'x' }),
      canDecide,
      canManage,
    ),
    canCreateOffer: canManage && stage === 'offer' && !offers.some((o) => isLiveOffer(o.status)),
    canSchedule: canManage && stage === 'interview',
    canConvert:
      canDecide &&
      stage === 'offer' &&
      offers.some((o) => o.status === 'accepted') &&
      !app.employeeStaffId,
    employee,
    onboardingCase,
    history: fullView ? await entityHistory(db, 'job_application', app.id) : [],
  };
}

export async function createApplication(
  db: Database,
  actor: Actor,
  input: { candidateId: string; requisitionId: string },
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:manage');
  return withTransaction(db, async (tx) => {
    const cand = await rowById(tx, opsCandidates, input.candidateId, 'Candidate');
    const req = await rowById(tx, opsRequisitions, input.requisitionId, 'Requisition');
    if (!managesRequisition(cov, req.id) && !managesCandidate(cov, cand.id))
      deny('candidates and requisitions');
    if (cand.status !== 'active') throw new ConflictError('This candidate was anonymised.');
    if (req.status !== 'open')
      throw new ConflictError(`${req.code} is not open for applications (${req.status}).`);
    const [dup] = await tx
      .select({ id: opsJobApplications.id })
      .from(opsJobApplications)
      .where(
        and(
          eq(opsJobApplications.candidateId, cand.id),
          eq(opsJobApplications.requisitionId, req.id),
        ),
      );
    if (dup) throw new ConflictError(`${cand.code} has already applied to ${req.code}.`);
    const row = (
      await tx
        .insert(opsJobApplications)
        .values({ candidateId: cand.id, requisitionId: req.id, createdBy: actor.id })
        .returning()
    )[0]!;
    await tx.insert(opsJobApplicationStages).values({
      applicationId: row.id,
      fromStage: null,
      toStage: 'applied',
      reason: 'Application recorded',
      actorUserId: actor.id,
    });
    await auditApplication(tx, actor, row.id, 'job_application.created', {
      after: { candidateCode: cand.code, requisitionCode: req.code, stage: row.stage },
      requestId,
    });
    return row;
  });
}

/** Write a stage change + history row (shared by transitions and the conversion). */
async function writeStage(
  tx: Database,
  app: ApplicationRow,
  to: ApplicationStage,
  actorId: UserId,
  reason: string | null,
  extra: Partial<typeof opsJobApplications.$inferInsert> = {},
) {
  const now = new Date();
  const [after] = await tx
    .update(opsJobApplications)
    .set({
      stage: to,
      stageReason: reason,
      stageChangedAt: now,
      closedAt: isOpenApplication(to) ? null : now,
      ...extra,
    })
    .where(eq(opsJobApplications.id, app.id))
    .returning();
  await tx.insert(opsJobApplicationStages).values({
    applicationId: app.id,
    fromStage: app.stage,
    toStage: to,
    reason,
    actorUserId: actorId,
  });
  return after as ApplicationRow;
}

export async function transitionApplication(
  db: Database,
  actor: Actor,
  id: string,
  input: { to: ApplicationStage; reason?: string | null },
  requestId?: string,
) {
  const { canDecide, canManage, cov } = await transitionAccess(db, actor);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsJobApplications, id, 'Application', true);
    const from = before.stage;
    const check = checkApplicationTransition(from, input.to, { canDecide, reason: input.reason });
    authorise(check, canManage && managesApplication(cov, before.id), 'applications');
    if (from === 'offer' && (await hasLiveOffer(tx, [before.id])))
      throw new ConflictError('Close the live offer first (declined, withdrawn or expired).');
    const after = await writeStage(tx, before, input.to, actor.id, clean(input.reason));
    await auditApplication(
      tx,
      actor,
      before.id,
      input.to === 'rejected' || input.to === 'offer'
        ? 'job_application.decided'
        : 'job_application.stage_changed',
      {
        before: { stage: from },
        after: { stage: input.to },
        metadata: { hasReason: Boolean(input.reason?.trim()) },
        requestId,
      },
    );
    const req = await rowById(tx, opsRequisitions, before.requisitionId, 'Requisition');
    await notifyPeople(tx, actor, [req.recruiterStaffId], {
      kind: 'job_application.stage_changed',
      title: `Application for ${req.code}: ${input.to}`,
      ...applicationRef(before.id),
    });
    return after;
  });
}

// --- interviews --------------------------------------------------------------------------------

export async function scheduleInterview(
  db: Database,
  actor: Actor,
  input: CreateInterviewInput,
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:manage');
  const panelIds = [...new Set(input.interviewerStaffIds)];
  for (const s of panelIds) await activeStaff(db, s, 'interviewerStaffIds');
  return withTransaction(db, async (tx) => {
    const app = await rowById(tx, opsJobApplications, input.applicationId, 'Application', true);
    if (!managesApplication(cov, app.id)) deny('applications');
    if (app.stage !== 'interview')
      throw new ConflictError('Move the application to "Interview" before scheduling one.');
    const row = (
      await tx
        .insert(opsInterviews)
        .values({
          applicationId: app.id,
          scheduledAt: new Date(input.scheduledAt),
          durationMinutes: input.durationMinutes,
          mode: input.mode,
          location: input.location ?? null,
          createdBy: actor.id,
        })
        .returning()
    )[0]!;
    await tx
      .insert(opsInterviewPanelists)
      .values(
        panelIds.map((staffId) => ({ interviewId: row.id, staffId: staffId as StaffMemberId })),
      );
    await auditApplication(tx, actor, app.id, 'interview.scheduled', {
      after: {
        interviewId: row.id,
        scheduledAt: row.scheduledAt,
        mode: row.mode,
        panel: panelIds,
      },
      requestId,
    });
    await notifyPeople(tx, actor, panelIds, {
      kind: 'interview.assigned',
      title: 'You are on an interview panel',
      body: `Scheduled ${row.scheduledAt.toISOString()} (${row.mode}). Give your feedback after the interview.`,
      ...applicationRef(app.id),
    });
    return { ...row, panel: panelIds };
  });
}

export async function updateInterview(
  db: Database,
  actor: Actor,
  id: string,
  input: { status?: InterviewStatus; scheduledAt?: string; reason?: string | null },
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsInterviews, id, 'Interview', true);
    if (!managesApplication(cov, before.applicationId)) deny('applications');
    const from = before.status;
    if (from !== 'scheduled') throw new ConflictError(`This interview is already ${from}.`);
    const patch: Partial<typeof opsInterviews.$inferInsert> = {};
    if (input.status && input.status !== from) {
      if (!INTERVIEW_STATUS_TRANSITIONS[from].includes(input.status))
        throw new InvalidStateTransitionError(
          `An interview cannot move from ${from} to ${input.status}.`,
        );
      if ((input.status === 'cancelled' || input.status === 'no_show') && !input.reason?.trim())
        throw fieldError('reason', 'Give a reason.', 'Reason required');
      patch.status = input.status;
      patch.statusReason = clean(input.reason);
    }
    if (input.scheduledAt) patch.scheduledAt = new Date(input.scheduledAt);
    if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to change.');
    const [after] = await tx
      .update(opsInterviews)
      .set(patch)
      .where(eq(opsInterviews.id, before.id))
      .returning();
    await auditApplication(tx, actor, before.applicationId, 'interview.updated', {
      before: { interviewId: before.id, status: before.status, scheduledAt: before.scheduledAt },
      after: { interviewId: before.id, status: after?.status, scheduledAt: after?.scheduledAt },
      requestId,
    });
    return after;
  });
}

/** HL-A3: feedback by an assigned interviewer only (scope does not matter). */
export async function submitFeedback(
  db: Database,
  actor: Actor,
  interviewId: string,
  input: {
    recommendation: (typeof opsInterviewPanelists.$inferSelect)['recommendation'] & string;
    notes: string;
  },
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:read');
  return withTransaction(db, async (tx) => {
    const interview = await rowById(tx, opsInterviews, interviewId, 'Interview');
    const app = await rowById(tx, opsJobApplications, interview.applicationId, 'Application');
    const panel = await tx
      .select({ staffId: opsInterviewPanelists.staffId })
      .from(opsInterviewPanelists)
      .where(eq(opsInterviewPanelists.interviewId, interview.id));
    const allowed = feedbackAllowed({
      actorStaffId: cov.staffId,
      panelStaffIds: panel.map((p) => p.staffId),
      interviewStatus: interview.status,
      applicationStage: app.stage,
    });
    if (!allowed.ok) {
      if (allowed.code === 'NOT_INTERVIEWER') throw new ForbiddenError(allowed.message);
      throw new ConflictError(allowed.message);
    }
    const now = new Date();
    await tx
      .update(opsInterviewPanelists)
      .set({
        recommendation: input.recommendation,
        feedbackNotes: input.notes,
        submittedBy: actor.id,
        submittedAt: now,
      })
      .where(
        and(
          eq(opsInterviewPanelists.interviewId, interview.id),
          eq(opsInterviewPanelists.staffId, cov.staffId!),
        ),
      );
    // The recommendation only; feedback notes stay out of the audit log.
    await auditApplication(tx, actor, app.id, 'interview.feedback_submitted', {
      after: { interviewId: interview.id, recommendation: input.recommendation },
      requestId,
    });
    return { interviewId: interview.id, recommendation: input.recommendation, submittedAt: now };
  });
}

/** Interviews the user sits on (any scope). */
export async function listMyInterviews(db: Database, actor: Actor) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:read');
  if (!cov.staffId) return [];
  return db
    .select({
      interviewId: opsInterviews.id,
      scheduledAt: opsInterviews.scheduledAt,
      mode: opsInterviews.mode,
      status: opsInterviews.status,
      applicationId: opsJobApplications.id,
      candidateCode: opsCandidates.code,
      candidateName: opsCandidates.fullName,
      requisitionTitle: opsRequisitions.title,
      submittedAt: opsInterviewPanelists.submittedAt,
    })
    .from(opsInterviewPanelists)
    .innerJoin(opsInterviews, eq(opsInterviews.id, opsInterviewPanelists.interviewId))
    .innerJoin(opsJobApplications, eq(opsJobApplications.id, opsInterviews.applicationId))
    .innerJoin(opsCandidates, eq(opsCandidates.id, opsJobApplications.candidateId))
    .innerJoin(opsRequisitions, eq(opsRequisitions.id, opsJobApplications.requisitionId))
    .where(eq(opsInterviewPanelists.staffId, cov.staffId))
    .orderBy(desc(opsInterviews.scheduledAt))
    .limit(100);
}

// --- offers ------------------------------------------------------------------------------------

export async function createOffer(
  db: Database,
  actor: Actor,
  input: CreateOfferInput,
  requestId?: string,
) {
  const cov = await recruitmentCoverage(db, actor, 'ops:recruitment:manage');
  if (input.validUntil && input.proposedStartDate && input.validUntil > input.proposedStartDate)
    throw fieldError(
      'validUntil',
      'The offer must expire on or before the proposed start date.',
      'After the start date',
    );
  return withTransaction(db, async (tx) => {
    const app = await rowById(tx, opsJobApplications, input.applicationId, 'Application', true);
    if (!managesApplication(cov, app.id)) deny('applications');
    if (app.stage !== 'offer')
      throw new ConflictError(
        'A decider must select the candidate ("Offer") before an offer is prepared.',
      );
    if (await hasLiveOffer(tx, [app.id]))
      throw new ConflictError('This application already has a live offer.');
    const row = (
      await tx
        .insert(opsJobOffers)
        .values({
          applicationId: app.id,
          offeredTitle: input.offeredTitle,
          proposedStartDate: input.proposedStartDate ?? null,
          validUntil: input.validUntil ?? null,
          compensationReference: input.compensationReference ?? null,
          notes: input.notes ?? null,
          preparedBy: actor.id,
        })
        .returning()
    )[0]!;
    await auditApplication(tx, actor, app.id, 'offer.prepared', {
      after: {
        offerId: row.id,
        status: row.status,
        offeredTitle: row.offeredTitle,
        proposedStartDate: row.proposedStartDate,
      },
      requestId,
    });
    return row;
  });
}

export async function transitionOffer(
  db: Database,
  actor: Actor,
  id: string,
  input: { to: OfferStatus; reason?: string | null },
  requestId?: string,
) {
  const { canDecide, canManage, cov } = await transitionAccess(db, actor);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsJobOffers, id, 'Offer', true);
    const check = checkOfferTransition(before.status, input.to, {
      canDecide,
      actorIsPreparer: before.preparedBy === actor.id,
      reason: input.reason,
    });
    authorise(check, canManage && managesApplication(cov, before.applicationId), 'applications');
    const now = new Date();
    const [after] = await tx
      .update(opsJobOffers)
      .set({
        status: input.to,
        statusReason: clean(input.reason),
        ...(input.to === 'approved' ? { approvedBy: actor.id, approvedAt: now } : {}),
        ...(input.to === 'extended' ? { extendedBy: actor.id, extendedAt: now } : {}),
        ...(input.to === 'accepted' || input.to === 'declined' ? { respondedAt: now } : {}),
      })
      .where(eq(opsJobOffers.id, before.id))
      .returning();
    await auditApplication(tx, actor, before.applicationId, `offer.${input.to}`, {
      before: { offerId: before.id, status: before.status },
      after: { offerId: before.id, status: input.to },
      requestId,
    });
    if (input.to === 'approved')
      await notifyPeople(
        tx,
        actor,
        [],
        {
          kind: 'offer.approved',
          title: `Offer approved: ${before.offeredTitle}`,
          body: 'Mark it as extended once you have given it to the candidate. Elevate OS sends nothing.',
          ...applicationRef(before.applicationId),
        },
        [before.preparedBy],
      );
    return after as typeof opsJobOffers.$inferSelect;
  });
}

// --- conversion --------------------------------------------------------------------------------

/**
 * HL-A2: candidate → employee from an accepted offer, in one transaction:
 * insertEmployee (EMP-####, status onboarding), application → hired with the
 * employee link, onboarding case with the template checklist, requisition
 * filled when every opening is hired. Idempotent: the application row is
 * locked and a second call returns the employee created the first time.
 */
export async function convertCandidate(
  db: Database,
  actor: Actor,
  applicationId: string,
  input: ConvertInput,
  requestId?: string,
) {
  await recruitmentCoverage(db, actor, 'ops:recruitment:decide');
  if (input.managerStaffId) await activeStaff(db, input.managerStaffId, 'managerStaffId');
  return withTransaction(db, async (tx) => {
    const app = await rowById(tx, opsJobApplications, applicationId, 'Application', true);
    if (app.employeeStaffId) {
      const { employee, onboardingCase } = await conversionOf(tx, app);
      return {
        created: false,
        staffId: app.employeeStaffId,
        employeeCode: employee?.employeeCode ?? null,
        onboardingCaseId: onboardingCase?.id ?? null,
        onboardingCaseCode: onboardingCase?.code ?? null,
      };
    }
    if (app.stage !== 'offer')
      throw new ConflictError('Only a selected candidate with an accepted offer can be converted.');
    const [offer] = await tx
      .select()
      .from(opsJobOffers)
      .where(and(eq(opsJobOffers.applicationId, app.id), eq(opsJobOffers.status, 'accepted')));
    if (!offer)
      throw new ConflictError('Record the accepted offer before converting the candidate.');
    const cand = await rowById(tx, opsCandidates, app.candidateId, 'Candidate', true);
    if (cand.status !== 'active') throw new ConflictError('This candidate was anonymised.');
    const req = await rowById(tx, opsRequisitions, app.requisitionId, 'Requisition', true);
    const employee = await insertEmployee(
      tx,
      actor,
      {
        fullName: cand.fullName,
        workEmail: input.workEmail ?? null,
        workLocation: input.workLocation ?? req.location ?? null,
        departmentId: req.departmentId,
        title: offer.offeredTitle,
        managerId:
          (input.managerStaffId as StaffMemberId | null | undefined) ??
          req.hiringManagerStaffId ??
          null,
        employmentType: req.employmentType,
        employmentStartDate: offer.proposedStartDate,
        employmentStatus: 'onboarding',
      },
      requestId,
    );
    await writeStage(tx, app, 'hired', actor.id, `Converted to employee ${employee.employeeCode}`, {
      employeeStaffId: employee.staffId,
    });
    const kase = await openOnboardingCase(tx, actor, {
      staffId: employee.staffId,
      applicationId: app.id,
      baseDate: (offer.proposedStartDate as IsoDate | null) ?? istToday(new Date()),
      requestId,
    });
    const [{ hired } = { hired: 0 }] = await tx
      .select({ hired: sql<number>`count(*)::int` })
      .from(opsJobApplications)
      .where(
        and(eq(opsJobApplications.requisitionId, req.id), eq(opsJobApplications.stage, 'hired')),
      );
    if (req.status === 'open' && Number(hired) >= req.openings) {
      await tx
        .update(opsRequisitions)
        .set({ status: 'filled', statusReason: 'All openings hired', statusChangedAt: new Date() })
        .where(eq(opsRequisitions.id, req.id));
      await auditRequisition(tx, actor, req.id, 'requisition.status_changed', {
        before: { status: req.status },
        after: { status: 'filled', reason: 'All openings hired' },
        requestId,
      });
    }
    await auditApplication(tx, actor, app.id, 'candidate.converted', {
      after: {
        candidateCode: cand.code,
        employeeCode: employee.employeeCode,
        staffId: employee.staffId,
        onboardingCaseId: kase.id,
      },
      requestId,
    });
    return {
      created: true,
      staffId: employee.staffId,
      employeeCode: employee.employeeCode,
      onboardingCaseId: kase.id,
      onboardingCaseCode: kase.code,
    };
  });
}
