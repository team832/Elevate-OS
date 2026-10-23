/**
 * Shared setup for the student-feedback-about-teachers tests: one fictional person per role,
 * an HR manager who also teaches, a teacher with staff code DEMO-T01 (and DEMO-T02 for the HR
 * teacher), a sample student with admission number SAMPLE-ADM-1, Academic stubbed with batch
 * SAMPLE-B1 · Quant, attachments in a temp folder, and route helpers.
 */
import { afterAll, beforeAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authedRequest, callRoute, type setupTestDatabase } from '@elevate/testing';
import {
  opsAdmissions,
  opsLeads,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  students,
} from '@elevate/database';
import * as aboutTeachers from '../../src/app/api/v1/feedback/about-teachers/route';
import * as moderateRoute from '../../src/app/api/v1/feedback/about-teachers/[id]/route';
import * as importsRoute from '../../src/app/api/v1/feedback/imports/route';
import * as importAction from '../../src/app/api/v1/feedback/imports/[id]/[action]/route';
import * as importRoute from '../../src/app/api/v1/feedback/imports/[id]/route';
import * as summariesRoute from '../../src/app/api/v1/feedback/summaries/route';
import * as summaryRoute from '../../src/app/api/v1/feedback/summaries/[id]/route';
import { stubAcademic } from './academic-stub';
import { setupReference, staffUser, type StaffUser } from './fixtures';

export const ROLES = [
  'hr_manager',
  'operations_manager',
  'academic_coordinator',
  'admissions_counsellor',
  'director',
  'auditor',
  'teacher',
] as const;
export type Role = (typeof ROLES)[number];
export const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
export const ADMISSION_NUMBER = 'SAMPLE-ADM-1';

export function call<T>(
  route: { [k: string]: unknown },
  method: string,
  who: StaffUser,
  url: string,
  json?: unknown,
  params?: Record<string, string>,
) {
  return callRoute<T>(route[method] as never, authedRequest(who, url, { method, json }), params);
}

export type Import = {
  id: string;
  status: string;
  rowsTotal: number;
  rowsValid: number;
  rowsInvalid: number;
  rowsDuplicate: number;
  sourceFile?: { stored: boolean };
};
type Summary = {
  id: string;
  status: string;
  responseCount: number;
  categoryMeans: Record<string, number>;
};

