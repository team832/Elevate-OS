/**
 * The F4-09 / F4-10 screens render for the people they are for: forms only for those who may
 * change things, "No access" otherwise, the checklist pop-up with who marked each item, and the
 * cover page with what the approver covers. Fictional people only.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { can, type Permission } from '@elevate/authorization';
import { setupTestDatabase, type TestUser } from '@elevate/testing';
import ApprovalCoverPage from '../../src/app/approval-cover/page';
import StaffAssetsPage from '../../src/app/hr/assets/page';
import StaffChecklistsPage from '../../src/app/hr/checklists/page';
import { createCover } from '../../src/server/approval-cover';
import { createHrRequest } from '../../src/server/hr-requests';
import { hrRequestBody } from '../../src/server/hr-requests-schemas';
import {
  issueAsset,
  setChecklistItem,
  startChecklist,
  getStaffChecklist,
} from '../../src/server/hr-staff-records';
import { istToday } from '../../src/domain/dates';
import { seedStaffChecklistTemplates } from '../../seed/staff-checklist-templates';
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
/** Render `page` as `as` (the gate reads the user when the page runs). */
const html = async (as: TestUser, page: () => Promise<ReactNode>) => {
  access.user = as;
  return new Response((await prerender(await page())).prelude).text();
};
const sp = (v: Record<string, string> = {}) => ({ searchParams: Promise.resolve(v) });
let hr: StaffUser;
let ops: StaffUser;
let director: StaffUser;
let teacher: StaffUser;
let checklistId: string;

beforeAll(async () => {
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Screens' });
  ops = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Screens' });
  director = await staffUser(ctx.db, ['director'], { name: 'Sample Director Screens' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Screens' });
  await seedStaffChecklistTemplates(ctx.db, ops.id);
  checklistId = (await startChecklist(ctx.db, hr, { staffId: teacher.staffId, event: 'leaving' }))
    .id;
  const [first] = (await getStaffChecklist(ctx.db, hr, checklistId)).items;
  await setChecklistItem(ctx.db, hr, first!.id, { status: 'done' });
  await issueAsset(ctx.db, hr, {
    staffId: teacher.staffId,
    assetType: 'ID card',
    tag: 'SAMPLE-ID-7',
    issuedOn: istToday(new Date()),
  });
  await createCover(ctx.db, ops, {
    coverStaffId: hr.staffId,
    fromDate: istToday(new Date()),
    toDate: istToday(new Date()),
  });
});

describe('screens', () => {
  it('checklists: HR sees the start form, templates and the pop-up with who marked an item', async () => {
    const page = await html(hr, () => StaffChecklistsPage(sp({ open: checklistId })));
    expect(page).toContain('Start a checklist');
    expect(page).toContain('Publish a new leaving version');
    expect(page).toContain('Leaving checklist: Sample Teacher Screens');
    expect(page).toContain('Sample HR Screens, ');
    expect(page).toContain('4 of 5 open');
  });

  it('assets: HR issues and records returns; a director only reads', async () => {
    expect(await html(hr, () => StaffAssetsPage(sp()))).toContain('Record return');
    const read = await html(director, () => StaffAssetsPage(sp()));
    expect(read).toContain('SAMPLE-ID-7');
    expect(read).not.toContain('Issue an asset');
  });

  it.each([
    ['checklists', () => StaffChecklistsPage(sp())],
    ['assets', () => StaffAssetsPage(sp())],
  ])('%s: a teacher gets No access', async (_n, page) => {
    expect(await html(teacher, () => page())).not.toContain('Download (spreadsheet)');
  });

  it('approval cover: the approver names covers, the cover sees whom they cover', async () => {
    const mine = await html(ops, () => ApprovalCoverPage(sp()));
    expect(mine).toContain('Name a cover');
    expect(mine).toContain('Sample HR Screens');
    expect(mine).toContain('Active today');
    const held = await html(hr, () => ApprovalCoverPage(sp()));
    expect(held).toContain('Covering for');
    expect(held).toContain('Sample Ops Screens');
  });

  it('approval cover: a finance cover of an HR manager gets the requests on this page (FR-B M5)', async () => {
    const away = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Away' });
    const fo = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Stand-in' });
    const asks = await staffUser(ctx.db, ['admissions_counsellor'], {
      name: 'Sample Counsellor Asks',
    });
    const body = hrRequestBody.parse({
      category: 'classes',
      subject: 'Cover queue (test)',
      message: 'Help (test).',
    });
    await createHrRequest(ctx.db, asks, body);
    const today = istToday(new Date());
    await createCover(ctx.db, away, { coverStaffId: fo.staffId, fromDate: today, toDate: today });
    const page = await html(fo, () => ApprovalCoverPage(sp()));
    expect(page).toContain('Requests from staff, as cover');
    expect(page).toContain('Cover queue (test)');
  });
});
