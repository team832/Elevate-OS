/** HUS-002: Book a demo from a lead never pre-picks someone else; a lead that is not ready is told so. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { setupTestDatabase } from '@elevate/testing';
import { BookDemo } from '../../src/app/admissions/_components/book-demo';
import { pendingCase } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const ctx = setupTestDatabase();
vi.mock('@elevate/database', async (real) => ({
  ...(await real<typeof import('@elevate/database')>()),
  getDb: () => ctx.db,
}));
const html = async (node: ReactNode) =>
  (await new Response((await prerender(node)).prelude).text()).replaceAll('<!-- -->', '');

let counsellor: StaffUser;
let ready: Awaited<ReturnType<typeof pendingCase>>;

beforeAll(async () => {
  await setupReference(ctx.db);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  ready = await pendingCase(counsellor, { counselledOnly: true });
});

const form = async (leadId: string) =>
  html(await BookDemo({ user: counsellor, cancelHref: '/ops/admissions', leadId }));

describe('Book a demo from a lead', () => {
  it('a lead that is not ready: says so, links to it, and pre-picks nobody', async () => {
    const other = '00000000-0000-4000-8000-000000000001';
    const out = await form(other);
    expect(out).toContain('This lead cannot book a demo yet');
    expect(out).toContain(`/ops/leads/${other}`);
    expect(out).toContain('Choose…');
    expect(out).not.toContain(`value="${ready.admissionId}" selected`);
  });

  it('a lead that is ready: its own case is chosen and no warning shows', async () => {
    const out = await form(ready.leadId);
    expect(out).toContain(`value="${ready.admissionId}" selected`);
    expect(out).not.toContain('This lead cannot book a demo yet');
  });
});