export function feedbackFixtures(ctx: ReturnType<typeof setupTestDatabase>) {
  const f = {} as {
    u: Record<Role, StaffUser>;
    teacherB: StaffUser;
    /** Non-teaching HR manager feedback may still be about (staff code DEMO-T02; M2 rules). */
    hrSubject: StaffUser;
    /** Non-teaching HR manager sharing the name "Sample Twin" with a teacher (ambiguous name). */
    hrTwin: StaffUser;
    /** HR managers who teach (teacher role / a subject capability): conflicted, no access. */
    hrWhoTeaches: StaffUser;
    hrWithSubject: StaffUser;
    studentId: string;
  };
  const dir = mkdtempSync(path.join(os.tmpdir(), 'elevate-feedback-'));
  const m = {
    status: 'missing',
    value: null,
    reason: 'Sample',
    definition: 'Sample',
    window: PERIOD,
    unit: 'count',
  };

  beforeAll(async () => {
    vi.stubEnv('ATTACHMENTS_DIR', dir);
    await setupReference(ctx.db);
    f.u = Object.fromEntries(
      await Promise.all(
        ROLES.map(async (r) => [r, await staffUser(ctx.db, [r], { name: `Sample ${r}` })] as const),
      ),
    ) as Record<Role, StaffUser>;
    f.teacherB = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher B' });
    f.hrSubject = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Subject' });
    f.hrTwin = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample Twin' });
    f.hrWhoTeaches = await staffUser(ctx.db, ['hr_manager', 'teacher'], {
      name: 'Sample HR Who Teaches',
    });
    f.hrWithSubject = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR With Subject' });
    await ctx.db
      .insert(opsStaffSubjectCapabilities)
      .values({ staffId: f.hrWithSubject.staffId, subject: 'Sample Quant' });
    await staffUser(ctx.db, ['teacher'], { name: 'Sample Twin' });
    await ctx.db.insert(opsStaffProfiles).values([
      { staffId: f.u.teacher.staffId, staffCode: 'DEMO-T01' },
      { staffId: f.hrSubject.staffId, staffCode: 'DEMO-T02' },
    ]);
    const [student] = await ctx.db
      .insert(students)
      .values({ fullName: 'Sample Respondent Asha', isSample: true })
      .returning();
    f.studentId = student!.id;
    const [lead] = await ctx.db
      .insert(opsLeads)
      .values({
        code: 'LEAD-090001',
        studentName: 'Sample Respondent Asha',
        firstReceivedAt: new Date(),
        studentEmail: 'sample-asha@example.test',
        createdBy: f.u.hr_manager.id,
      })
      .returning();
    await ctx.db.insert(opsAdmissions).values({
      code: 'ADM-090001',
      leadId: lead!.id,
      studentId: student!.id,
      admissionNumber: ADMISSION_NUMBER,
      createdBy: f.u.hr_manager.id,
    });
    stubAcademic({
      activity: (url: URL) => ({
        contract: 'academic.teacher_activity',
        version: 1,
        generatedAt: new Date().toISOString(),
        staffId: url.pathname.split('/').at(-2),
        window: PERIOD,
        assignments: [
          {
            batchCode: 'SAMPLE-B1',
            subjectName: 'Quant',
            role: 'primary',
            startDate: null,
            endDate: null,
          },
        ],
        sessions: { planned: m, delivered: m, cancelled: m, substituted: m },
        logsPending: m,
        attendancePending: m,
        markingPending: m,
        reviews: { submitted: m, draft: m },
        unavailability: [],
      }),
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const hr = () => f.u.hr_manager;
  return {
    f,
    /** HR records one response (defaults: teacher DEMO-T01, September, batch SAMPLE-B1). */
    record: (json: object = {}, who: StaffUser = hr()) =>
      call<{ id: string; moderationStatus: string }>(
        aboutTeachers,
        'POST',
        who,
        '/ops/api/v1/feedback/about-teachers',
        {
          teacherStaffId: f.u.teacher.staffId,
          submittedByKind: 'student',
          feedbackOn: '2026-09-20',
          periodStart: PERIOD.from,
          periodEnd: PERIOD.to,
          batch: 'SAMPLE-B1|Quant',
          collectionMethod: 'form',
          rating: 3,
          comment: 'Sample raw comment naming Asha.',
          ...json,
        },
      ),
    moderate: (id: string, json: object, who: StaffUser = hr()) =>
      call(moderateRoute, 'PATCH', who, `/ops/api/v1/feedback/about-teachers/${id}`, json, { id }),
    newSummary: (json: object = {}, who: StaffUser = hr()) =>
      call<Summary>(summariesRoute, 'POST', who, '/ops/api/v1/feedback/summaries', {
        teacherStaffId: f.u.teacher.staffId,
        periodStart: PERIOD.from,
        periodEnd: PERIOD.to,
        ...json,
      }),
    patchSummary: (id: string, json: object, who: StaffUser = hr()) =>
      call<Summary>(summaryRoute, 'PATCH', who, `/ops/api/v1/feedback/summaries/${id}`, json, {
        id,
      }),
    upload: (content: string, name = 'sample-feedback.csv', who: StaffUser = hr()) =>
      call<Import>(importsRoute, 'POST', who, '/ops/api/v1/feedback/imports', { name, content }),
    /** Preview again with another column mapping. */
    remap: (id: string, mapping: Record<string, string>, who: StaffUser = hr()) =>
      call<Import>(
        importRoute,
        'PATCH',
        who,
        `/ops/api/v1/feedback/imports/${id}`,
        { columns: Object.keys(mapping), fields: { ...Object.values(mapping) } },
        { id },
      ),
    act: (id: string, action: string, json: object = {}, who: StaffUser = hr()) =>
      call<Import>(
        importAction,
        'POST',
        who,
        `/ops/api/v1/feedback/imports/${id}/${action}`,
        json,
        {
          id,
          action,
        },
      ),
  };
}
