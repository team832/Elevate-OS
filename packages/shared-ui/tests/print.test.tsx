/** Every page prints (owner, 6 Nov 2026): the shared Print button, the print-only header line and the print stylesheet. */
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { AppShell, PageHeader, PrintButton } from '../src/index';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const printButton = /<button type="button" class="el-button el-button-secondary">Print<\/button>/;

describe('Print button', () => {
  it('PageHeader shows it by default, after the page’s own actions', () => {
    expect(render(<PageHeader title="Leads" />)).toMatch(printButton);
    expect(render(<PageHeader title="Leads" actions={<a href="/x">New lead</a>} />)).toMatch(
      /<div class="el-page-actions"><a href="\/x">New lead<\/a><button[^>]*>Print<\/button><\/div>/,
    );
  });

  it('PageHeader hides it with print={false}', () => {
    const html = render(<PageHeader title="Sign in" print={false} />);
    expect(html).not.toMatch(/Print<\/button>/);
    expect(html).not.toContain('el-page-actions');
  });

  it('opens the browser’s print dialog', () => {
    const print = vi.fn();
    vi.stubGlobal('window', { print });
    (PrintButton() as ReactElement<{ onClick: () => void }>).props.onClick();
    expect(print).toHaveBeenCalledOnce();
  });
});

describe('print-only header line', () => {
  it('names the institute, the page title and the date and time printed (IST)', () => {
    vi.useFakeTimers({ now: new Date('2026-11-06T05:00:00Z') });
    expect(render(<PageHeader title="Fee follow-ups" />)).toContain(
      '<p class="el-print-header">Elevate Education · Fee follow-ups · Printed <time dateTime="2026-11-06T05:00:00.000Z">6 Nov 2026, 10:30 am IST</time></p>',
    );
  });

  it('inside the shell it says who printed it', () => {
    const html = render(
      <AppShell
        user={{ displayName: 'Ola Ops (fictional)', email: 'ops@example.test', roles: ['ops'] }}
        modules={['ops']}
        current="ops"
        logoutAction="/ops/api/v1/auth/logout"
      >
        <PageHeader title="Leads" />
      </AppShell>,
    );
    expect(html).toMatch(
      /<p class="el-print-header">Elevate Education · Leads · Printed <time[^>]*>[^<]+ IST<\/time> · Printed by Ola Ops \(fictional\)<\/p>/,
    );
  });
});

describe('print stylesheet', () => {
  const css = (file: string) =>
    readFileSync(new URL(`../src/css/${file}`, import.meta.url), 'utf8');
  const paper = ['shell.css', 'components.css']
    .map((f) => css(f).split('@media print {')[1] ?? '')
    .join('\n');
  const hidden = paper.match(/([^{}]+)\{\s*display: none !important;/g)?.join(' ') ?? '';

  it.each([
    '.el-sidebar',
    '.el-topbar',
    '.el-skip-link',
    '.el-subnav',
    '.el-tablist',
    '.el-page-actions',
    '.el-card-actions',
    '.el-form-actions',
    '.el-toasts',
    'button',
    '.el-button',
    "nav[aria-label='Pages'] a",
  ])('hides %s on paper', (selector) => {
    expect(hidden).toContain(selector);
  });

  it.each(['.el-badge-sample', '.el-print-header', "nav[aria-label='Pages'] span"])(
    'never hides %s (the SAMPLE DATA badge and the "Showing x of y" count print)',
    (selector) => {
      expect(hidden).not.toContain(selector);
    },
  );

  it.each([
    [/\.el-print-header \{\s*display: block;/],
    [/thead \{\s*display: table-header-group;/],
    [/tr \{\s*break-inside: avoid;/],
    [/\.el-table-wrap \{\s*overflow: visible;/],
    // The pager's box goes; its "Showing x–y of z" text stays.
    [/nav\[aria-label='Pages'\] \{\s*display: contents;/],
    [/\.el-chart-table::details-content \{\s*content-visibility: visible;/],
    [/a \{\s*color: inherit !important;\s*text-decoration: none !important;/],
  ])('paper rule %s', (rule) => {
    expect(paper).toMatch(rule);
  });

  it('shows the print-only line on paper only', () => {
    expect(css('shell.css')).toMatch(/^\.el-print-header \{\s*display: none;/m);
  });

  it('prints compact tables as tables, not phone cards', () => {
    const tables = css('tables.css');
    expect(tables).toContain('@media print, (min-width: 720px) {\n  .el-table-compact {');
    expect(tables).toContain('@media screen and (max-width: 719.98px) {');
  });

  it('uses only --el-* tokens or literal print colours inside @media print', () => {
    expect(paper).not.toMatch(/var\(--(?!el-)/);
  });
});
