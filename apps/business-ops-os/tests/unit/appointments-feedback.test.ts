import { describe, expect, it } from 'vitest';
import {
  OPS_APPOINTMENT_MODES,
  OPS_APPOINTMENT_STATUSES,
  OPS_APPOINTMENT_TYPES,
  OPS_MODERATION_STATUSES,
} from '@elevate/database';
import {
  APPOINTMENT_MODES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  canMoveAppointment,
  findClash,
  slotsOverlap,
} from '../../src/domain/appointments';
import { MODERATION_STATUSES, canModerate, teacherFeedbackEdit } from '../../src/domain/feedback';

const t = (hhmm: string) => new Date(`2026-10-21T${hhmm}:00+05:30`);
const slot = (from: string, to: string) => ({ startsAt: t(from), endsAt: t(to) });

describe('A-MTG-1 appointment overlap (half-open intervals, same staff)', () => {
  it.each([
    ['touching end → start is allowed', '10:00', '11:00', '11:00', '12:00', 0, false],
    ['touching start → end is allowed', '11:00', '12:00', '10:00', '11:00', 0, false],
    ['partial overlap is rejected', '10:00', '11:00', '10:30', '11:30', 0, true],
    ['containment is rejected', '10:00', '12:00', '10:30', '11:00', 0, true],
    ['identical slot is rejected', '10:00', '11:00', '10:00', '11:00', 0, true],
    ['gap is allowed', '10:00', '11:00', '11:15', '12:00', 0, false],
    [
      '15-minute buffer turns a touching slot into a clash',
      '10:00',
      '11:00',
      '11:00',
      '12:00',
      15,
      true,
    ],
    ['buffer smaller than the gap is allowed', '10:00', '11:00', '11:30', '12:00', 15, false],
  ])('%s', (_name, aFrom, aTo, bFrom, bTo, buffer, clash) => {
    expect(slotsOverlap(slot(aFrom, aTo), slot(bFrom, bTo), buffer)).toBe(clash);
  });

  it.each([
    ['proposed', true],
    ['scheduled', true],
    ['confirmed', true],
    ['rescheduled', true],
    ['completed', false],
    ['cancelled', false],
  ])('an overlapping %s appointment blocks: %s', (status, blocks) => {
    const existing = [{ id: 'x', status, ...slot('10:00', '11:00') }];
    expect(Boolean(findClash(slot('10:30', '11:30'), existing))).toBe(blocks);
  });

  it('an appointment never clashes with itself (reschedule)', () => {
    const existing = [{ id: 'x', status: 'scheduled', ...slot('10:00', '11:00') }];
    expect(findClash({ id: 'x', ...slot('10:30', '11:30') }, existing)).toBeUndefined();
  });
});

describe('A-MTG-2 appointment status transitions', () => {
  it.each([
    ['scheduled', 'confirmed', true],
    ['confirmed', 'rescheduled', true],
    ['rescheduled', 'completed', true],
    ['proposed', 'cancelled', true],
    ['proposed', 'completed', false],
    ['completed', 'cancelled', false],
    ['cancelled', 'scheduled', false],
  ] as const)('%s → %s: %s', (from, to, ok) => {
    expect(canMoveAppointment(from, to)).toBe(ok);
  });

  it('domain vocabularies match the schema', () => {
    expect([...APPOINTMENT_TYPES]).toEqual([...OPS_APPOINTMENT_TYPES]);
    expect([...APPOINTMENT_STATUSES]).toEqual([...OPS_APPOINTMENT_STATUSES]);
    expect([...APPOINTMENT_MODES]).toEqual([...OPS_APPOINTMENT_MODES]);
    expect([...MODERATION_STATUSES]).toEqual([...OPS_MODERATION_STATUSES]);
  });
});

describe('A-MTG-3 feedback rules', () => {
  const row = (status: string, superseded = false) => ({ teacherStaffId: 'T', status, superseded });
  it.each([
    [
      'author edits own draft in place',
      row('draft'),
      { staffId: 'T', canManage: false },
      { ok: true, mode: 'in_place' },
    ],
    [
      'author edit of a final row becomes a new version',
      row('final'),
      { staffId: 'T', canManage: false },
      { ok: true, mode: 'new_version' },
    ],
    [
      'another teacher cannot edit',
      row('draft'),
      { staffId: 'U', canManage: false },
      { ok: false, reason: 'not_author' },
    ],
    [
      'a manager may correct',
      row('final'),
      { staffId: null, canManage: true },
      { ok: true, mode: 'new_version' },
    ],
    [
      'a superseded version is read-only',
      row('final', true),
      { staffId: 'T', canManage: false },
      { ok: false, reason: 'superseded' },
    ],
  ])('%s', (_n, r, actor, expected) => {
    expect(teacherFeedbackEdit(r, actor)).toEqual(expected);
  });

  it.each([
    ['pending', 'approve', 'M', { ok: true, to: 'approved' }],
    ['pending', 'reject', 'M', { ok: true, to: 'rejected' }],
    ['approved', 'hide', 'M', { ok: true, to: 'hidden' }],
    ['hidden', 'approve', 'M', { ok: true, to: 'approved' }],
    ['rejected', 'approve', 'M', { ok: false, reason: 'illegal' }],
    ['pending', 'approve', 'T', { ok: false, reason: 'own_feedback' }],
  ] as const)('moderation %s + %s by %s', (from, action, staffId, expected) => {
    expect(canModerate(from, action, { staffId }, 'T')).toEqual(expected);
  });
});
