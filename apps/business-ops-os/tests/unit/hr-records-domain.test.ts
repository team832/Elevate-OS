import { describe, expect, it } from 'vitest';
import {
  OPS_COMPENSATION_BASES,
  OPS_COMPENSATION_STATUSES,
  OPS_EMPLOYEE_DOCUMENT_KINDS,
  OPS_EMPLOYEE_DOCUMENT_STATUSES,
  OPS_EMPLOYMENT_HISTORY_FIELDS,
  OPS_EMPLOYMENT_STATUSES,
  OPS_ASSET_STATUSES,
  OPS_DOCUMENT_RETENTION_CLASSES,
  OPS_IDENTITY_REFERENCE_KINDS,
} from '@elevate/database';
import {
  checkEmploymentStatusChange,
  EMPLOYMENT_STATUSES,
  employeeFieldTiers,
  HISTORY_FIELDS,
  historyChanges,
  isValidTimeZone,
  normaliseWorkPhone,
  pageWindow,
  projectEmployee,
  type EmployeeRow,
} from '../../src/domain/hr/employees';
import { buildOrgTree, flattenOrgTree, planHeadSuccession } from '../../src/domain/hr/org';
import {
  checkDocumentAction,
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  IDENTITY_REFERENCE_KINDS,
  isExpired,
  isPrivateDocumentKind,
  RETENTION_CLASSES,
} from '../../src/domain/hr/documents';
import {
  COMPENSATION_BASES,
  COMPENSATION_STATUSES,
  compensationCsv,
  csvCell,
  effectiveRecordAt,
  formatInr,
  paiseToRupeesString,
  planCompensationApproval,
  validateCompensation,
  type CompensationLike,
} from '../../src/domain/hr/compensation';
import {
  ASSET_STATUSES,
  checkAssetStatusChange,
  checkAssignment,
  statusAfterReturn,
} from '../../src/domain/hr/assets';
import { normaliseLast4 } from '../../src/server/hr/private';

describe('domain lists match the schema constants', () => {
  it.each([
    ['employment statuses', EMPLOYMENT_STATUSES, OPS_EMPLOYMENT_STATUSES],
    ['history fields', HISTORY_FIELDS, OPS_EMPLOYMENT_HISTORY_FIELDS],
    ['document kinds', DOCUMENT_KINDS, OPS_EMPLOYEE_DOCUMENT_KINDS],
    ['document statuses', DOCUMENT_STATUSES, OPS_EMPLOYEE_DOCUMENT_STATUSES],
    ['retention classes', RETENTION_CLASSES, OPS_DOCUMENT_RETENTION_CLASSES],
    ['identity kinds', IDENTITY_REFERENCE_KINDS, OPS_IDENTITY_REFERENCE_KINDS],
    ['compensation bases', COMPENSATION_BASES, OPS_COMPENSATION_BASES],
    ['compensation statuses', COMPENSATION_STATUSES, OPS_COMPENSATION_STATUSES],
    ['asset statuses', ASSET_STATUSES, OPS_ASSET_STATUSES],
  ] as const)('%s', (_name, domain, schema) => expect([...domain]).toEqual([...schema]));
});

describe('employment status transitions (A-HR-02)', () => {
  it('allows the documented moves with a reason', () => {
    expect(checkEmploymentStatusChange('onboarding', 'active', { reason: 'Joined' }).ok).toBe(true);
    expect(checkEmploymentStatusChange('active', 'on_notice', { reason: 'Resigned' }).ok).toBe(
      true,
    );
    expect(checkEmploymentStatusChange('on_notice', 'active', { reason: 'Withdrawn' }).ok).toBe(
      true,
    );
    expect(
      checkEmploymentStatusChange('on_notice', 'separated', {
        reason: 'Left',
        endDate: '2026-12-31',
      }).ok,
    ).toBe(true);
  });
  it('rejects no-change, illegal, missing reason and missing end date', () => {
    expect(checkEmploymentStatusChange('active', 'active', { reason: 'x' })).toMatchObject({
      code: 'NO_CHANGE',
    });
    expect(checkEmploymentStatusChange('separated', 'active', { reason: 'x' })).toMatchObject({
      code: 'ILLEGAL',
    });
    expect(checkEmploymentStatusChange('onboarding', 'on_notice', { reason: 'x' })).toMatchObject({
      code: 'ILLEGAL',
    });
    expect(checkEmploymentStatusChange('active', 'on_notice', { reason: '  ' })).toMatchObject({
      code: 'REASON_REQUIRED',
    });
    expect(checkEmploymentStatusChange('active', 'separated', { reason: 'x' })).toMatchObject({
      code: 'END_DATE_REQUIRED',
    });
  });
});

