import { describe, expect, it } from 'vitest';
import { checkReasonCode, type AdmissionStatus, type KpiWindow } from '../../src/domain';
import { SETTING_DEFINITIONS } from '../../src/domain/policies';
import {
  academicStudentPath,
  deriveHandoffView,
  directoryState,
  redactStudentPrivate,
  retryDecision,
  stripPrivateKeys,
  type HandoffInput,
} from '../../src/domain/students';
import {
  admissionsByStatus,
  closuresByReason,
  handoffOutcomes,
  leadsBySource,
  newEnquiries,
  overdueFollowUps,
  pendingCounselling,
  pendingDecisions,
  upcomingDemos,
} from '../../src/domain/admissions-kpis';

const codes = SETTING_DEFINITIONS['admissions.closure_reasons'].defaultValue.codes.map(
  (c) => c.code,
);
const reason = (from: AdmissionStatus, to: AdmissionStatus, code: string | null, extra = {}) =>
  checkReasonCode({ from, to, code, allowed: codes, requireCode: false, actor: 'user', ...extra });

describe('closure reason codes', () => {
  it('only closing takes a code; codes must be configured', () => {
    expect(reason('contacted', 'lost', 'chose_competitor')).toEqual({
      ok: true,
      code: 'chose_competitor',
    });
    expect(reason('contacted', 'lost', null)).toEqual({ ok: true, code: null });
    expect(reason('contacted', 'lost', 'made_up')).toMatchObject({ ok: false });
    expect(reason('contacted', 'on_hold', 'other')).toMatchObject({ ok: false });
    expect(reason('contacted', 'on_hold', null)).toEqual({ ok: true, code: null });
  });
  it('withdrawal applies only to admitted cases (directly or on hold from admitted)', () => {
    expect(reason('admitted', 'lost', 'withdrawn_after_admission').ok).toBe(true);
    expect(
      reason('on_hold', 'lost', 'withdrawn_after_admission', { heldFromStatus: 'admitted' }).ok,
    ).toBe(true);
    expect(
      reason('on_hold', 'lost', 'withdrawn_after_admission', { heldFromStatus: 'counselled' }).ok,
    ).toBe(false);
    expect(reason('admission_pending', 'lost', 'withdrawn_after_admission').ok).toBe(false);
  });
  it('the merge-only code is refused for people; requireCode makes a code mandatory (not for merges)', () => {
    expect(reason('new', 'lost', 'duplicate_merged').ok).toBe(false);
    expect(reason('new', 'lost', 'duplicate_merged', { viaMerge: true }).ok).toBe(true);
    expect(reason('new', 'lost', null, { requireCode: true }).ok).toBe(false);
    expect(reason('new', 'lost', null, { requireCode: true, viaMerge: true }).ok).toBe(true);
  });
  it('the setting is proposed, not approved', () => {
    expect(SETTING_DEFINITIONS['admissions.closure_reasons'].defaultState).toBe('proposed');
    expect(SETTING_DEFINITIONS['fees.schedule'].defaultState).toBe('open');
    expect(SETTING_DEFINITIONS['fees.recording'].ownerDecision).toBe('OD-013');
  });
});

describe('student identity and directory', () => {
  it('a student is an admission that reached admitted (withdrawn only if admitted first)', () => {
    const now = new Date();
    for (const [status, admittedAt, state] of [
      ['admitted', now, 'admitted'],
      ['enrolment_requested', now, 'awaiting_enrolment'],
      ['enrolled', now, 'enrolled'],
      ['lost', now, 'withdrawn'],
      ['lost', null, null],
      ['admission_pending', null, null],
    ] as const)
      expect(directoryState({ status, admittedAt })).toBe(state);
  });
  it('links to the Academic record only when Academic returned an id', () => {
    expect(academicStudentPath('abc')).toBe('/academic/students/abc');
    expect(academicStudentPath(null)).toBeNull();
  });
  it('private fields are removed (deeply in audit payloads) unless allowed', () => {
    const rec = {
      fullName: 'A (fictional)',
      studentPhone: '+919800000000',
      guardianName: 'G (fictional)',
    };
    expect(redactStudentPrivate(rec, false)).toEqual({
      fullName: 'A (fictional)',
      privateFields: 'hidden',
    });
    expect(redactStudentPrivate(rec, true)).toMatchObject({
      studentPhone: '+919800000000',
      privateFields: 'visible',
    });
    expect(
      stripPrivateKeys({
        after: { studentEmail: 'x@example.test', code: 'L1' },
        list: [{ guardianPhone: '1' }],
      }),
    ).toEqual({
      after: { code: 'L1' },
      list: [{}],
    });
    expect(stripPrivateKeys(null)).toBeNull();
  });
});

