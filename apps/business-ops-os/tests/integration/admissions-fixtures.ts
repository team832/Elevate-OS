/**
 * Fixtures for the admissions-administration tests (fees, students, handoff,
 * report). Walk a fictional lead to `admitted` through the real route
 * handlers. Everything is fictional; contacts come from the shared counter.
 */
import { expect } from 'vitest';
import { authedRequest, callRoute } from '@elevate/testing';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { POST as activity } from '../../src/app/api/v1/leads/[id]/activities/route';
import { POST as counselling } from '../../src/app/api/v1/counselling/route';
import { POST as counsellingUpdate } from '../../src/app/api/v1/counselling/[id]/route';
import { POST as transition } from '../../src/app/api/v1/admissions/[id]/transitions/route';
import { POST as check } from '../../src/app/api/v1/admissions/[id]/checks/route';
import { POST as feeApproval } from '../../src/app/api/v1/admissions/[id]/fee-approval/route';
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
  options: { programmeCode?: string; name?: string; extra?: Record<string, unknown> } = {},
) {
  n += 1;
  const lead = await callRoute<{ lead: { id: string }; admission: { id: string } }>(
    createLead,
    post(counsellor, {
      studentName: options.name ?? `Admin Test ${n} (fictional)`,
      studentPhone: phone(),
      guardianName: `Guardian ${n} (fictional)`,
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
      scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
      mode: 'phone',
    }),
  );
  expect(s.status).toBe(201);
  await callRoute(counsellingUpdate, post(counsellor, { action: 'complete', outcome: 'Joining' }), {
    id: s.data!.id,
  });
  const t = await callRoute<{ status: string }>(
    transition,
    post(counsellor, { to: 'admission_pending', reason: 'Family joins without a demo (test)' }),
    { id: admissionId },
  );
  expect(t.data?.status).toBe('admission_pending');
  return { leadId, admissionId };
}

/** `pendingCase` → checklist (two different verifiers) → fee approval by `director` → admitted. */
export async function admittedCase(
  people: { counsellor: Caller; manager: Caller; director: Caller },
  options: Parameters<typeof pendingCase>[1] = {},
) {
  const ids = await pendingCase(people.counsellor, options);
  for (const itemKey of [
    'admission_form',
    'documents_verified',
    'fee_verification_1',
    'down_payment_verified',
  ])
    expect(
      (
        await callRoute(check, post(people.counsellor, { itemKey, status: 'done' }), {
          id: ids.admissionId,
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await callRoute(
        check,
        post(people.manager, { itemKey: 'fee_verification_2', status: 'done' }),
        {
          id: ids.admissionId,
        },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await callRoute(feeApproval, post(people.counsellor, { action: 'request' }), {
        id: ids.admissionId,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await callRoute(feeApproval, post(people.director, { action: 'approve' }), {
        id: ids.admissionId,
      })
    ).status,
  ).toBe(200);
  const res = await callRoute<{ status: string }>(
    transition,
    post(people.counsellor, { to: 'admitted' }),
    { id: ids.admissionId },
  );
  expect(res.data?.status).toBe('admitted');
  return ids;
}
