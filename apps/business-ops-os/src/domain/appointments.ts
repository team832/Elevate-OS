/**
 * Counselling, meetings, events and webinars (OPS-008, owner brief §11–§12). Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-MTG-1 (overlap), A-MTG-2 (status transitions),
 * A-EVT-2 (who a message may reach), A-EVT-3 (sent vs simulated).
 * The vocabularies mirror packages/database/src/schema/ops.ts (a unit test keeps them equal).
 */

export const APPOINTMENT_TYPES = [
  'student_counselling',
  'guardian_counselling',
  'teacher_academic',
  'parent_teacher_meeting',
  'admission_follow_up',
  'demo_review',
  'event',
  'webinar',
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  student_counselling: 'Student counselling',
  guardian_counselling: 'Guardian counselling',
  teacher_academic: 'Teacher academic counselling',
  parent_teacher_meeting: 'Parent-teacher meeting',
  admission_follow_up: 'Admission follow-up',
  demo_review: 'Demo review',
  event: 'Event',
  webinar: 'Webinar',
};

/** Events and webinars target an audience (no one student needed; title required). */
export const GROUP_APPOINTMENT_TYPES = [
  'event',
  'webinar',
] as const satisfies readonly AppointmentType[];
export const isGroupType = (t: AppointmentType) =>
  (GROUP_APPOINTMENT_TYPES as readonly AppointmentType[]).includes(t);

/** Channels an event message can use (in-app reaches staff only, via notifications). */
export const MESSAGE_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * A-EVT-2: a participant may be messaged on a channel only with a known contact, consent
 * `given` with that channel allowed on EVERY case of the student (a withdrawal on one lead is
 * never overridden by another), and, for a guardian, the guardian's own consent `given`.
 * Anything unrecorded means "do not send".
 */
export function reachable(
  channel: MessageChannel,
  r: {
    contact: string | null;
    preferences: readonly { consentStatus: string; allowedChannels: readonly string[] }[];
    guardianConsent?: string;
  },
): boolean {
  return (
    Boolean(r.contact) &&
    (r.guardianConsent === undefined || r.guardianConsent === 'given') &&
    r.preferences.length > 0 &&
    r.preferences.every((p) => p.consentStatus === 'given' && p.allowedChannels.includes(channel))
  );
}

/** A-EVT-3: only a provider reference proves a send; otherwise the send was simulated. */
export const messageStatus = (providerRef: string | null) =>
  providerRef ? ('sent' as const) : ('simulated' as const);

/** Types that move the admission pipeline when the appointment is linked to an admission. */
export const PIPELINE_COUNSELLING_TYPES: readonly AppointmentType[] = [
  'student_counselling',
  'guardian_counselling',
];

export const APPOINTMENT_STATUSES = [
  'proposed',
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'rescheduled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Online, or offline at the Sikar centre (owner, 20 Oct 2026). */
export const APPOINTMENT_MODES = ['offline', 'online'] as const;
export const DEFAULT_OFFLINE_LOCATION = 'Sikar centre';

/** Statuses that occupy the staff member's time. Completed and cancelled never block. */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  'proposed',
  'scheduled',
  'confirmed',
  'rescheduled',
];

/** Legal moves. `rescheduled` = moved to a new time (still happening). */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  proposed: ['scheduled', 'confirmed', 'rescheduled', 'cancelled'],
  scheduled: ['confirmed', 'rescheduled', 'completed', 'cancelled'],
  confirmed: ['rescheduled', 'completed', 'cancelled'],
  rescheduled: ['confirmed', 'rescheduled', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const canMoveAppointment = (from: AppointmentStatus, to: AppointmentStatus) =>
  APPOINTMENT_TRANSITIONS[from].includes(to);

export interface TimeSlot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Half-open intervals [start, end): touching edges (10:00–11:00 and 11:00–12:00)
 * do not overlap. `bufferMinutes` widens the existing slot on both sides.
 */
export function slotsOverlap(a: TimeSlot, b: TimeSlot, bufferMinutes = 0): boolean {
  const pad = bufferMinutes * 60_000;
  return (
    a.startsAt.getTime() < b.endsAt.getTime() + pad &&
    b.startsAt.getTime() - pad < a.endsAt.getTime()
  );
}

/** First existing appointment of the same staff member that blocks `candidate`, if any. */
export function findClash<T extends TimeSlot & { status: string; id?: string }>(
  candidate: TimeSlot & { id?: string },
  existing: readonly T[],
  bufferMinutes = 0,
): T | undefined {
  return existing.find(
    (e) =>
      e.id !== candidate.id &&
      (BLOCKING_STATUSES as readonly string[]).includes(e.status) &&
      slotsOverlap(candidate, e, bufferMinutes),
  );
}
