/**
 * Requests through HR, screens (owner brief 23 Oct 2026 §6): the HR queue's tabs and counts, the
 * "Recipient not set up" badge, the staff page's empty states and form, and what a recipient's
 * pop-up leaves out (the sender's own words).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { can, type Permission } from '@elevate/authorization';
import type { Database } from '@elevate/database';
import { setupTestDatabase, type TestUser } from '@elevate/testing';
import HrQueuePage from '../../src/app/hr/requests/page';
import HrRequestsPage from '../../src/app/hr-requests/page';
import { createHrRequest, hrRequestAction } from '../../src/server/hr-requests';
import { hrRequestBody } from '../../src/server/hr-requests-schemas';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const access = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../../src/ui/frame', async (orig) => ({
  ...(await orig<object>()),
  gate: async (permission: Permission) => ({
    status: can(access.user as never, permission) ? 'allowed' : 'forbidden',
    user: access.user,
    modules: ['ops'],
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => '/',
}));

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const html = async (as: TestUser, node: ReactNode) => {
  access.user = as;
  return new Response((await prerender(node)).prelude).text();
};
const sp = (v: Record<string, string> = {}) => ({ searchParams: Promise.resolve(v) });

let hr: StaffUser;
let sender: StaffUser;
let recipient: StaffUser;
let quiet: StaffUser;
let forSchar: string;
let forwarded: string;

beforeAll(async () => {
  await setupReference(db());
  hr = await staffUser(db(), ['hr_manager'], { name: 'Sample HR' });
  sender = await staffUser(db(), ['finance_officer'], { name: 'Sample Sender' });
  recipient = await staffUser(db(), ['finance_officer'], { name: 'Sample Recipient' });
  quiet = await staffUser(db(), ['finance_officer'], { name: 'Sample Quiet' });
  const send = (json: Record<string, unknown>) =>
    createHrRequest(
      db(),
      sender,
      hrRequestBody.parse({ category: 'other', message: 'Sample words', ...json }),
    );
  forSchar = (await send({ subject: 'Sample for Schar', recipient: 'key:schar' })).id;
  forwarded = (await send({ subject: 'Sample private subject' })).id;
  await hrRequestAction(db(), hr, forwarded, 'review', {});
  await hrRequestAction(db(), hr, forwarded, 'forward', {
    toStaffId: recipient.staffId,
    body: 'Sample text for the recipient',
  });
});

describe('HR queue', () => {
  it('tabs with counts from the same query and the "Recipient not set up" badge', async () => {
    const page = await html(hr, <HrQueuePage {...sp()} />);
    expect(page).toContain('Staff requests');
    for (const label of ['New', 'In review', 'Forwarded', 'Closed']) expect(page).toContain(label);
    expect(page).toMatch(/New[\s\S]*?1/);
    expect(page).toContain('Sample for Schar');
    expect(page).toContain('Recipient not set up: Schar');
    expect(page).toContain(`open=${forSchar}`);
  });

  it('an empty tab says what it is waiting for', async () => {
    const page = await html(hr, <HrQueuePage {...sp({ tab: 'closed' })} />);
    expect(page).toContain('No closed requests');
    expect(page).toContain('Resolved and declined requests are kept here.');
    expect(page).not.toContain('Nothing here');
  });

  it('staff without ops:hr_requests:read get "No access"', async () => {
    expect(await html(sender, <HrQueuePage {...sp()} />)).toContain('No access');
  });
});

describe('staff page', () => {
  it.each([
    [{}, 'You have not sent any requests'],
    [{ tab: 'forwarded' }, 'Nothing has been forwarded to you'],
  ])('empty state %j', async (params, text) => {
    expect(await html(quiet, <HrRequestsPage {...sp(params)} />)).toContain(text);
  });

  it('the new request form offers HR, Schar and colleagues, and a draft option', async () => {
    const page = await html(quiet, <HrRequestsPage {...sp({ new: '1' })} />);
    for (const text of [
      'Who it is for',
      'HR (no one else)',
      'Schar',
      'Sample Recipient',
      'Keep it as a draft',
    ])
      expect(page).toContain(text);
  });

  it('the recipient sees HR’s text and a reply box, never the sender’s subject or message', async () => {
    const page = await html(
      recipient,
      <HrRequestsPage {...sp({ tab: 'forwarded', open: forwarded })} />,
    );
    expect(page).toContain('Sample text for the recipient');
    expect(page).toContain('Reply to HR');
    expect(page).not.toContain('Sample private subject');
    expect(page).not.toContain('Sample words');
  });
});