describe('employment history diff (A-HR-03)', () => {
  const before = {
    departmentId: 'd1',
    title: 'A',
    managerId: null,
    employmentType: 'full_time',
    employmentStatus: 'active',
  };
  it('creation lists every non-empty field', () => {
    expect(
      historyChanges(null, {
        departmentId: 'd1',
        title: null,
        managerId: 'm',
        employmentType: 'contract',
      }).map((c) => c.field),
    ).toEqual(['department', 'manager', 'employment_type']);
  });
  it('only changed fields, absent fields unchanged, null counts as a change', () => {
    expect(historyChanges(before, { title: 'A' })).toEqual([]);
    expect(historyChanges(before, { departmentId: null, managerId: 'm2' })).toEqual([
      { field: 'department', fromValue: 'd1', toValue: null },
      { field: 'manager', fromValue: null, toValue: 'm2' },
    ]);
  });
});

describe('field tiers and projection (A-HR-01)', () => {
  const row: EmployeeRow = {
    staffId: 's1',
    employeeCode: 'EMP-0001',
    fullName: 'Asha (fictional)',
    legalName: 'Asha K (fictional)',
    departmentId: null,
    departmentName: null,
    title: null,
    managerId: null,
    managerName: null,
    workEmail: 'asha@example.test',
    workPhone: null,
    workLocation: null,
    timezone: 'Asia/Kolkata',
    employmentType: 'full_time',
    employmentStatus: 'active',
    employmentStartDate: '2026-01-01',
    employmentEndDate: null,
    staffStatus: 'active',
    hasLogin: true,
  };
  it('directory tier never carries record or private fields', () => {
    const v = projectEmployee(row, { record: false, private: false });
    expect(v.record).toBeNull();
    expect('legalName' in v).toBe(false);
    expect(JSON.stringify(v)).not.toContain('2026-01-01');
  });
  it('private tier adds the legal name only', () => {
    expect(projectEmployee(row, { record: false, private: true }).legalName).toBe(
      'Asha K (fictional)',
    );
  });
  it('tiers: self / manage / lifecycle give record; private only from private scope', () => {
    const none = { isSelf: false, canManage: false, lifecycleCovers: false, privateCovers: false };
    expect(employeeFieldTiers(none)).toEqual({ record: false, private: false });
    expect(employeeFieldTiers({ ...none, isSelf: true })).toEqual({ record: true, private: false });
    expect(employeeFieldTiers({ ...none, lifecycleCovers: true }).record).toBe(true);
    expect(employeeFieldTiers({ ...none, privateCovers: true }).private).toBe(true);
  });
  it('validates time zones, work phones and page windows', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(normaliseWorkPhone('98765 43210')).toEqual({ ok: true, phone: '+919876543210' });
    expect(normaliseWorkPhone('')).toEqual({ ok: true, phone: null });
    expect(normaliseWorkPhone('12').ok).toBe(false);
    expect(pageWindow(undefined, undefined)).toEqual({ page: 1, pageSize: 25, offset: 0 });
    expect(pageWindow(3, 500)).toEqual({ page: 3, pageSize: 100, offset: 200 });
    expect(pageWindow(0, 0)).toEqual({ page: 1, pageSize: 25, offset: 0 });
  });
});

describe('org tree and head succession', () => {
  const p = (id: string, managerId: string | null, fullName = id) => ({
    id,
    fullName,
    managerId,
    title: null,
    departmentName: null,
    status: 'active',
  });
  it('nests reports, sorts by name and flags loops instead of hiding them', () => {
    const rows = flattenOrgTree(
      buildOrgTree([
        p('b', 'a'),
        p('a', null),
        p('c', 'a'),
        p('x', 'y'),
        p('y', 'x'),
        p('z', 'gone'),
      ]),
    );
    expect(rows.map((r) => `${r.node.id}:${r.depth}`)).toEqual([
      'a:0',
      'b:1',
      'c:1',
      'x:0',
      'y:0',
      'z:0',
    ]);
    expect(rows.filter((r) => r.node.detached).map((r) => r.node.id)).toEqual(['x', 'y', 'z']);
  });
  it('ends the current head the day before; refuses same person and earlier dates', () => {
    expect(planHeadSuccession(null, { staffId: 's', startsOn: '2026-01-01' })).toEqual({
      ok: true,
      endCurrentOn: null,
    });
    expect(
      planHeadSuccession(
        { staffId: 'a', startsOn: '2026-01-01', endsOn: null },
        { staffId: 'b', startsOn: '2026-03-01' },
      ),
    ).toEqual({
      ok: true,
      endCurrentOn: '2026-02-28',
    });
    expect(
      planHeadSuccession(
        { staffId: 'a', startsOn: '2026-01-01', endsOn: null },
        { staffId: 'a', startsOn: '2026-03-01' },
      ).ok,
    ).toBe(false);
    expect(
      planHeadSuccession(
        { staffId: 'a', startsOn: '2026-03-01', endsOn: null },
        { staffId: 'b', startsOn: '2026-03-01' },
      ).ok,
    ).toBe(false);
    expect(planHeadSuccession(null, { staffId: 'b', startsOn: '2026-02-30' }).ok).toBe(false);
  });
});

