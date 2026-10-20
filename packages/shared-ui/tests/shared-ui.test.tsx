import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { metric } from '@elevate/shared-contracts';
import {
  AppShell,
  BRAND_LOGO_SIZE,
  DataTable,
  Dialog,
  ErrorState,
  Icon,
  LoginForm,
  MetricStrip,
  ShellFrame,
  SourceBadge,
  StatTile,
  Tabs,
  defaultBreadcrumbs,
  initialsOf,
  navSections,
  nextTabIndex,
  type AppShellProps,
  type NavItem,
} from '../src/index';

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

describe('MetricStrip — missing is "Not available", never 0', () => {
  const html = renderToStaticMarkup(
    <MetricStrip
      label="Key figures"
      items={[
        { label: 'Students enrolled', metric: metric.ok(0, meta), note: 'With an active batch' },
        {
          label: 'Staff present',
          metric: metric.missing('No attendance source yet.', meta),
          href: '/ops/hr/attendance',
        },
        {
          label: 'Pending approvals',
          metric: metric.ok(4, meta),
          href: '/ops/operations/approvals',
        },
      ]}
    />,
  );
  const items = html.split('<li').slice(1);

  it('shows a measured 0 as 0', () => {
    expect(items[0]).toContain('data-status="ok"');
    expect(items[0]).toContain('class="el-metric-value">0<');
  });
  it('shows missing as Not available with the reason, without a number or a link', () => {
    expect(items[1]).toContain('data-status="missing"');
    expect(items[1]).toContain('class="el-metric-value">Not available<');
    expect(items[1]).toContain('No attendance source yet.');
    expect(items[1]).not.toMatch(/el-metric-value">\s*\d/);
    expect(items[1]).not.toContain('href=');
  });
  it('links available figures to where they can be checked', () => {
    expect(items[2]).toContain('href="/ops/operations/approvals"');
    expect(html).toContain('aria-label="Key figures"');
  });
});

describe('SourceBadge', () => {
  it('labels sample data and renders nothing for live data', () => {
    expect(renderToStaticMarkup(<SourceBadge source="sample" />)).toContain('Sample data');
    expect(renderToStaticMarkup(<SourceBadge source="live" />)).toBe('');
  });
});

const user = {
  displayName: 'Ola Ops (fictional)',
  email: 'ops@example.test',
  roles: ['operations_manager'],
};

const opsNav: NavItem[] = [
  { href: '/ops', label: 'Dashboard' },
  { href: '/ops/leads', label: 'Leads', group: 'Admissions' },
  { href: '/ops/students', label: 'Students', group: 'Admissions' },
  { href: '/ops/tasks', label: 'Tasks', group: 'Operations' },
  { href: '/ops/reports', label: 'Reports', group: 'Reports' },
];

function shell(props: Partial<AppShellProps> = {}) {
  return renderToStaticMarkup(
    <AppShell
      user={user}
      modules={['platform', 'ops', 'academic']}
      current="ops"
      logoutAction="/ops/api/v1/auth/logout"
      {...props}
    >
      <p>content</p>
    </AppShell>,
  );
}

describe('AppShell sidebar', () => {
  it('shows the logo from the app basePath, the company name and Overview', () => {
    const html = shell();
    expect(html).toContain('src="/ops/brand/elevate-logo.png"');
    expect(html).toContain(`width="${BRAND_LOGO_SIZE.width}"`);
    expect(html).toContain('alt="elevate"');
    expect(html).toContain('Elevate Education');
    expect(html).toMatch(/href="\/"[^>]*><svg[^>]*>.*?<\/svg><span>Overview<\/span>/);
  });

  it('lists only the modules the user can open; other modules are entry links', () => {
    const html = shell();
    expect(html).toContain('Business Operations');
    expect(html).toContain('href="/academic"');
    expect(html).toContain('Academic OS');
    expect(html).not.toContain('Marketing OS');
    expect(html).not.toContain('/marketing');
  });

  it('expands the current module with its sections; the active page is marked', () => {
    const html = shell({ nav: opsNav.map((n, i) => ({ ...n, active: i === 2 })) });
    expect(html).toContain('<details class="el-nav-module" open="">');
    expect(html).toContain('href="/ops/students" aria-current="page"');
    // the active page's group is open, the others are closed
    expect(html).toMatch(/<details class="el-nav-group" open=""><summary><span>Admissions</);
    expect(html).toMatch(/<details class="el-nav-group"><summary><span>Operations</);
    // a one-item group named like its item is a plain link
    expect(html).not.toContain('<span>Reports</span><svg');
    expect(html).toContain('href="/ops/reports"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(2); // sidebar link + breadcrumb
  });

  it('hides My work, Settings, search and notifications unless given (no dead controls)', () => {
    const html = shell();
    expect(html).not.toContain('My work');
    expect(html).not.toContain('>Settings<');
    expect(html).not.toContain('role="search"');
    expect(html).not.toContain('el-notify');
  });

  it('renders My work, Settings (active), search and the unread count when given', () => {
    const html = shell({
      myWorkHref: '/ops/tasks?view=mine',
      settings: { href: '/ops/settings', active: true },
      search: { action: '/ops/leads', label: 'Search leads' },
      unreadNotifications: 3,
    });
    expect(html).toContain('href="/ops/tasks?view=mine"');
    expect(html).toContain('href="/ops/settings" aria-current="page"');
    expect(html).toContain(
      '<form class="el-search" role="search" action="/ops/leads" method="get">',
    );
    expect(html).toContain('name="q"');
    expect(html).toContain('placeholder="Search leads"');
    expect(html).toContain('3 unread notifications');
    expect(shell({ unreadNotifications: null })).not.toContain('el-notify');
  });

  it('shows the profile (initials, name, roles) and sign-out forms', () => {
    const html = shell();
    expect(html).toContain('>OO<');
    expect(html).toContain('operations manager');
    expect(html.match(/action="\/ops\/api\/v1\/auth\/logout"/g)).toHaveLength(2);
  });

  it('starts collapsed on small screens: menu button with aria-expanded=false', () => {
    const html = shell();
    expect(html).toContain('aria-expanded="false" aria-controls="el-sidebar-ops"');
    expect(html).toContain('id="el-sidebar-ops"');
    expect(html).not.toContain('data-sidebar-open');
    expect(html).not.toContain('inert');
    expect(html).toContain('<main id="main"');
  });

  it('when open: aria-expanded=true, backdrop, and the page behind is inert', () => {
    const html = renderToStaticMarkup(
      <ShellFrame sidebarId="sb" sidebar={<p>nav</p>} topbar={<p>top</p>} defaultOpen>
        <p>content</p>
      </ShellFrame>,
    );
    expect(html).toContain('data-sidebar-open="true"');
    expect(html).toContain('aria-expanded="true" aria-controls="sb"');
    expect(html).toContain('class="el-sidebar-backdrop"');
    expect(html).toContain('class="el-shell-body" inert=""');
    expect(html).toContain('Close menu');
  });
});

describe('navSections and breadcrumbs', () => {
  it('groups items in order and flattens one-item groups named like the item', () => {
    const sections = navSections(opsNav.map((n, i) => ({ ...n, active: i === 3 })));
    expect(sections.map((s) => (s.kind === 'link' ? s.item.label : `[${s.name}]`))).toEqual([
      'Dashboard',
      '[Admissions]',
      '[Operations]',
      'Reports',
    ]);
    expect(sections.find((s) => s.kind === 'group' && s.name === 'Operations')).toMatchObject({
      active: true,
    });
  });
  it('builds module › group › page and stops at the module on its home page', () => {
    expect(
      defaultBreadcrumbs(
        'ops',
        opsNav.map((n, i) => ({ ...n, active: i === 1 })),
      ),
    ).toEqual([
      { label: 'Business Operations', href: '/ops' },
      { label: 'Admissions' },
      { label: 'Leads', href: '/ops/leads' },
    ]);
    expect(
      defaultBreadcrumbs(
        'ops',
        opsNav.map((n, i) => ({ ...n, active: i === 0 })),
      ),
    ).toEqual([{ label: 'Business Operations', href: '/ops' }]);
    expect(defaultBreadcrumbs('platform')).toEqual([{ label: 'Overview', href: '/' }]);
  });
  it('makes initials without the "(fictional)" marker', () => {
    expect(initialsOf('Tara Teacher (fictional)')).toBe('TT');
    expect(initialsOf('Asha')).toBe('A');
  });
});

describe('Tabs', () => {
  const html = renderToStaticMarkup(
    <Tabs
      idBase="p"
      label="Team priorities"
      selected="week"
      items={[
        { key: 'today', label: 'Today', href: '/?tasks=today', count: 2 },
        { key: 'week', label: 'This week', href: '/?tasks=week', count: 4 },
        { key: 'all', label: 'All tasks', href: '/?tasks=all', count: null },
      ]}
    >
      <p>panel</p>
    </Tabs>,
  );
  it('renders an accessible tablist with one selected tab in the tab order', () => {
    expect(html).toContain('role="tablist" aria-label="Team priorities"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain(
      'id="p-tab-week" role="tab" href="/?tasks=week" aria-selected="true" aria-controls="p-panel" tabindex="0"',
    );
    expect(html).toContain(
      'id="p-tab-today" role="tab" href="/?tasks=today" aria-selected="false" tabindex="-1"',
    );
    expect(html).toContain('role="tabpanel" aria-labelledby="p-tab-week"');
    // unknown counts are not shown as 0
    expect(html).not.toMatch(/All tasks<span class="el-tab-count">/);
  });
  it('moves focus with the arrow keys (wrapping), Home and End', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTabIndex('ArrowDown', 1, 3)).toBe(2);
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('a', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('Dialog', () => {
  it('is a native dialog labelled by its title and opened by a button that says so', () => {
    const html = renderToStaticMarkup(
      <Dialog id="d" title="New enquiry" description="Creates a lead." triggerLabel="New enquiry">
        <p>form</p>
      </Dialog>,
    );
    expect(html).toContain('aria-haspopup="dialog" aria-controls="d"');
    expect(html).toContain(
      '<dialog id="d" class="el-dialog" aria-labelledby="d-title" aria-describedby="d-description"',
    );
    expect(html).toContain('<h2 id="d-title">New enquiry</h2>');
    expect(html).toContain('id="d-description"');
    expect(html).toContain('<span class="el-visually-hidden">Close</span>');
    // closed until opened (showModal)
    expect(html).not.toMatch(/<dialog[^>]* open/);
  });
});

describe('Icon', () => {
  it('is decorative by default and labelled when asked', () => {
    expect(renderToStaticMarkup(<Icon name="bell" />)).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(<Icon name="bell" label="Notifications" />);
    expect(labelled).toContain('role="img" aria-label="Notifications"');
    expect(labelled).toContain('stroke-width="1.5"');
  });
});

describe('DataTable and states', () => {
  it('renders the empty state when there are no rows', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={[{ key: 'name', header: 'Name' }]} rows={[]} rowKey={() => 'x'} />,
    );
    expect(html).toContain('data-state="empty"');
  });
  it('renders rows (compact when asked)', () => {
    const html = renderToStaticMarkup(
      <DataTable
        compact
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'n', header: 'Count', numeric: true },
        ]}
        rows={[{ name: 'CLAT', n: 3 }]}
        rowKey={(r) => r.name}
      />,
    );
    expect(html).toContain('class="el-table el-table-compact"');
    expect(html).toContain('<td data-label="Name">CLAT</td>');
    expect(html).toContain('class="el-num" data-label="Count">3</td>');
  });
  it('error state shows the request reference', () => {
    expect(renderToStaticMarkup(<ErrorState requestId="req-123" />)).toContain(
      'Reference: req-123',
    );
  });
  it('login form posts to the given action with the next path and shows the zone’s logo', () => {
    const html = renderToStaticMarkup(
      <LoginForm action="/marketing/api/v1/auth/login" next="/marketing" error="invalid" />,
    );
    expect(html).toContain('action="/marketing/api/v1/auth/login"');
    expect(html).toContain('name="next" value="/marketing"');
    expect(html).toContain('Email or password is incorrect.');
    expect(html).toContain('src="/marketing/brand/elevate-logo.png"');
    expect(renderToStaticMarkup(<LoginForm action="/api/v1/auth/login" next="/" />)).toContain(
      'src="/brand/elevate-logo.png"',
    );
  });
});
