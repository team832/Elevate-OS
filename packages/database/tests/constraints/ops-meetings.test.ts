import { afterAll, beforeAll, describe } from 'vitest';
import {
  OPS_APPOINTMENT_STATUSES,
  OPS_APPOINTMENT_TYPES,
  OPS_PARTICIPANT_ATTENDANCE,
} from '../../src/schema/index';
import { LATER, NOW, insert, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let appointment = '';
beforeAll(async () => {
  ctx = await setup();
  appointment = await insert(ctx.pg, 'ops.appointments', appt());
});
afterAll(() => ctx.t.close());

function appt(o: Row = {}): Row {
  const { ids } = ctx;
  return {
    type: 'student_counselling',
    lead_id: ids.lead,
    starts_at: NOW,
    ends_at: LATER,
    staff_id: ids.staff,
    mode: 'offline',
    created_by: ids.user,
    ...o,
  };
}
const participant = (o: Row = {}): Row => ({
  appointment_id: appointment,
  kind: 'staff',
  staff_id: ctx.ids.staff,
  ...o,
});
const message = (o: Row = {}): Row => ({
  appointment_id: appointment,
  channel: 'email',
  body: 'Sample reminder',
  created_by: ctx.ids.user,
  ...o,
});
const user = () => ctx.ids.user;

describe('appointments', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'appointment types (OPS_APPOINTMENT_TYPES, incl. event and webinar)',
        'ops.appointments',
        OPS_APPOINTMENT_TYPES,
        'appointments_type_check',
        (v) => appt({ type: v, title: 'Sample event' }),
      ),
      vocab(
        'appointment statuses (OPS_APPOINTMENT_STATUSES)',
        'ops.appointments',
        OPS_APPOINTMENT_STATUSES,
        'appointments_status_check',
        (v) => appt({ status: v, cancel_reason: 'No-show: family did not come' }),
      ),
      variants(
        'a one-to-one meeting concerns a person; an event or webinar needs a title instead',
        'ops.appointments',
        appt,
        {
          'counselling for nobody': [{ lead_id: null }, 'appointments_has_person'],
          'event for nobody, titled': [
            { type: 'event', lead_id: null, title: 'Sample open day' },
            'ok',
          ],
          'webinar for nobody, titled': [
            { type: 'webinar', lead_id: null, title: 'Sample webinar' },
            'ok',
          ],
          'event without title': [{ type: 'event', lead_id: null }, 'appointments_group_title'],
        },
      ),
      variants('time, mode, capacity, reminder and cancellation rules', 'ops.appointments', appt, {
        'ends when it starts': [{ ends_at: NOW }, 'appointments_ends_after_start'],
        'mode bogus': [{ mode: 'bogus' }, 'appointments_mode_check'],
        'capacity 0': [{ capacity: 0 }, 'appointments_capacity_check'],
        'reminder bogus': [{ reminder_status: 'bogus' }, 'appointments_reminder_check'],
        'cancelled without reason': [{ status: 'cancelled' }, 'appointments_cancel_reason'],
      }),
    ],
  );
});

describe('participants and event messages', () => {
  runCases(
    () => ctx.pg,
    [
      variants(
        'a participant belongs to an appointment, matches its kind, and is removed with who and why',
        'ops.appointment_participants',
        participant,
        {
          'staff participant': [{}, 'ok'],
          'unknown appointment': [
            { appointment_id: crypto.randomUUID() },
            'appointment_participants_appointment_id_appointments_id_fk',
          ],
          'guardian kind with a staff ref': [
            { kind: 'guardian' },
            'appointment_participants_ref_matches_kind',
          ],
          'removed without reason': [
            { removed_at: NOW, removed_by: user },
            'appointment_participants_removed_check',
          ],
          'registration bogus': [
            { registration_status: 'bogus' },
            'appointment_participants_registration_check',
          ],
        },
      ),
      vocab(
        'participant attendance (OPS_PARTICIPANT_ATTENDANCE)',
        'ops.appointment_participants',
        OPS_PARTICIPANT_ATTENDANCE,
        'appointment_participants_attendance_check',
        (v) => participant({ attendance: v }),
      ),
      variants(
        'a message is "sent" only with a provider reference; a draft has no sender',
        'ops.event_messages',
        message,
        {
          draft: [{}, 'ok'],
          'sent with provider ref': [
            { status: 'sent', sent_by: user, sent_at: NOW, provider_ref: 'mock-batch-1' },
            'ok',
          ],
          'sent without provider ref': [
            { status: 'sent', sent_by: user, sent_at: NOW },
            'event_messages_sent_check',
          ],
          'draft with a sender': [{ sent_by: user, sent_at: NOW }, 'event_messages_sent_check'],
          'channel bogus': [{ channel: 'bogus' }, 'event_messages_channel_check'],
        },
      ),
    ],
  );
});