describe('document actions (A-HR-05)', () => {
  const ctx = { actorUserId: 'u1', requestedBy: null, reason: 'r' };
  it('hold blocks deletion; deletion decided by someone else; reasons required', () => {
    expect(checkDocumentAction('active', 'request_deletion', ctx)).toEqual({
      ok: true,
      to: 'deletion_requested',
    });
    expect(checkDocumentAction('retention_hold', 'request_deletion', ctx)).toMatchObject({
      ok: false,
      code: 'ILLEGAL',
    });
    expect(
      checkDocumentAction('deletion_requested', 'approve_deletion', { ...ctx, requestedBy: 'u1' }),
    ).toMatchObject({ code: 'SELF_DECISION' });
    expect(
      checkDocumentAction('deletion_requested', 'approve_deletion', { ...ctx, requestedBy: 'u2' }),
    ).toEqual({ ok: true, to: 'deleted' });
    expect(checkDocumentAction('active', 'request_deletion', { ...ctx, reason: '' })).toMatchObject(
      { code: 'REASON_REQUIRED' },
    );
    expect(checkDocumentAction('deleted', 'release_hold', ctx).ok).toBe(false);
  });
  it('identity kinds are private; expiry is strict', () => {
    expect(isPrivateDocumentKind('identification_reference')).toBe(true);
    expect(isPrivateDocumentKind('agreement')).toBe(false);
    expect(isExpired('2026-10-18', '2026-10-19')).toBe(true);
    expect(isExpired('2026-10-19', '2026-10-19')).toBe(false);
    expect(isExpired(null, '2026-10-19')).toBe(false);
  });
});

