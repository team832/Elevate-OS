/**
 * Lead screens as Marketing OS mounts them (owner brief 23 Oct 2026 §11): honest call-log copy
 * (never claims a call was placed or recorded by the app), stages not set up, manager-only edits.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { opsAdmissions } from '@elevate/database';
import { LeadBody, LeadStagesBody, leadsRoutes as R, SalesCallsBody } from '../../src/leads';
import { ensureSystemLeadStages } from '../../src/server/lead-stages';
import { phone, setupReference, staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => '/',
}));

const ctx = setupTestDatabase();
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
const base = '/marketing';
// Claims the app may never make: it neither dials nor records calls.
const CLAIMS =
  /call recording|recorded call|calls? (are|is|was) recorded|auto-?dial|dialled by|placed by (the )?(app|system)/i;
let manager: StaffUser;
let employee: StaffUser;
let leadId: string;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['marketing_manager'], { name: 'Sample Marketing Manager' });
  employee = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer' });
  const res = await callRoute<{ lead: { id: string } }>(
    R.leads.POST,
    authedRequest(employee, '/marketing/api/v1/leads', {
      method: 'POST',
      json: { studentName: 'Sample Screen Lead', studentPhone: phone() },
    }),
  );
  leadId = res.data!.lead.id;
});

describe('lead screens', () => {
  it('before stages exist the screens say so honestly', async () => {
    expect(await html(<LeadStagesBody user={manager} base={base} />)).toContain(
      'Lead stages are not set up yet',
    );
    const lead = await html(<LeadBody user={employee} base={base} id={leadId} searchParams={{}} />);
    expect(lead).toContain('Lead stages are not set up yet');
    expect(lead).not.toContain('Change stage');
  });

  it('call log copy states that calls are made from the staff phone, with no recording claim', async () => {
    await ensureSystemLeadStages(ctx.db);
    const pages = await Promise.all([
      html(<SalesCallsBody user={employee} base={base} searchParams={{ new: '1' }} />),
      html(<LeadBody user={employee} base={base} id={leadId} searchParams={{ act: 'contact' }} />),
    ]);
    for (const out of pages) {
      expect(out).toContain('Calls are made from your phone; this log is what you record.');
      expect(out).not.toMatch(CLAIMS);
      expect(out).not.toContain('/ops/');
    }
    expect(pages[0]).toContain('Sample Screen Lead');
    expect(pages[1]).toContain('Next follow-up date');
  });

  it('stage settings: managers edit, employees only read; the lead offers Change stage', async () => {
    expect(await html(<LeadStagesBody user={manager} base={base} />)).toContain('Add a stage');
    const asEmployee = await html(<LeadStagesBody user={employee} base={base} />);
    expect(asEmployee).toContain('Do not contact');
    expect(asEmployee).not.toContain('Add a stage');
    expect(
      await html(<LeadBody user={employee} base={base} id={leadId} searchParams={{}} />),
    ).toContain('Change stage');
  });

  it('fix C1: a converted lead shows when its admission later ended or was cancelled', async () => {
    const setCase = (status: 'admitted' | 'withdrawn' | 'cancelled_before_enrolment') =>
      ctx.db
        .update(opsAdmissions)
        .set({ admissionNumber: '9931', status })
        .where(eq(opsAdmissions.leadId, leadId as never));
    await setCase('admitted');
    const moved = await callRoute(
      R['leads/[id]/stage'].POST,
      authedRequest(employee, '/marketing/api/v1/x', {
        method: 'POST',
        json: { stageKey: 'converted' },
      }),
      { id: leadId },
    );
    expect(moved.status).toBe(200);
    const page = () => html(<LeadBody user={employee} base={base} id={leadId} searchParams={{}} />);
    await setCase('withdrawn');
    expect(await page()).toContain('Admission later withdrawn');
    await setCase('cancelled_before_enrolment');
    expect(await page()).toContain('Admission cancelled after conversion');
  });
});
