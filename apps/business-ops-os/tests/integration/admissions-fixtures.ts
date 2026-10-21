/**
 * Fixtures for the admissions-administration tests (fees, students, handoff,
 * report). Walk a fictional lead to a confirmed admission through the real route
 * handlers. Everything is fictional; contacts come from the shared counter.
 */
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { getDb, opsAdmissions, opsApplications } from '@elevate/database';
import { authedRequest, callRoute } from '@elevate/testing';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { POST as activity } from '../../src/app/api/v1/leads/[id]/activities/route';
import { POST as counselling } from '../../src/app/api/v1/appointments/route';
import { PATCH as counsellingUpdate } from '../../src/app/api/v1/appointments/[id]/route';
import { POST as transition } from '../../src/app/api/v1/admissions/[id]/transitions/route';
import { confirmAs, signedApplication } from './application-fixtures';
import { phone } from './fixtures';

export type Caller = { token: string };

export const post = (user: Caller, json: unknown, headers?: Record<string, string>) =>
  authedRequest(user, '/ops/api/v1/x', { method: 'POST', json, headers });
export const put = (user: Caller, json: unknown) =>
  authedRequest(user, '/ops/api/v1/x', { method: 'PUT', json });
export const get = (user: Caller, path = '/ops/api/v1/x') => authedRequest(user, path);

let n = 0;

/** A fresh lead owned by `counsellor`, counselled, demo skipped → `admission_pending`. */
export async function pendingCase(
  counsellor: Caller,
  options: {
    programmeCode?: string;
    name?: string;
    extra?: Record<string, unknown>;
    /** Stop at `counselled` (e.g. to book a demo). */
    counselledOnly?: boolean;
  } = {},
) {
  n += 1;
  const lead = await callRoute<{ lead: { id: string }; admission: { id: string } }>(
    createLead,
    post(counsellor, {
      studentName: options.name ?? `Admin Test ${n}`,
      studentPhone: phone(),
      guardianName: `Guardian ${n}`,
      guardianRelationship: 'father',
      guardianPhone: phone(),
      currentStage: 'class_12',
      programmeCode: options.programmeCode ?? 'IPMAT',
      sourceCode: 'WEBINAR',
      ...options.extra,
    }),
  );
  expect(lead.status).toBe(201);
  const leadId = lead.data!.lead.id;
  const admissionId = lead.data!.admission.id;
  await callRoute(activity, post(counsellor, { kind: 'call', outcome: 'connected_two_way' }), {
    id: leadId,
  });
  const s = await callRoute<{ id: string }>(
    counselling,
    post(counsellor, {
      admissionId,
      type: 'student_counselling',
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      mode: 'online',
    }),
  );
  expect(s.status).toBe(201);
  await callRoute(counsellingUpdate, post(counsellor, { action: 'complete', outcome: 'Joining' }), {
    id: s.data!.id,
  });
  if (options.counselledOnly) return { leadId, admissionId };
  const t = await callRoute<{ status: string }>(
    transition,
    post(counsellor, { to: 'admission_pending', reason: 'Family joins without a demo (test)' }),
    { id: admissionId },
  );
  expect(t.data?.status).toBe('admission_pending');
  return { leadId, admissionId };
}

type People = { counsellor: Caller; manager: Caller; director: Caller & { password: string } };

/**
 * `pendingCase` → the real admission flow (application, fee approval, active plan, form,
 * signatures) → confirmed by `director` with their password → `enrolment_requested`.
 */
export async function admittedCase(
  people: People,
  options: Parameters<typeof pendingCase>[1] = {},
) {
  const ids = await pendingCase(people.counsellor, options);
  return { ...ids, ...(await admit(people, ids.admissionId)) };
}

/**
 * Confirm an `admission_pending` case (direct, or converted from a demo) the only way there is:
 * the password-confirmed final approval (D-040/D-041). The admission ends `enrolment_requested`;
 * `eventId` is the enrolment request published in the same transaction.
 */
export async function admit(people: People, admissionId: string) {
  const db = getDb();
  const [app] = await db
    .select({ id: opsApplications.id })
    .from(opsApplications)
    .where(eq(opsApplications.admissionId, admissionId as never));
  const s = await signedApplication(db, people, { admissionId, applicationId: app?.id });
  const res = await confirmAs(people.director, s.applicationId, {
    password: people.director.password,
    applicationVersion: s.version,
  });
  expect(res.status).toBe(201);
  const [row] = await db
    .select({ eventId: opsAdmissions.lastRequestEventId, number: opsAdmissions.admissionNumber })
    .from(opsAdmissions)
    .where(eq(opsAdmissions.id, admissionId as never));
  return {
    admissionId,
    applicationId: s.applicationId,
    eventId: row!.eventId!,
    admissionNumber: row!.number!,
  };
}
