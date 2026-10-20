import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  authedRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { opsEmployeeDocuments } from '@elevate/database';
import {
  GET as getPrivate,
  PUT as putPrivate,
} from '../../src/app/api/v1/hr/employees/[id]/private/route';
import { POST as addContact } from '../../src/app/api/v1/hr/employees/[id]/emergency-contacts/route';
import { DELETE as removeContact } from '../../src/app/api/v1/hr/employees/[id]/emergency-contacts/[contactId]/route';
import { POST as addIdentity } from '../../src/app/api/v1/hr/employees/[id]/identity-references/route';
import {
  GET as listDocs,
  POST as addDoc,
} from '../../src/app/api/v1/hr/employees/[id]/documents/route';
import { POST as docStatus } from '../../src/app/api/v1/hr/documents/[id]/status/route';
import { GET as download } from '../../src/app/api/v1/hr/documents/[id]/download/route';
import { setDocumentStorageForTesting } from '../../src/server/adapters/document-storage';
import { setupReference } from './fixtures';
import { employeeUser, lastAudit, type EmployeeUser, statusOf } from './hr-records-fixtures';

const ctx = setupTestDatabase();
let hrManager: EmployeeUser;
let hrManager2: EmployeeUser;
let hrContributor: EmployeeUser;
let deptManager: EmployeeUser;
let report: EmployeeUser;
let colleague: EmployeeUser;
let opsManager: EmployeeUser;
let director: TestUser;
let auditor: TestUser;

const req = (u: { token: string }, json?: unknown, method = json === undefined ? 'GET' : 'POST') =>
  authedRequest(u, '/ops/api/v1/hr/x', { method, json });

