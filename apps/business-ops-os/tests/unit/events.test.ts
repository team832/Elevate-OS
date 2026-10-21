/** Events, webinars and their messages (brief §12): pure rules. */
import { describe, expect, it } from 'vitest';
import {
  GROUP_APPOINTMENT_TYPES,
  isGroupType,
  messageStatus,
  reachable,
} from '../../src/domain/appointments';

const given = { consentStatus: 'given', allowedChannels: ['email', 'whatsapp'] };

describe('group types', () => {
  it.each([
    ['event', true],
    ['webinar', true],
    ['student_counselling', false],
    ['parent_teacher_meeting', false],
  ] as const)('%s → %s', (type, group) => {
    expect(isGroupType(type)).toBe(group);
    expect(GROUP_APPOINTMENT_TYPES.includes(type as never)).toBe(group);
  });
});

describe('who a message may reach (contact preferences and consent)', () => {
  it.each([
    [
      'consent given, channel allowed, contact known',
      'email',
      { contact: 'a@example.test', preferences: [given] },
      true,
    ],
    ['channel not allowed', 'sms', { contact: '+919800000001', preferences: [given] }, false],
    ['no contact on record', 'email', { contact: null, preferences: [given] }, false],
    ['no preferences recorded', 'email', { contact: 'a@example.test', preferences: [] }, false],
    [
      'consent withdrawn',
      'email',
      { contact: 'a@example.test', preferences: [{ ...given, consentStatus: 'withdrawn' }] },
      false,
    ],
    [
      'consent withdrawn on another case of the same student',
      'email',
      {
        contact: 'a@example.test',
        preferences: [given, { ...given, consentStatus: 'withdrawn' }],
      },
      false,
    ],
    [
      'guardian consent given',
      'whatsapp',
      { contact: '+919800000001', preferences: [given], guardianConsent: 'given' },
      true,
    ],
    [
      'guardian consent not recorded',
      'whatsapp',
      { contact: '+919800000001', preferences: [given], guardianConsent: 'not_recorded' },
      false,
    ],
  ] as const)('%s', (_name, channel, r, expected) => {
    expect(reachable(channel, r)).toBe(expected);
  });
});

describe('message status is never "sent" without a provider reference', () => {
  it.each([
    [null, 'simulated'],
    ['', 'simulated'],
    ['prov-123', 'sent'],
  ] as const)('%o → %s', (ref, status) => {
    expect(messageStatus(ref)).toBe(status);
  });
});
