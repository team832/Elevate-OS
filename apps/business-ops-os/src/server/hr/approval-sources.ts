/**
 * HR sources of the approvals inbox (OPS-068, D-028). Each lists only what the
 * actor may decide and never their own request or their own record; they reuse
 * the HR services' listings and scope helpers so the record rules stay in one
 * place. Links go to the record where the decision is taken.
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import {
  opsCandidates,
  opsEmployeeDocuments,
  opsJobApplications,
  opsJobOffers,
  opsLifecycleCases,
  opsRequisitions,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { UserId } from '@elevate/shared-types';
import { isPrivateDocumentKind } from '../../domain/hr/documents';
import { completionGaps } from '../../domain/hr/lifecycle';
import type { ApprovalInboxItem, ApprovalSource } from '../approvals';
import { accessScope, staffIdForUser } from '../context';
import { hrCovers, hrScope } from '../hr-scope';
import { optionalScope, selfOrAllScope } from './access';
import { listCorrections } from './attendance';
import { listCompensation } from './compensation';
import { listLeaveRequests } from './leave';
import { caseItems } from './onboarding';
import { userNames } from './recruitment';

type PendingItem = Omit<
  ApprovalInboxItem,
  'requestedByName' | 'requestedAt' | 'ready' | 'blockers'
> &
  Partial<Pick<ApprovalInboxItem, 'ready' | 'blockers'>> & {
    requestedAt: Date;
    /** Shown as the requester without being one (the inbox self-guard ignores it). */
    openedBy?: UserId | null;
  };

/** Name the requesters; ready with no blockers unless the source says otherwise. */
async function toItems(db: Database, rows: PendingItem[]): Promise<ApprovalInboxItem[]> {
  const names = await userNames(
    db,
    rows.map((r) => r.requestedByUserId ?? r.openedBy),
  );
  return rows.map(({ openedBy, requestedAt, ...r }) => {
    const by = r.requestedByUserId ?? openedBy;
    return {
      ready: true,
      blockers: [],
      ...r,
      requestedAt: requestedAt.toISOString(),
      requestedByName: by ? (names.get(by) ?? null) : null,
    };
  });
}

/** Every page of a paged HR listing. */
async function allPages<T>(page: (n: number) => Promise<{ rows: T[]; total: number }>) {
  const out: T[] = [];
  for (let n = 1; ; n += 1) {
    const { rows, total } = await page(n);
    out.push(...rows);
    if (rows.length === 0 || out.length >= total) return out;
  }
}

const leaveRequests: ApprovalSource = {
  key: 'ops.leave_requests',
  label: 'Leave requests waiting for your decision',
  permission: 'ops:leave:approve',
  async list(db, actor) {
    const rows = await allPages((page) =>
      listLeaveRequests(db, actor, { view: 'to_decide', page }),
    );
    return toItems(
      db,
      rows
        .filter((r) => r.canDecide)
        .map((r) => ({
          id: r.id,
          title: `${r.code} ${r.fullName} — ${r.typeName}`,
          detail: `${r.startDate} to ${r.endDate}, ${r.workingDays} working day(s)`,
          requestedByUserId: r.requestedBy,
          requestedAt: r.createdAt,
          link: `/ops/hr/leave/${r.id}`,
        })),
    );
  },
};

const attendanceCorrections: ApprovalSource = {
  key: 'ops.attendance_corrections',
  label: 'Attendance corrections waiting for your decision',
  permission: 'ops:attendance:approve',
  async list(db, actor) {
    const rows = await allPages((page) => listCorrections(db, actor, { status: 'pending', page }));
    return toItems(
      db,
      rows
        .filter((r) => r.canDecide)
        .map((r) => ({
          id: r.id,
          title: `${r.code} ${r.fullName} — attendance correction`,
          detail: `Work date ${r.workDate}`,
          requestedByUserId: r.requestedBy,
          requestedAt: r.createdAt,
          link: `/ops/hr/attendance/corrections/${r.id}`,
        })),
    );
  },
};

const requisitions: ApprovalSource = {
  key: 'ops.requisitions',
  label: 'Job requisitions waiting to be opened',
  permission: 'ops:recruitment:decide',
  async list(db, actor) {
    await accessScope(db, actor, 'ops:recruitment:decide');
    const rows = await db
      .select()
      .from(opsRequisitions)
      .where(and(eq(opsRequisitions.status, 'draft'), ne(opsRequisitions.createdBy, actor.id)))
      .orderBy(asc(opsRequisitions.createdAt));
    return toItems(
      db,
      rows.map((r) => ({
        id: r.id,
        title: `${r.code} ${r.title}`,
        detail: `${r.openings} opening(s)`,
        requestedByUserId: r.createdBy,
        requestedAt: r.createdAt,
        link: `/ops/hr/recruitment/requisitions/${r.id}`,
      })),
    );
  },
};