beforeAll(async () => {
  await setupReference(ctx.db);
  hrManager = await employeeUser(ctx.db, ['hr_manager', 'employee']);
  hrManager2 = await employeeUser(ctx.db, ['hr_manager']);
  hrContributor = await employeeUser(ctx.db, ['hr_contributor']);
  deptManager = await employeeUser(ctx.db, ['department_manager', 'employee']);
  report = await employeeUser(ctx.db, ['employee'], { managerId: deptManager.staffId });
  colleague = await employeeUser(ctx.db, ['employee']);
  opsManager = await employeeUser(ctx.db, ['operations_manager']);
  director = await createTestUser(ctx.db, { roles: ['director'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
});

afterEach(() => setDocumentStorageForTesting(undefined));

describe('private HR fields (OPS-034)', () => {
  it('the employee reads and edits their own; values are normalised; audit names fields only', async () => {
    const put = await callRoute<{
      legalName: string;
      details: { personalPhone: string; personalEmail: string };
    }>(
      putPrivate,
      req(
        report,
        {
          legalName: 'Ritu Sharma (fictional)',
          personalPhone: '098765 43210',
          personalEmail: ' Ritu@Example.TEST ',
        },
        'PUT',
      ),
      { id: report.staffId },
    );
    expect(put.status).toBe(200);
    expect(put.data!.details.personalPhone).toBe('+919876543210');
    expect(put.data!.details.personalEmail).toBe('ritu@example.test');
    const audit = await lastAudit(ctx.db, report.staffId, 'employee_private.updated');
    const raw = JSON.stringify(audit);
    expect(raw).toContain('personalPhone');
    expect(raw).not.toContain('9876543210');
    expect(raw).not.toContain('Ritu Sharma');
    expect(
      await statusOf(putPrivate, req(report, { personalPhone: '12' }, 'PUT'), {
        id: report.staffId,
      }),
    ).toBe(400);
  });

  it('colleagues, department managers, HR contributors, director, auditor and ops manager are refused', async () => {
    for (const u of [colleague, deptManager, hrContributor, director, auditor, opsManager])
      expect(await statusOf(getPrivate, req(u), { id: report.staffId })).toBe(403);
    expect(
      await statusOf(putPrivate, req(deptManager, { city: 'X' }, 'PUT'), { id: report.staffId }),
    ).toBe(403);
    const hr = await callRoute<{ legalName: string }>(getPrivate, req(hrManager), {
      id: report.staffId,
    });
    expect(hr.status).toBe(200);
    expect(hr.data!.legalName).toBe('Ritu Sharma (fictional)');
  });

  it('emergency contacts: first becomes primary; removal is audited without values', async () => {
    const a = await callRoute<{ id: string }>(
      addContact,
      req(report, { name: 'Mohan (fictional)', relationship: 'Father', phone: '9123456780' }),
      {
        id: report.staffId,
      },
    );
    expect(a.status).toBe(201);
    expect(
      await statusOf(
        addContact,
        req(colleague, { name: 'X', relationship: 'Y', phone: '9123456780' }),
        { id: report.staffId },
      ),
    ).toBe(403);
    const rec = await callRoute<{ emergencyContacts: { isPrimary: boolean; phone: string }[] }>(
      getPrivate,
      req(report),
      { id: report.staffId },
    );
    expect(rec.data!.emergencyContacts[0]).toMatchObject({
      isPrimary: true,
      phone: '+919123456780',
    });
    const del = await callRoute(removeContact, req(report, undefined, 'DELETE'), {
      id: report.staffId,
      contactId: a.data!.id,
    });
    expect(del.status).toBe(200);
    const audit = await lastAudit(
      ctx.db,
      report.staffId,
      'employee_private.emergency_contact_removed',
    );
    expect(JSON.stringify(audit)).not.toContain('Mohan');
  });

  it('identity references keep at most the last four characters (OD-014)', async () => {
    const full = await callRoute(
      addIdentity,
      req(hrManager, { kind: 'aadhaar', last4: '1234 5678 9012' }),
      { id: report.staffId },
    );
    expect(full.status).toBe(400);
    const ok = await callRoute(addIdentity, req(hrManager, { kind: 'pan', last4: '4f2z' }), {
      id: report.staffId,
    });
    expect(ok.status).toBe(201);
    const rec = await callRoute<{ identityReferences: { masked: string; last4: string }[] }>(
      getPrivate,
      req(hrManager),
      { id: report.staffId },
    );
    expect(rec.data!.identityReferences[0]).toMatchObject({ last4: '4F2Z', masked: '•••• 4F2Z' });
  });
});

describe('employee documents (OPS-035)', () => {
  let refDocId: string;

  it('records a reference-only document; stored uploads are refused (503) while storage is not configured', async () => {
    const res = await callRoute<{ id: string }>(
      addDoc,
      req(hrContributor, {
        kind: 'agreement',
        title: 'Appointment letter',
        externalReference: 'HR cabinet B, file 12',
      }),
      { id: report.staffId },
    );
    expect(res.status).toBe(201);
    refDocId = res.data!.id;
    expect(
      await statusOf(addDoc, req(hrContributor, { kind: 'agreement', title: 'No location' }), {
        id: report.staffId,
      }),
    ).toBe(400);
    const content = Buffer.from('fictional test document').toString('base64');
    const { createHash } = await import('node:crypto');
    const sha256 = createHash('sha256').update(Buffer.from(content, 'base64')).digest('hex');
    const before = await ctx.db
      .select()
      .from(opsEmployeeDocuments)
      .where(eq(opsEmployeeDocuments.staffId, report.staffId));
    const stored = await callRoute<{ stored: boolean; connection: string }>(
      addDoc,
      req(hrContributor, {
        kind: 'certificate',
        title: 'Certificate',
        storageKind: 'stored',
        contentType: 'application/pdf',
        sha256,
        contentBase64: content,
      }),
      { id: report.staffId },
    );
    expect(stored.status).toBe(503);
    expect(stored.data).toMatchObject({ stored: false, connection: 'not_configured' });
    const after = await ctx.db
      .select()
      .from(opsEmployeeDocuments)
      .where(eq(opsEmployeeDocuments.staffId, report.staffId));
    expect(after.length).toBe(before.length);
    const wrongHash = await callRoute(
      addDoc,
      req(hrContributor, {
        kind: 'certificate',
        title: 'C',
        storageKind: 'stored',
        contentType: 'application/pdf',
        sha256: 'a'.repeat(64),
        contentBase64: content,
      }),
      { id: report.staffId },
    );
    expect(wrongHash.status).toBe(400);
  });

  it('downloads: reference-only → 409, stored with the mock adapter → 503, both audited; never a URL', async () => {
    const ref = await callRoute<{ available: boolean; reason: string }>(download, req(report), {
      id: refDocId,
    });
    expect(ref.status).toBe(409);
    expect(ref.data).toMatchObject({ available: false, reason: 'reference_only' });
    const [stored] = await ctx.db
      .insert(opsEmployeeDocuments)
      .values({
        staffId: report.staffId,
        kind: 'training',
        title: 'Stored before storage was removed (test)',
        storageKind: 'stored',
        storageKey: `test-only-key-${Date.now()}`,
        sha256: 'b'.repeat(64),
        uploadedBy: hrManager.id,
      })
      .returning();
    const res = await callRoute<{ available: boolean; reason: string; url?: string }>(
      download,
      req(hrManager),
      { id: stored!.id },
    );
    expect(res.status).toBe(503);
    expect(res.data).toMatchObject({ available: false, reason: 'storage_not_configured' });
    expect(res.data!.url).toBeUndefined();
    expect(
      (await lastAudit(ctx.db, stored!.id, 'employee_document.download_requested'))?.metadata,
    ).toMatchObject({
      outcome: 'storage_not_configured',
    });
    setDocumentStorageForTesting({
      name: 'fake (test)',
      status: async () => ({ connection: 'connected', detail: 'test', verifiedAt: null }),
      put: async () => ({ ok: true, storageKey: 'x' }),
      downloadUrl: async (key, ttl) => ({
        ok: true,
        url: `https://storage.invalid/${key}?ttl=${ttl}`,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      }),
    });
    const ok = await callRoute<{ available: boolean; url: string }>(download, req(hrManager), {
      id: stored!.id,
    });
    expect(ok.status).toBe(200);
    expect(ok.data!.url).toContain('ttl=300');
  });

  it('scope: the employee sees own documents only; managers and the auditor have no access', async () => {
    expect(await statusOf(listDocs, req(report), { id: report.staffId })).toBe(200);
    for (const u of [colleague, deptManager, auditor, director, opsManager])
      expect(await statusOf(listDocs, req(u), { id: report.staffId })).toBe(403);
    expect(await statusOf(download, req(colleague), { id: refDocId })).toBe(403);
  });

  it('identity documents need private access: hidden from the HR contributor', async () => {
    const res = await callRoute(
      addDoc,
      req(hrContributor, {
        kind: 'identification_reference',
        title: 'ID',
        externalReference: 'Seen, not kept',
      }),
      {
        id: report.staffId,
      },
    );
    expect(res.status).toBe(403);
    const ok = await callRoute(
      addDoc,
      req(hrManager, {
        kind: 'identification_reference',
        title: 'ID card seen',
        externalReference: 'Original returned to employee',
      }),
      {
        id: report.staffId,
      },
    );
    expect(ok.status).toBe(201);
    const contributor = await callRoute<{
      documents: { kind: string }[];
      hiddenPrivateCount: number;
    }>(listDocs, req(hrContributor), { id: report.staffId });
    expect(contributor.data!.documents.some((d) => d.kind === 'identification_reference')).toBe(
      false,
    );
    expect(contributor.data!.hiddenPrivateCount).toBe(1);
    const self = await callRoute<{ documents: { kind: string }[] }>(listDocs, req(report), {
      id: report.staffId,
    });
    expect(self.data!.documents.some((d) => d.kind === 'identification_reference')).toBe(true);
  });

  it('deletion: requested by one person, decided by a different one; a retention hold blocks it', async () => {
    const noReason = await callRoute(docStatus, req(hrManager, { action: 'request_deletion' }), {
      id: refDocId,
    });
    expect(noReason.status).toBe(400);
    expect(
      await statusOf(docStatus, req(hrManager, { action: 'hold', reason: 'Dispute open' }), {
        id: refDocId,
      }),
    ).toBe(200);
    expect(
      await statusOf(
        docStatus,
        req(hrManager, { action: 'request_deletion', reason: 'Duplicate' }),
        { id: refDocId },
      ),
    ).toBe(409);
    expect(
      await statusOf(docStatus, req(hrManager, { action: 'release_hold' }), { id: refDocId }),
    ).toBe(200);
    expect(
      await statusOf(
        docStatus,
        req(hrManager, { action: 'request_deletion', reason: 'Duplicate' }),
        { id: refDocId },
      ),
    ).toBe(200);
    expect(
      await statusOf(docStatus, req(hrManager, { action: 'approve_deletion', confirm: true }), {
        id: refDocId,
      }),
    ).toBe(403);
    expect(
      await statusOf(docStatus, req(report, { action: 'approve_deletion' }), { id: refDocId }),
    ).toBe(403);
    expect(
      await statusOf(docStatus, req(hrManager2, { action: 'approve_deletion' }), {
        id: refDocId,
      }),
    ).toBe(400);
    const ok = await callRoute<{ status: string }>(
      docStatus,
      req(hrManager2, { action: 'approve_deletion', confirm: true }),
      { id: refDocId },
    );
    expect(ok.status).toBe(200);
    expect(ok.data!.status).toBe('deleted');
    const [row] = await ctx.db
      .select()
      .from(opsEmployeeDocuments)
      .where(eq(opsEmployeeDocuments.id, refDocId as never));
    expect(row!.title).toBe('Appointment letter');
    expect(await statusOf(download, req(hrManager), { id: refDocId })).toBe(409);
  });
});