describe('compensation (A-HR-06, A-HR-07)', () => {
  const rec = (o: Partial<CompensationLike>): CompensationLike => ({
    id: 'r',
    staffId: 's',
    status: 'draft',
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
    createdBy: 'u1',
    ...o,
  });
  it('validates amounts, components and refuses statutory labels', () => {
    expect(
      validateCompensation({
        basis: 'monthly',
        amountPaise: 0,
        components: [],
        effectiveFrom: '2026-04-01',
      }).ok,
    ).toBe(true);
    expect(
      validateCompensation({
        basis: 'monthly',
        amountPaise: -1,
        components: [],
        effectiveFrom: '2026-04-01',
      }).ok,
    ).toBe(false);
    expect(
      validateCompensation({
        basis: 'monthly',
        amountPaise: 100,
        components: [],
        effectiveFrom: '2026-02-30',
      }).ok,
    ).toBe(false);
    for (const label of ['PF', 'Professional tax', 'ESI', 'Loan deduction'])
      expect(
        validateCompensation({
          basis: 'monthly',
          amountPaise: 1,
          components: [{ kind: 'earning', label, amountPaise: 1 }],
          effectiveFrom: '2026-04-01',
        }).ok,
      ).toBe(false);
    expect(
      validateCompensation({
        basis: 'monthly',
        amountPaise: 3,
        components: [
          { kind: 'earning', label: 'Basic', amountPaise: 1 },
          { kind: 'allowance', label: 'basic', amountPaise: 2 },
        ],
        effectiveFrom: '2026-04-01',
      }).ok,
    ).toBe(false);
  });
  it('approval: no self, forward in time, supersedes the current record', () => {
    expect(planCompensationApproval(rec({}), [], { userId: 'u1', staffId: null })).toMatchObject({
      code: 'SELF_APPROVAL',
    });
    expect(planCompensationApproval(rec({}), [], { userId: 'u2', staffId: 's' })).toMatchObject({
      code: 'SELF_APPROVAL',
    });
    expect(
      planCompensationApproval(rec({ status: 'approved' }), [], { userId: 'u2', staffId: null }),
    ).toMatchObject({ code: 'ILLEGAL' });
    const current = rec({ id: 'c', status: 'approved', effectiveFrom: '2026-01-01' });
    expect(planCompensationApproval(rec({}), [current], { userId: 'u2', staffId: null })).toEqual({
      ok: true,
      supersede: { id: 'c', effectiveTo: '2026-03-31' },
    });
    expect(
      planCompensationApproval(rec({ effectiveFrom: '2026-01-01' }), [current], {
        userId: 'u2',
        staffId: null,
      }),
    ).toMatchObject({ code: 'CONFLICT' });
  });
  it('effective record: exactly one, none, or a reported conflict', () => {
    const a = rec({
      id: 'a',
      status: 'superseded',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-03-31',
    });
    const b = rec({ id: 'b', status: 'approved', effectiveFrom: '2026-04-01' });
    expect(effectiveRecordAt([a, b], '2026-03-31').record?.id).toBe('a');
    expect(effectiveRecordAt([a, b], '2026-04-01').record?.id).toBe('b');
    expect(effectiveRecordAt([a, b], '2025-12-31')).toEqual({ record: null, conflict: false });
    expect(effectiveRecordAt([rec({ status: 'draft' })], '2026-05-01').record).toBeNull();
    expect(
      effectiveRecordAt(
        [b, rec({ id: 'c', status: 'approved', effectiveFrom: '2026-02-01' })],
        '2026-05-01',
      ).conflict,
    ).toBe(true);
  });
  it('formats paise exactly and neutralises CSV formulas', () => {
    expect(paiseToRupeesString(4500050)).toBe('45000.50');
    expect(paiseToRupeesString(5)).toBe('0.05');
    expect(formatInr(1234567890)).toBe('₹1,23,45,678.90');
    expect(formatInr(null)).toBe('—');
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    const csv = compensationCsv(
      [
        {
          employeeCode: 'EMP-0002',
          fullName: 'B',
          basis: 'monthly',
          amountPaise: 100,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          components: [],
          recordId: 'r2',
        },
        {
          employeeCode: 'EMP-0001',
          fullName: 'A',
          basis: 'annual',
          amountPaise: 200,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          components: [{ kind: 'earning', label: 'Basic', amountPaise: 200 }],
          recordId: 'r1',
        },
      ],
      { exportReference: 'CMPX-1', asOf: '2026-05-01' },
    );
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('EMP-0001');
    expect(lines[1]).toContain('earning:Basic:200');
  });
});

describe('assets (A-HR-08)', () => {
  const base = {
    assetStatus: 'available' as const,
    hasOpenAssignment: false,
    employeeStatus: 'active',
    staffStatus: 'active',
    assignedOn: '2026-10-01',
    expectedReturnOn: null,
  };
  it('assignment rules', () => {
    expect(checkAssignment(base).ok).toBe(true);
    expect(checkAssignment({ ...base, hasOpenAssignment: true }).ok).toBe(false);
    expect(checkAssignment({ ...base, assetStatus: 'in_repair' }).ok).toBe(false);
    expect(checkAssignment({ ...base, employeeStatus: null }).ok).toBe(false);
    expect(checkAssignment({ ...base, employeeStatus: 'separated' }).ok).toBe(false);
    expect(checkAssignment({ ...base, expectedReturnOn: '2026-09-30' }).ok).toBe(false);
    expect(checkAssignment({ ...base, expectedReturnOn: '2026-10-01' }).ok).toBe(true);
  });
  it('return conditions and manual status changes', () => {
    expect(statusAfterReturn('good')).toBe('available');
    expect(statusAfterReturn('worn')).toBe('available');
    expect(statusAfterReturn('damaged')).toBe('in_repair');
    expect(statusAfterReturn('lost')).toBe('lost');
    expect(checkAssetStatusChange('available', 'in_repair').ok).toBe(true);
    expect(checkAssetStatusChange('assigned', 'retired').ok).toBe(false);
    expect(checkAssetStatusChange('available', 'assigned').ok).toBe(false);
    expect(checkAssetStatusChange('retired', 'available').ok).toBe(false);
    expect(checkAssetStatusChange('lost', 'available').ok).toBe(true);
  });
});

describe('identity last-four rule (OD-014)', () => {
  it('keeps at most four characters and refuses full numbers', () => {
    expect(normaliseLast4('9012')).toBe('9012');
    expect(normaliseLast4(' ab-1 ')).toBe('AB1');
    expect(normaliseLast4('')).toBeNull();
    expect(normaliseLast4(null)).toBeNull();
    expect(() => normaliseLast4('1234 5678 9012')).toThrow(/last four/);
    expect(() => normaliseLast4('12#4')).toThrow();
  });
});
