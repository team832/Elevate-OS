/**
 * Write helpers shared by demos.ts and demos-sessions.ts: the demo audit row, teacher availability
 * and notice, session change history, and moving the case on once every class is recorded.
 */
import { eq } from 'drizzle-orm';
import { opsDemos, opsDemoSessionChanges, opsDemoSessions, type Database } from '@elevate/database';
import { notify } from '@elevate/notifications';
import { ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { ResolvedSettings } from '../domain';
import { demoAttendanceStatus } from '../domain/demos';
import { assertFree } from './appointments';
import { withMarks, type AcademicDemoMarks } from './academic-summary';
import { userIdsForStaff, type Actor } from './context';
import { createRuleFollowUp } from './follow-ups';
import { opsAudit, type AuditData } from './ops-common';
import { applyTransition, type AdmissionRow } from './pipeline';
import { loadSettings } from './settings';

type Demo = typeof opsDemos.$inferSelect;
type Session = typeof opsDemoSessions.$inferSelect;

const audit = opsAudit('demo');
/** Every demo audit row carries the lead id. */
export const auditDemo = (
  tx: Database,
  actor: Actor,
  demo: Pick<Demo, 'id' | 'leadId'>,
  action: string,
  data: AuditData,
  requestId?: string,
) =>
  audit(
    tx,
    actor,
    demo.id,
    action,
    { ...data, metadata: { leadId: demo.leadId, ...data.metadata } },
    requestId,
  );

export const must = (check: { ok: true } | { ok: false; message: string }) => {
  if (!check.ok) throw new ValidationError(check.message);
};

/** A teacher's demo class takes the appointments' per-staff lock and must not clash with their other bookings. */
export function assertTeacherFree(
  tx: Database,
  settings: ResolvedSettings,
  s: { id?: string; teacherStaffId: string | null; startsAt: Date; endsAt: Date | null },
) {
  if (!s.teacherStaffId) return;
  const rule = settings['appointments.scheduling'].value;
  const endsAt = s.endsAt ?? new Date(+s.startsAt + rule.defaultDurationMinutes * 60_000);
  return assertFree(tx, [s.teacherStaffId as StaffMemberId], { ...s, endsAt }, rule, s.id);
}

export async function notifyTeachers(
  tx: Database,
  staffIds: readonly (string | null)[],
  demoId: string,
  body: string,
) {
  const userIds = await userIdsForStaff(tx, staffIds);
  if (userIds.length)
    await notify(tx, {
      userIds,
      module: 'ops',
      kind: 'demo.booked',
      title: 'Demo class booked',
      body,
      link: `/ops/admissions/demos/${demoId}`,
      entityType: 'demo',
      entityId: demoId,
    });
}

/** Session fields whose every change is kept in ops.demo_session_changes. */
const TRACKED = [
  ['attendance', (s: Session) => s.attendance],
  ['schedule', (s: Session) => s.startsAt.toISOString()],
  [
    'mock',
    (s: Session) => (s.mockAttemptRef ? `${s.mockStatus} (${s.mockAttemptRef})` : s.mockStatus),
  ],
  ['teacher', (s: Session) => s.teacherStaffId],
  // The role is its own history row; `teacher` is the field the schema allows (OPS_DEMO_SESSION_FIELDS).
  ['teacher', (s: Session) => (s.isSubstitute ? 'Substitute' : 'Planned teacher')],
] as const;

export async function logChanges(
  tx: Database,
  before: Session,
  after: Session,
  actor: Actor,
  reason?: string | null,
) {
  const rows = TRACKED.map(([field, get]) => ({
    field,
    previousValue: get(before),
    newValue: get(after),
  }))
    .filter((r) => r.previousValue !== r.newValue)
    .map((r) => ({
      ...r,
      sessionId: before.id,
      reason: reason?.trim() || null,
      actorUserId: actor.id,
    }));
  if (rows.length) await tx.insert(opsDemoSessionChanges).values(rows);
}

/**
 * After a session change: stamp `completed_at` once every session has a final
 * attendance; when an open demo becomes fully attended, move the case
 * demo_scheduled → demo_attended and add the demo follow-up (A-05). A linked class counts with
 * Academic's mark (R15); while Academic cannot be read, a demo with a known-linked class waits.
 */
export async function syncDemo(
  tx: Database,
  actor: Actor,
  demo: Demo,
  admission: AdmissionRow,
  marks: AcademicDemoMarks,
  requestId?: string,
) {
  const rows = await tx.select().from(opsDemoSessions).where(eq(opsDemoSessions.demoId, demo.id));
  if (marks.status === 'unavailable' && rows.some((r) => r.academicSessionRef)) return;
  const sessions = withMarks(rows, marks);
  const status = demoAttendanceStatus(demo.outcome, sessions);
  const finished = status === 'attended' || status === 'missed';
  await tx
    .update(opsDemos)
    .set({ completedAt: finished ? (demo.completedAt ?? new Date()) : null })
    .where(eq(opsDemos.id, demo.id));
  if (demo.outcome !== 'open' || status !== 'attended') return;
  if (admission.status !== 'demo_scheduled') return;
  const settings = await loadSettings(tx);
  await applyTransition(tx, {
    admission,
    to: 'demo_attended',
    actorUserId: actor.id,
    reason: 'All demo classes recorded',
    requestId,
    settings,
  });
  await createRuleFollowUp(tx, {
    trigger: 'demo_attended',
    eventAt: new Date(),
    leadId: admission.leadId,
    admissionId: admission.id,
    ownerStaffId: admission.counsellorStaffId ?? demo.counsellorStaffId,
    settings,
    createdBy: actor.id,
  });
}
