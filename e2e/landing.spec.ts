import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LANDINGS, openAs, requireDemoPassword } from './support';

requireDemoPassword();

// axe has no WCAG 2.2 level-A rules; wcag22aa holds the 2.2 checks it has.
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });
    for (const [app, { url, email, h1 }] of Object.entries(LANDINGS)) {
      test(`${app} home as ${email}: one h1, no error panel, no serious axe violation`, async ({
        page,
      }) => {
        await openAs(page, email, url);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1);
        await expect(page.locator('[data-state="error"]')).toHaveCount(0);
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        const blocking = violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
        expect(blocking).toEqual([]);
      });
    }
  });
}
