import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { metric } from '@elevate/shared-contracts';
import { AppShell, DataTable, ErrorState, LoginForm, StatTile } from '../src/index';

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