const offers: ApprovalSource = {
  key: 'ops.job_offers',
  label: 'Job offers awaiting approval',
  permission: 'ops:recruitment:decide',
  async list(db, actor) {
    await accessScope(db, actor, 'ops:recruitment:decide');
    const rows = await db
      .select({ o: opsJobOffers, candidate: opsCandidates.fullName })
      .from(opsJobOffers)
      .innerJoin(opsJobApplications, eq(opsJobApplications.id, opsJobOffers.applicationId))
      .innerJoin(opsCandidates, eq(opsCandidates.id, opsJobApplications.candidateId))
      .where(and(eq(opsJobOffers.status, 'draft'), ne(opsJobOffers.preparedBy, actor.id)))
      .orderBy(asc(opsJobOffers.createdAt));
    return toItems(
      db,
      rows.map(({ o, candidate }) => ({
        id: o.id,
        title: `${candidate} — ${o.offeredTitle}`,
        detail: o.proposedStartDate ? `Proposed start ${o.proposedStartDate}` : null,
        requestedByUserId: o.preparedBy,
        requestedAt: o.createdAt,
        link: `/ops/hr/recruitment/applications/${o.applicationId}`,
      })),
    );
  },
};

const lifecycleCases: ApprovalSource = {
  key: 'ops.lifecycle_cases',
  label: 'Onboarding and separations waiting for final approval',
  permission: 'ops:lifecycle:approve',
  async list(db, actor) {
    const scope = await hrScope(db, actor, 'ops:lifecycle:approve');
    const rows = await db
      .select({ c: opsLifecycleCases, name: staffMembers.fullName })
      .from(opsLifecycleCases)
      .innerJoin(staffMembers, eq(staffMembers.id, opsLifecycleCases.staffId))
      .where(eq(opsLifecycleCases.status, 'open'))
      .orderBy(asc(opsLifecycleCases.createdAt));
    const items: PendingItem[] = [];
    for (const { c, name } of rows) {
      if (!hrCovers(scope, c.staffId) || c.staffId === scope.staffId) continue;
      const gaps = completionGaps(c.kind, await caseItems(db, c.id));
      items.push({
        id: c.id,
        title: `${c.code} ${name} — ${c.kind === 'onboarding' ? 'onboarding' : 'separation'}`,
        detail: c.lastWorkingDay ? `Last working day ${c.lastWorkingDay}` : null,
        requestedByUserId: null,
        openedBy: c.openedBy,
        requestedAt: c.createdAt,
        link: `/ops/hr/${c.kind}/${c.id}`,
        ready: gaps.length === 0,
        blockers: gaps.length ? [`Required items still open: ${gaps.join(', ')}.`] : [],
      });
    }
    return toItems(db, items);
  },
};

const compensationDrafts: ApprovalSource = {
  key: 'ops.compensation_drafts',
  label: 'Compensation drafts awaiting approval',
  permission: 'ops:compensation:approve',
  async list(db, actor) {
    const me = await staffIdForUser(db, actor.id);
    const { records } = await listCompensation(db, actor, { status: 'draft' });
    return toItems(
      db,
      records
        .filter((r) => r.createdBy !== actor.id && r.staffId !== me)
        .map((r) => ({
          id: r.id,
          title: `${r.employeeCode} ${r.fullName} — terms from ${r.effectiveFrom}`,
          detail: null,
          requestedByUserId: r.createdBy,
          requestedAt: r.createdAt,
          link: '/ops/hr/compensation?status=draft',
        })),
    );
  },
};

const documentDeletions: ApprovalSource = {
  key: 'ops.document_deletions',
  label: 'Employment document deletions to decide',
  permission: 'ops:employee_documents:manage',
  async list(db, actor) {
    const scope = await selfOrAllScope(db, actor, 'ops:employee_documents:manage');
    const priv = await optionalScope(db, actor, 'ops:employee_private:manage', 'self');
    const rows = await db
      .select({ d: opsEmployeeDocuments, name: staffMembers.fullName })
      .from(opsEmployeeDocuments)
      .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeDocuments.staffId))
      .where(eq(opsEmployeeDocuments.status, 'deletion_requested'))
      .orderBy(asc(opsEmployeeDocuments.deletionRequestedAt));
    const decidable = rows.filter(
      ({ d }) =>
        hrCovers(scope, d.staffId) &&
        d.staffId !== scope.staffId &&
        d.deletionRequestedBy !== actor.id &&
        (!isPrivateDocumentKind(d.kind) || (priv !== null && hrCovers(priv, d.staffId))),
    );
    return toItems(
      db,
      decidable.map(({ d, name }) => ({
        id: d.id,
        title: `${name} — ${d.title}`,
        detail: d.deletionReason,
        requestedByUserId: d.deletionRequestedBy,
        requestedAt: d.deletionRequestedAt ?? d.createdAt,
        link: `/ops/hr/employees/${d.staffId}`,
      })),
    );
  },
};

export const HR_APPROVAL_SOURCES: readonly ApprovalSource[] = [
  leaveRequests,
  attendanceCorrections,
  requisitions,
  offers,
  lifecycleCases,
  compensationDrafts,
  documentDeletions,
];