describe('handoff view and retry rule', () => {
  const base: HandoffInput = {
    status: 'enrolment_requested',
    handoffStatus: 'pending',
    enrolmentAttempt: 1,
    academicDelivery: null,
  };
  it('never says enrolled before Academic confirmed', () => {
    expect(deriveHandoffView(base).view).toBe('awaiting_pickup');
    for (const [status, attempts, lastError, view] of [
      ['failed', 2, 'x', 'academic_retrying'],
      ['dead', 5, null, 'failed_needs_action'],
      ['processed', 1, null, 'awaiting_reply'],
    ] as const)
      expect(
        deriveHandoffView({ ...base, academicDelivery: { status, attempts, lastError } }).view,
      ).toBe(view);
    expect(
      deriveHandoffView({
        ...base,
        status: 'admitted',
        handoffStatus: 'rejected',
        rejectionCode: 'BATCH_FULL',
      }).detail,
    ).toMatch(/BATCH_FULL/);
    expect(deriveHandoffView({ ...base, status: 'enrolled', handoffStatus: 'enrolled' }).view).toBe(
      'enrolled',
    );
  });
  it('a new attempt only when the previous one can no longer enrol (rejected or dead)', () => {
    expect(
      retryDecision({ ...base, status: 'admitted', handoffStatus: 'not_requested' }),
    ).toMatchObject({ allowed: true, kind: 'initial', via: 'request' });
    expect(retryDecision({ ...base, status: 'admitted', handoffStatus: 'rejected' })).toMatchObject(
      { allowed: true, kind: 'after_rejection' },
    );
    expect(retryDecision(base).allowed).toBe(false);
    expect(
      retryDecision({
        ...base,
        academicDelivery: { status: 'failed', attempts: 1, lastError: null },
      }).allowed,
    ).toBe(false);
    expect(
      retryDecision({
        ...base,
        academicDelivery: { status: 'processed', attempts: 1, lastError: null },
      }).allowed,
    ).toBe(false);
    expect(
      retryDecision({
        ...base,
        academicDelivery: { status: 'dead', attempts: 5, lastError: null },
      }),
    ).toMatchObject({ allowed: true, kind: 'after_failure', via: 'retry' });
    expect(retryDecision({ ...base, status: 'enrolled', handoffStatus: 'enrolled' }).allowed).toBe(
      false,
    );
  });
});

