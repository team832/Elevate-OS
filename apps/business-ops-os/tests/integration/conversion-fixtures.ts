/**
 * Fixtures for the conversion and student tests: a counselled lead with a booked
 * 3-session demo, and the Convert-to-admission call.
 */
import { eq } from 'drizzle-orm';
import { opsDemos, type Database } from '@elevate/database';
import { callRoute } from '@elevate/testing';
import { POST as convert } from '../../src/app/api/v1/demos/[id]/convert/route';
import { createDemo } from '../../src/server/demos';
import { pendingCase, post, type Caller } from './admissions-fixtures';
import type { StaffUser } from './fixtures';

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/** A counselled lead owned by `counsellor` with a booked demo of 3 past sessions. */
export async function demoCase(
  db: Database,
  counsellor: StaffUser,
  options: Parameters<typeof pendingCase>[1] = {},
) {
  const ids = await pendingCase(counsellor, {
    programmeCode: 'CLAT',
    ...options,
    counselledOnly: true,
  });
  await createDemo(db, counsellor, {
    admissionId: ids.admissionId,
    durationMinutes: 60,
    sessions: [-3, -2, -1].map((n) => ({ startsAt: day(n) as never, subject: 'Legal reasoning' })),
  });
  const [demo] = await db
    .select()
    .from(opsDemos)
    .where(eq(opsDemos.admissionId, ids.admissionId as never));
  return { ...ids, demoId: demo!.id };
}

export const CONVERT_BODY = {
  identityVerified: true,
  guardianConfirmation: 'confirmed',
  programmeCodes: ['CLAT'],
  deliveryMode: 'offline',
  effectiveDate: '2026-11-01',
  feePlanReference: 'test-only-plan-ref',
};

export type Converted = {
  /** The application created by the conversion. */
  id: string;
  reference: string;
  admissionId: string;
  status: string;
  studentId: string;
  extraAdmissionIds: string[];
};

export const convertDemoAs = (
  user: Caller,
  demoId: string,
  body: unknown = CONVERT_BODY,
  key?: string,
) =>
  callRoute<Converted>(convert, post(user, body, key ? { 'idempotency-key': key } : undefined), {
    id: demoId,
  });
