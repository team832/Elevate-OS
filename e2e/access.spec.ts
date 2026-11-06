import { expect, test } from '@playwright/test';
import { DEMO, HOME, LANDINGS, openAs, requireDemoPassword } from './support';

requireDemoPassword();

const FEES = `${HOME.ops}/fees`;
const HR = `${HOME.ops}/hr`;

// Who can open what: each refusal sits next to a control that must open the same page.
const CASES = [
  {
    name: 'control: the business administrator opens Fees',
    email: DEMO.business,
    url: FEES,
    h1: 'Fees',
  },
  // No ops:module:access: Ops sends a teacher to their own workspace without showing the page (D-072).
  {
    name: 'refused: a teacher opening Fees lands on Academic',
    email: DEMO.teacher,
    url: FEES,
    h1: LANDINGS.academic.h1,
    landsOn: LANDINGS.academic.url,
  },
  { name: 'control: the HR manager opens HR', email: DEMO.hr, url: HR, h1: 'HR overview' },
  {
    name: 'refused: a counsellor opening HR gets "No access"',
    email: DEMO.counsellor,
    url: HR,
    h1: 'No access',
  },
];

for (const { name, email, url, h1, landsOn = url } of CASES) {
  test(name, async ({ page }) => {
    await openAs(page, email, url);
    await expect(page).toHaveURL(landsOn);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1);
  });
}