describe('admissions KPIs', () => {
  const w = { from: '2026-10-12', to: '2026-10-18' } as KpiWindow;
  // 2026-10-11T18:30:00Z = 12 Oct 00:00 IST (boundary).
  const enquiries = [
    { leadId: 'a', receivedAt: new Date('2026-10-11T18:30:00Z'), sourceCode: 'WEBINAR' },
    { leadId: 'a', receivedAt: new Date('2026-10-14T05:00:00Z'), sourceCode: 'REFERRAL' },
    { leadId: 'b', receivedAt: new Date('2026-10-11T18:29:59Z'), sourceCode: 'WALK_IN' },
    { leadId: 'c', receivedAt: new Date('2026-10-15T05:00:00Z'), sourceCode: 'UNKNOWN' },
  ];
  it('enquiries count per enquiry on IST dates; sources by first enquiry', () => {
    expect(newEnquiries(enquiries, w)).toMatchObject({ status: 'ok', value: 3 });
    expect(newEnquiries([], w)).toMatchObject({ status: 'ok', value: 0 });
    expect(leadsBySource(enquiries, w)).toEqual([
      { sourceCode: 'UNKNOWN', count: 1 },
      { sourceCode: 'WEBINAR', count: 1 },
    ]);
  });
  it('pipeline snapshot and decision splits', () => {
    const rows = [
      { status: 'admission_pending' as const, feeApproval: 'approved' as const },
      { status: 'admission_pending' as const, feeApproval: 'pending' as const },
      { status: 'admission_pending' as const, feeApproval: 'none' as const },
      { status: 'enrolled' as const, feeApproval: 'approved' as const },
    ];
    expect(admissionsByStatus(rows)).toMatchObject({ admission_pending: 3, enrolled: 1, lost: 0 });
    const d = pendingDecisions(rows, new Date('2026-10-19T06:00:00Z'));
    expect([
      d.awaitingDecision.value,
      d.awaitingApproval.value,
      d.offersAwaitingResponse.value,
    ]).toEqual([2, 1, 1]);
  });
  it('counselling and demos relative to now (IST)', () => {
    const now = new Date('2026-10-19T06:00:00Z');
    const c = pendingCounselling(
      [
        { status: 'scheduled', scheduledAt: new Date('2026-10-20T06:00:00Z') },
        { status: 'scheduled', scheduledAt: new Date('2026-10-18T06:00:00Z') },
        { status: 'completed', scheduledAt: new Date('2026-10-20T06:00:00Z') },
      ],
      now,
    );
    expect([c.upcoming.value, c.pastUnrecorded.value]).toEqual([1, 1]);
    expect(
      upcomingDemos(
        [
          { status: 'scheduled', dayDates: ['2026-10-19', '2026-10-20'] },
          { status: 'scheduled', dayDates: ['2026-10-25', '2026-10-26'] },
          { status: 'scheduled', dayDates: ['2026-10-26'] },
          { status: 'cancelled', dayDates: ['2026-10-20'] },
        ],
        now,
        7,
      ).value,
    ).toBe(2);
  });
  it('handoff success rate: missing (not 0 %) without a final outcome', () => {
    const at = new Date('2026-10-14T05:00:00Z');
    expect(handoffOutcomes([], w).successRate).toMatchObject({ status: 'missing', value: null });
    expect(
      handoffOutcomes([{ occurredAt: at, reply: null, academicDelivery: null }], w).successRate
        .status,
    ).toBe('missing');
    const h = handoffOutcomes(
      [
        { occurredAt: at, reply: 'confirmed', academicDelivery: 'processed' },
        { occurredAt: at, reply: 'rejected', academicDelivery: 'processed' },
        { occurredAt: at, reply: null, academicDelivery: 'dead' },
        { occurredAt: at, reply: null, academicDelivery: 'failed' },
        {
          occurredAt: new Date('2026-10-01T05:00:00Z'),
          reply: 'confirmed',
          academicDelivery: 'processed',
        },
      ],
      w,
    );
    expect([
      h.requested.value,
      h.confirmed.value,
      h.rejected.value,
      h.failed.value,
      h.awaiting.value,
    ]).toEqual([4, 1, 1, 1, 1]);
    expect(h.successRate).toMatchObject({ status: 'ok', value: 33.3 });
  });
  it('overdue follow-ups and closures by reason', () => {
    const now = new Date('2026-10-19T06:00:00Z');
    expect(
      overdueFollowUps(
        [
          { status: 'open', dueDate: '2026-10-18' },
          { status: 'open', dueDate: '2026-10-19' },
          { status: 'done', dueDate: '2026-10-01' },
        ],
        now,
      ).value,
    ).toBe(1);
    expect(
      closuresByReason(
        [
          { at: new Date('2026-10-13T05:00:00Z'), reasonCode: null },
          { at: new Date('2026-10-13T05:00:00Z'), reasonCode: 'chose_competitor' },
          { at: new Date('2026-10-14T05:00:00Z'), reasonCode: 'chose_competitor' },
          { at: new Date('2026-10-30T05:00:00Z'), reasonCode: 'other' },
        ],
        w,
      ),
    ).toEqual([
      { reasonCode: 'chose_competitor', count: 2 },
      { reasonCode: 'not_coded', count: 1 },
    ]);
  });
});
