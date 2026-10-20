/**
 * HR sources of the approvals inbox: each lists the item for another approver,
 * never for the person who requested it or whom it is about, and a user without
 * the source's permission does not get the source at all.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PgTable } from 'drizzle-orm/pg-core';
import { setupTestDatabase } from '@elevate/testing';
import {
  opsAttendanceCorrections,
  opsCandidates,
  opsCompensationRecords,
  opsEmployeeDocuments,
  opsJobApplications,
  opsJobOffers,
  opsLeaveRequests,
  opsLeaveTypes,
  opsLifecycleCases,
  opsRequisitions,
} from '@elevate/database';
import { listApprovalInbox } from '../../src/server/approvals';
import { setupReference } from './fixtures';
import { employeeUser, type EmployeeUser } from './hr-records-fixtures';

const ctx = setupTestDatabase();
let hr: EmployeeUser; // the "self": requester, preparer or subject of every item
let hr2: EmployeeUser; // another HR manager: may decide every item
let staff: EmployeeUser; // plain employee: holds none of the source permissions
let seeded: Record<string, string>;

/** Insert one row and return it. */
const insert = async <T extends PgTable>(table: T, values: T['$inferInsert']) =>
  (
    await ctx.db
      .insert(table)
      .values(values as never)
      .returning()
  )[0] as T['$inferSelect'];

beforeAll(async () => {
  await setupReference(ctx.db);
  hr = await employeeUser(ctx.db, ['hr_manager', 'employee']);
  hr2 = await employeeUser(ctx.db, ['hr_manager', 'employee']);
  staff = await employeeUser(ctx.db, ['employee']);
  const type = await insert(opsLeaveTypes, {
    code: 'TEST_CL',
    name: 'Casual (test)',
    paid: true,
    createdBy: hr2.id,
  });
  const req = await insert(opsRequisitions, {
    code: 'REQ-9001',
    title: 'Tutor (test)',
    employmentType: 'full_time',
    createdBy: hr.id,
  });
  const cand = await insert(opsCandidates, {
    code: 'CAND-90001',
    fullName: 'Cand Test (fictional)',
    source: 'referral',
    createdBy: hr.id,
  });
  const app = await insert(opsJobApplications, {
    candidateId: cand.id,
    requisitionId: req.id,
    createdBy: hr.id,
  });
  const at = (h: number) => new Date(Date.UTC(2026, 9, 12, h));
  seeded = {
    'ops.leave_requests': (
      await insert(opsLeaveRequests, {
        code: 'LVR-900001',
        staffId: hr.staffId,
        leaveTypeId: type.id,
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        workingDays: '1',
        requestedBy: hr.id,
      })
    ).id,
    'ops.attendance_corrections': (
      await insert(opsAttendanceCorrections, {
        code: 'ATC-900001',
        staffId: hr.staffId,
        workDate: '2026-10-12',
        proposedClockInAt: at(5),
        proposedClockOutAt: at(12),
        reason: 'Forgot to clock in (test)',
        requestedBy: hr.id,
      })
    ).id,
    'ops.requisitions': req.id,
    'ops.job_offers': (
      await insert(opsJobOffers, {
        applicationId: app.id,
        offeredTitle: 'Tutor (test)',
        preparedBy: hr.id,
      })
    ).id,
    // About `hr` (the employee may never approve their own case), opened by hr2.
    'ops.lifecycle_cases': (
      await insert(opsLifecycleCases, {
        code: 'HRC-90001',
        kind: 'onboarding',
        staffId: hr.staffId,
        openedBy: hr2.id,
      })
    ).id,
    'ops.compensation_drafts': (
      await insert(opsCompensationRecords, {
        staffId: staff.staffId,
        basis: 'monthly',
        amountPaise: 100,
        effectiveFrom: '2026-11-01',
        createdBy: hr.id,
      })
    ).id,
    'ops.document_deletions': (
      await insert(opsEmployeeDocuments, {
        staffId: staff.staffId,
        kind: 'agreement',
        title: 'Agreement (test)',
        storageKind: 'reference',
        externalReference: 'HR cabinet (test)',
        uploadedBy: hr.id,
        status: 'deletion_requested',
        deletionRequestedBy: hr.id,
        deletionRequestedAt: new Date(),
        deletionReason: 'Duplicate (test)',
      })
    ).id,
  };
});

const ids = async (user: EmployeeUser, key: string) =>
  (await listApprovalInbox(ctx.db, user)).sources
    .find((s) => s.key === key)
    ?.items.map((i) => i.id);

describe('approvals inbox — HR sources', () => {
  it.each([
    'ops.leave_requests',
    'ops.attendance_corrections',
    'ops.requisitions',
    'ops.job_offers',
    'ops.lifecycle_cases',
    'ops.compensation_drafts',
    'ops.document_deletions',
  ])('%s: listed for another approver, never for the requester or subject', async (key) => {
    const id = seeded[key]!;
    expect(await ids(hr2, key)).toContain(id);
    expect(await ids(hr, key)).not.toContain(id);
    expect(await ids(staff, key)).toBeUndefined();
  });

  it('every HR source loads (none unavailable) and a lifecycle case shows its open items', async () => {
    const inbox = await listApprovalInbox(ctx.db, hr2);
    expect(inbox.unavailable).toBe(0);
    const lifecycle = inbox.sources.find((s) => s.key === 'ops.lifecycle_cases')?.items[0];
    expect(lifecycle).toMatchObject({
      ready: true,
      link: expect.stringMatching(/^\/ops\/hr\/onboarding\//),
    });
  });
});
