/**
 * A notice must open for whoever gets it (FLA-006). Links are shaped per recipient: the page when
 * they pass its gate, else the same page in their own workspace, else their own workspace's home.
 * Fictional data only.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { can } from '@elevate/authorization';
import { notifications, opsAdmissions, opsLeads, type Database } from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { enrolmentKeys } from '@elevate/shared-contracts';
import { setupTestDatabase } from '@elevate/testing';
import type { RoleKey } from '@elevate/shared-types';
import { notifyTeachers } from '../../src/server/demos-common';
import { processEnrolmentReplies } from '../../src/server/enrolment';
import { openNotification } from '../../src/server/notification-open';
import { linkFor } from '../../src/server/task-links';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const person = (role: RoleKey) => staffUser(ctx.db, [role], { name: `Sample ${role}` });
const notesOf = (u: StaffUser, kind: string) => ctx.db.select().from(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.kind, kind)));
const opens = async (u: StaffUser, id: string) => openNotification(ctx.db, { id: u.id, roles: u.roles } as never, id);

beforeAll(() => setupReference(ctx.db));

describe('demo.booked goes to whoever teaches the class', () => {
  const demoId = crypto.randomUUID();
  it.each([
    ['teacher', '/academic'],
    ['academic_coordinator', '/ops'],
    ['marketing_contributor', '/marketing'],
    ['hr_manager', '/ops'],
    ['operations_manager', `/ops/admissions/demos/${demoId}`],
  ] as const)('%s gets %s, which opens', async (role, link) => {
    const u = await person(role);
    await notifyTeachers(db(), [u.staffId], demoId, 'Class 1 on Monday');
    const [note] = await notesOf(u, 'demo.booked');
    expect(note!.link).toBe(link);
    expect(await opens(u, note!.id)).toEqual({ href: link });
    if (link.includes('/demos/')) expect(can(u, 'ops:leads:read')).toBe(true);
  });
});

describe('enrolment replies go to the counsellor and the lead owner', () => {
  it('the counsellor gets the case; a lead owner in Marketing gets the lead in Marketing', async () => {
    const counsellor = await person('admissions_counsellor');
    const owner = await person('marketing_contributor');
    const a = await caseOf(ctx.db, counsellor.id, await identity(ctx.db, 'Sample Reply'), 'enrolment_requested', { counsellorStaffId: counsellor.staffId });
    await ctx.db.update(opsLeads).set({ ownerStaffId: owner.staffId as never }).where(eq(opsLeads.id, a.leadId));
    const { id: requestEventId } = await withTransaction(ctx.db, (tx) =>
      publishEvent(tx, {
        type: 'ops.admission.enrolment_requested',
        version: 1,
        idempotencyKey: enrolmentKeys.request(a.id, 1),
        payload: { admissionId: a.id, leadId: a.leadId, attempt: 1, programmeCode: 'CLAT', student: { fullName: 'Sample Reply', email: 'sample-reply@example.test' }, counsellorStaffId: counsellor.staffId, requestedByUserId: counsellor.id } as never,
      }),
    );
    await ctx.db.update(opsAdmissions).set({ lastRequestEventId: requestEventId as never }).where(eq(opsAdmissions.id, a.id));
    await withTransaction(ctx.db, (tx) =>
      publishEvent(tx, {
        type: 'academic.enrolment.confirmed',
        version: 1,
        idempotencyKey: enrolmentKeys.reply(requestEventId),
        payload: { requestEventId, admissionId: a.id, leadId: a.leadId, enrolmentId: crypto.randomUUID(), studentId: crypto.randomUUID(), existingStudent: false, programmeCode: 'CLAT', confirmedAt: new Date().toISOString(), confirmedByUserId: null } as never,
      }),
    );
    expect(await processEnrolmentReplies(ctx.db)).toMatchObject({ processed: 1, failed: 0 });
    const [toCounsellor] = await notesOf(counsellor, 'enrolment.confirmed');
    expect(toCounsellor!.link).toBe(`/ops/admissions/${a.id}`);
    const [toOwner] = await notesOf(owner, 'enrolment.confirmed');
    expect(toOwner!.link).toBe(`/marketing/leads/${a.leadId}`);
    expect(await opens(owner, toOwner!.id)).toEqual({ href: toOwner!.link });
  });
});

describe('linkFor: a page only some workspaces host', () => {
  it.each([
    ['teacher', 'meetings', '/meetings?open=1', '/academic/meetings?open=1'],
    ['operations_manager', 'meetings', '/meetings?open=1', '/ops/meetings?open=1'],
    ['marketing_contributor', 'meetings', '/meetings?open=1', '/marketing'],
    ['teacher', 'leads', '/leads/1', '/academic'],
    ['marketing_contributor', 'leads', '/leads/1', '/marketing/leads/1'],
    ['teacher', 'feedback', '/my-feedback', '/academic/my-feedback'],
    ['operations_manager', 'feedback', '/my-feedback', '/ops'],
  ] as const)('%s in %s: %s becomes %s', async (role, area, path, link) => {
    expect(await linkFor(ctx.db, (await person(role)).id, area, path)).toBe(link);
  });
});
