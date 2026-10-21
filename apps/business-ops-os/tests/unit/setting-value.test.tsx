import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingTemplates } from '../../src/app/settings/_components/onboarding-templates';
import { decisionCodes, valueRows } from '../../src/app/settings/_components/setting-value';
import { SETTING_DEFINITIONS } from '../../src/domain/policies';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const text = (v: unknown) => (typeof v === 'string' ? v : renderToStaticMarkup(<>{v as never}</>));
const rows = (value: object) => valueRows(value).map((r) => [r.label, text(r.value)]);

describe('setting values as readable rows (never raw JSON)', () => {
  it.each([
    [{ windowDays: 30 }, [['Window days', '30 days']]],
    [{ amountPaise: null }, [['Amount', 'Not set']]],
    [{ amountPaise: 150000 }, [['Amount', '₹1,500']]],
    [{ amountPaise: 150050 }, [['Amount', '₹1,500.50']]],
    [{ amountInr: 1000 }, [['Amount', '₹1,000']]],
    [
      { allowed: false, maxExtraDays: 1 },
      [
        ['Allowed', 'No'],
        ['Max extra days', '1 day'],
      ],
    ],
    [{ sharesPercent: [50, 25, 25] }, [['Shares', '50 %, 25 %, 25 %']]],
    [{ closedWeekdays: [0, 6] }, [['Closed weekdays', 'Sunday, Saturday']]],
    [
      { guardian: 'if_under_18', mandatory: [] },
      [
        ['Guardian', 'If under 18'],
        ['Mandatory', 'None'],
      ],
    ],
    [
      { codes: [{ code: 'other', label: 'Other reason' }] },
      [['Codes', '<ul><li>Other reason</li></ul>']],
    ],
  ])('%j', (value, expected) => {
    expect(rows(value)).toEqual(expected);
  });

  it('a nested object becomes nested label/value rows, not JSON', () => {
    const [label, html] = rows({ limits: { maxDays: 2, allowed: true } })[0]!;
    expect(label).toBe('Limits');
    expect(html).toContain('<th scope="row">Max days</th><td>2 days</td>');
    expect(html).toContain('<td>Yes</td>');
    expect(html).not.toMatch(/[{}]/);
  });

  it('every defined setting renders without JSON braces', () => {
    for (const def of Object.values(SETTING_DEFINITIONS))
      for (const [, v] of rows(def.defaultValue)) expect(v).not.toMatch(/[{}]/);
  });

  it.each([
    ['D-037, D-040', 'D-037, D-040'],
    ['OD-046: confirm the reason list', 'OD-046'],
    ['Owner to set the registration fee (OD-013)', 'OD-013'],
    ['Owner to confirm the signature rule', null],
    [null, null],
  ])('decision codes in %j', (owner, codes) => {
    expect(decisionCodes(owner)).toBe(codes);
  });
});

describe('onboarding templates section', () => {
  const t = (id: string, version: number, status: string) => ({
    id,
    code: 'clat_kit',
    version,
    status,
    programmeCodes: ['CLAT'],
    classCategory: null,
    items: [
      {
        key: 'books',
        label: 'Books',
        kind: 'material' as const,
        requiredQuantity: 2,
        programmeCode: 'CLAT',
      },
    ],
  });
  const templates = [t('b', 2, 'active'), t('a', 1, 'retired')];

  it('lists versions in plain words; read-only users get no publish links', () => {
    const out = renderToStaticMarkup(
      <OnboardingTemplates templates={templates} manage={false} sp={{ group: 'admissions' }} />,
    );
    expect(out).toContain('Books (Material, 2 copies for CLAT)');
    expect(out).toContain('Any class');
    expect(out).not.toContain('act=template');
  });

  it('publishing copies the chosen version and names the next version number', () => {
    const out = renderToStaticMarkup(
      <OnboardingTemplates
        templates={templates}
        manage
        sp={{ group: 'admissions', act: 'template', template: 'a' }}
      />,
    );
    expect(out).toContain('Publish clat_kit v3');
    expect(out).toContain('Publish version 3');
    expect(out).toContain('&quot;requiredQuantity&quot;: 2');
  });
});
