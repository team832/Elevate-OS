/**
 * D-073 (security review, finding 2): Marketing works leads with ops:lead_contacts:read, which
 * opens the contact fields on a lead but never its KYC columns or KYC history.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { insertAuditEvent, opsLeads } from '@elevate/database';
import { leadsRoutes } from '../../src/leads';
import { phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let marketer: StaffUser;
let leadId: string;

type LeadView = {
  lead: Record<string, unknown>;
  history: { action: string; before: unknown; after: unknown }[];
};
const read = (user: StaffUser, base: string) =>
  callRoute<LeadView>(
    leadsRoutes['leads/[id]'].GET,
    authedRequest(user, `${base}/api/v1/leads/${leadId}`),
    { id: leadId },
  );

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  marketer = await staffUser(ctx.db, ['marketing_manager']);
  const created = await callRoute<{ lead: { id: string } }>(
    leadsRoutes.leads.POST,
    authedRequest(manager, '/ops/api/v1/leads', {
      method: 'POST',
      json: { studentName: 'Sample KYC Lead', studentPhone: phone(), sourceCode: 'WALK_IN' },
    }),
  );
  leadId = created.data!.lead.id;
  const kyc = {
    dateOfBirth: '2009-04-01',
    address: 'Sample Address, Sikar',
    emergencyContactName: 'Sample Emergency Contact',
    emergencyContactPhone: '+919870000999',
  };
  await ctx.db
    .update(opsLeads)
    .set(kyc)
    .where(eq(opsLeads.id, leadId as never));
  await insertAuditEvent(ctx.db, {
    actorType: 'user',
    actorUserId: manager.id,
    module: 'ops',
    action: 'lead.kyc_updated',
    entityType: 'lead',
    entityId: leadId,
    after: kyc,
  });
});

describe('lead KYC stays with student-private access', () => {
  it('marketing sees contact fields but no KYC columns or KYC history', async () => {
    const r = await read(marketer, '/marketing');
    expect(r.status).toBe(200);
    expect(r.data!.lead).toHaveProperty('studentPhone');
    for (const k of ['dateOfBirth', 'address', 'emergencyContactName', 'emergencyContactPhone'])
      expect(r.data!.lead).not.toHaveProperty(k);
    expect(r.data!.history.map((h) => h.action)).not.toContain('lead.kyc_updated');
    expect(JSON.stringify(r.data)).not.toMatch(/Sample Address|Sample Emergency|2009-04-01/);
  });

  it('the operations manager still sees everything', async () => {
    const r = await read(manager, '/ops');
    expect(r.data!.lead).toMatchObject({
      dateOfBirth: '2009-04-01',
      address: 'Sample Address, Sikar',
    });
    expect(r.data!.history.map((h) => h.action)).toContain('lead.kyc_updated');
  });
});
