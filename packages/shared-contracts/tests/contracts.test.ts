import { describe, expect, it } from 'vitest';
import {
  AppError,
  ForbiddenError,
  enrolmentConfirmedV1Payload,
  enrolmentKeys,
  enrolmentRequestedV1Payload,
  findEventDefinition,
  getEventDefinition,
  defineEvent,
  listEventDefinitions,
  metric,
  metricSchema,
  apiFailureSchema,
  type EventPayload,
} from '../src/index';
import { z } from 'zod';

const ids = {
  admission: '0b6f8f2e-3c1a-4f7e-9b2d-1a2b3c4d5e6f',
  lead: '1c7a9e3f-4d2b-4a8f-8c3e-2b3c4d5e6f70',
  staff: '2d8b0f40-5e3c-4b90-9d4f-3c4d5e6f7081',
  user: '3e9c1051-6f4d-4ca1-8e50-4d5e6f708192',
  event: '4fad2162-7a5e-4db2-9f61-5e6f708192a3',
  enrolment: '50be3273-8b6f-4ec3-a072-6f708192a3b4',
  student: '61cf4384-9c70-4fd4-b183-708192a3b4c5',
};

const validRequest = {
  admissionId: ids.admission,
  leadId: ids.lead,
  attempt: 1,
  programmeCode: 'CLAT',
  student: { fullName: 'Asha Example', currentStage: 'class_11', phone: '+919800000001' },
  guardian: { fullName: 'Ravi Example', relationship: 'father' },
  counsellorStaffId: ids.staff,
  requestedByUserId: ids.user,
};

describe('enrolment handoff contract', () => {
  it('accepts a minimal valid request', () => {
    const parsed: EventPayload<'ops.admission.enrolment_requested', 1> =
      enrolmentRequestedV1Payload.parse(validRequest);
    expect(parsed.programmeCode).toBe('CLAT');
  });

  it('requires at least one contact', () => {
    const result = enrolmentRequestedV1Payload.safeParse({
      ...validRequest,
      student: { fullName: 'Asha Example' },
      guardian: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict) and bad programme codes', () => {
    expect(enrolmentRequestedV1Payload.safeParse({ ...validRequest, fee: 1000 }).success).toBe(
      false,
    );
    expect(
      enrolmentRequestedV1Payload.safeParse({ ...validRequest, programmeCode: 'clat' }).success,
    ).toBe(false);
  });

  it('confirmation carries the ids Ops needs to close the admission', () => {
    const ok = enrolmentConfirmedV1Payload.safeParse({
      requestEventId: ids.event,
      admissionId: ids.admission,
      leadId: ids.lead,
      enrolmentId: ids.enrolment,
      studentId: ids.student,
      existingStudent: false,
      programmeCode: 'CLAT',
      confirmedAt: '2026-10-17T10:00:00.000Z',
      confirmedByUserId: null,
    });
    expect(ok.success).toBe(true);
  });

  it('provides deterministic idempotency keys', () => {
    expect(enrolmentKeys.request(ids.admission, 2)).toBe(`admission:${ids.admission}:attempt:2`);
    expect(enrolmentKeys.reply(ids.event)).toBe(`enrolment-reply:${ids.event}`);
  });
});

describe('event registry', () => {
  it('knows the three handoff events', () => {
    const types = listEventDefinitions().map((d) => `${d.type}@${d.version}`);
    expect(types).toEqual(
      expect.arrayContaining([
        'ops.admission.enrolment_requested@1',
        'academic.enrolment.confirmed@1',
        'academic.enrolment.rejected@1',
      ]),
    );
    expect(getEventDefinition('academic.enrolment.rejected', 1).producer).toBe('academic');
    expect(findEventDefinition('academic.enrolment.rejected', 2)).toBeUndefined();
    expect(() => getEventDefinition('nope.x.y', 1)).toThrow(/Unknown/);
  });

  it('enforces naming and producer prefix', () => {
    expect(() =>
      defineEvent({
        type: 'Ops.Bad',
        version: 1,
        producer: 'ops',
        consumers: [],
        description: 'x',
        payload: z.object({}),
      }),
    ).toThrow();
    expect(() =>
      defineEvent({
        type: 'ops.lead.created',
        version: 1,
        producer: 'marketing',
        consumers: [],
        description: 'x',
        payload: z.object({}),
      }),
    ).toThrow(/producer/);
  });
});

describe('metrics: missing is not zero', () => {
  const meta = {
    definition: 'Classes marked delivered',
    window: { from: '2026-10-12', to: '2026-10-18' },
    unit: 'count' as const,
  };
  it('a measured zero and a missing value are different', () => {
    const zero = metricSchema.parse(metric.ok(0, meta));
    const missing = metricSchema.parse(metric.missing('Not connected', meta));
    expect(zero).toMatchObject({ status: 'ok', value: 0 });
    expect(missing).toMatchObject({ status: 'missing', value: null });
  });
  it('rejects a missing metric that carries a number, and an ok metric without one', () => {
    expect(
      metricSchema.safeParse({ ...meta, status: 'missing', value: 0, reason: 'x' }).success,
    ).toBe(false);
    expect(metricSchema.safeParse({ ...meta, status: 'ok', value: null }).success).toBe(false);
  });
  it('rejects inverted windows', () => {
    expect(() =>
      metric.ok(1, { ...meta, window: { from: '2026-10-18', to: '2026-10-12' } }),
    ).toThrow();
    expect(
      metricSchema.safeParse({
        ...meta,
        status: 'ok',
        value: 1,
        window: { from: '2026-10-18', to: '2026-10-12' },
      }).success,
    ).toBe(false);
  });
});

describe('errors', () => {
  it('maps codes to HTTP statuses', () => {
    const e = new ForbiddenError();
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(403);
    expect(e.code).toBe('FORBIDDEN');
    expect(
      apiFailureSchema.safeParse({ error: { code: 'FORBIDDEN', message: 'x', requestId: 'r' } })
        .success,
    ).toBe(true);
  });
});
