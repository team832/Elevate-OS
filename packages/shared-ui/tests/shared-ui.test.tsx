import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { metric } from '@elevate/shared-contracts';
import { AppShell, DataTable, ErrorState, LoginForm, StatTile, type NavItem } from '../src/index';

const meta = {
  definition: 'Classes marked delivered',
  window: { from: '2026-10-12', to: '2026-10-18' },
  unit: 'count' as const,
};

describe('StatTile — missing is not zero', () => {
  it('renders a measured zero as 0', () => {
    const html = renderToStaticMarkup(
      <StatTile label="Classes delivered" metric={metric.ok(0, meta)} />,
    );
    expect(html).toContain('data-status="ok"');
    expect(html).toContain('>0<');
  });

  it('renders missing as "Missing" with the reason and no number', () => {
    const html = renderToStaticMarkup(
      <StatTile
        label="Classes delivered"
        metric={metric.missing('Academic OS not connected yet', meta)}
      />,
    );
    expect(html).toContain('data-status="missing"');
    expect(html).toContain('Missing');
    expect(html).toContain('Academic OS not connected yet');
    expect(html).not.toMatch(/el-stat-value">\s*0/);
  });

  it('renders estimated values with a badge and basis', () => {
    const html = renderToStaticMarkup(
      <StatTile
        label="Reach"
        metric={metric.estimated(1200, 'Sampled from 3 of 9 accounts', { ...meta, unit: 'count' })}
      />,
    );
    expect(html).toContain('Estimated');
    expect(html).toContain('≈ 1,200');
    expect(html).toContain('Sampled from 3 of 9 accounts');
  });
});

describe('AppShell', () => {
  it('shows the lowercase wordmark and only the modules passed in', () => {
    const html = renderToStaticMarkup(
      <AppShell
        user={{
          displayName: 'Tara Teacher (fictional)',
          email: 'teacher@example.test',
          roles: ['teacher'],
        }}
        modules={['platform', 'academic']}
        current="academic"
        logoutAction="/academic/api/v1/auth/logout"
      >
        <p>content</p>
      </AppShell>,
    );
    expect(html).toContain('>elevate</a>');
    expect(html).toContain('href="/academic" aria-current="page"');
    expect(html).not.toContain('Marketing OS');
    expect(html).not.toContain('Business Ops OS');
    expect(html).toContain('action="/academic/api/v1/auth/logout"');
  });
});

describe('AppShell grouped navigation', () => {
  const shell = (nav: NavItem[]) =>
    renderToStaticMarkup(
      <AppShell
        user={{ displayName: 'Ola Ops (fictional)', email: 'ops@example.test', roles: [] }}
        modules={['ops']}
        current="ops"
        logoutAction="/ops/api/v1/auth/logout"
        nav={nav}
      >
        <p>content</p>
      </AppShell>,
    );
  const items: NavItem[] = [
    { href: '/ops', label: 'Dashboard' },
    { href: '/ops/leads', label: 'Leads', group: 'Admissions' },
    { href: '/ops/students', label: 'Students', group: 'Admissions' },
    { href: '/ops/tasks', label: 'Tasks', group: 'Operations' },
  ];

  it.each([
    [
      'an item in a group',
      2,
      [
        'href="/ops/leads" aria-current="true">Admissions<',
        'href="/ops/students" aria-current="page">Students<',
        'aria-label="Admissions pages"',
      ],
      ['>Tasks<'],
    ],
    [
      'an ungrouped item',
      0,
      ['href="/ops" aria-current="page">Dashboard<', 'href="/ops/tasks">Operations<'],
      ['pages"', '>Leads<'],
    ],
  ])('active %s: section row, then only that section’s pages', (_, activeIndex, has, hasNot) => {
    const html = shell(items.map((n, i) => ({ ...n, active: i === activeIndex })));
    for (const h of has) expect(html).toContain(h);
    for (const h of hasNot) expect(html).not.toContain(h);
  });

  it('without groups renders the single row as before', () => {
    const html = shell([
      { href: '/ops', label: 'Dashboard', active: true },
      { href: '/ops/tasks', label: 'Tasks' },
    ]);
    expect(html.match(/<nav class="el-subnav"/g)).toHaveLength(1);
    expect(html).toContain('href="/ops/tasks">Tasks<');
  });
});

describe('DataTable and states', () => {
  it('renders the empty state when there are no rows', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={[{ key: 'name', header: 'Name' }]} rows={[]} rowKey={() => 'x'} />,
    );
    expect(html).toContain('data-state="empty"');
  });
  it('renders rows', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'n', header: 'Count', numeric: true },
        ]}
        rows={[{ name: 'CLAT', n: 3 }]}
        rowKey={(r) => r.name}
      />,
    );
    expect(html).toContain('<td>CLAT</td>');
    expect(html).toContain('class="el-num">3</td>');
  });
  it('error state shows the request reference', () => {
    expect(renderToStaticMarkup(<ErrorState requestId="req-123" />)).toContain(
      'Reference: req-123',
    );
  });
  it('login form posts to the given action with the next path', () => {
    const html = renderToStaticMarkup(
      <LoginForm action="/marketing/api/v1/auth/login" next="/marketing" error="invalid" />,
    );
    expect(html).toContain('action="/marketing/api/v1/auth/login"');
    expect(html).toContain('name="next" value="/marketing"');
    expect(html).toContain('Email or password is incorrect.');
  });
});
