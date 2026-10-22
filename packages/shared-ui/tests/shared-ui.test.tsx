import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { metric } from '@elevate/shared-contracts';
import {
  JourneyRail,
  PageHeader,
  AppShell,
  BrandLogo,
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
  it('shows the inline logo (named "Elevate Education") linking home; Overview only on the platform', () => {
    const html = shell();
    expect(html).toMatch(
      /<a class="el-sidebar-brand" href="\/"><svg class="el-brand-logo el-brand-logo-sm"[^>]*role="img" aria-label="Elevate Education"/,
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<span>Overview</span>');
    expect(shell({ current: 'platform' })).toMatch(
      /href="\/"[^>]*><svg[^>]*>.*?<\/svg><span>Overview<\/span>/,
    );
  });

  it('links each workspace to its own origin when given (D-072)', () => {
    const html = shell({
      moduleHrefs: { ops: 'http://localhost:3000/ops', academic: 'http://localhost:3001/academic' },
    });
    expect(html).toContain('href="http://localhost:3001/academic"');
    expect(html).toContain('href="http://localhost:3000/ops" data-current="true"');
    expect(html).toContain('href="/ops/workspaces"');
  });

  it('lists only the modules the user can open; other modules are entry links', () => {
    const html = shell();
    expect(html).toContain('Business Operations');
    expect(html).toContain('href="/academic"');
    expect(html).toContain('Academic OS');
    expect(html).not.toContain('Marketing OS');
    expect(html).not.toContain('/marketing');
  });

  it('marks the current module and lists its sections in labelled groups; the page is marked', () => {
    const html = shell({ nav: opsNav.map((n, i) => ({ ...n, active: i === 2 })) });
    expect(html).toMatch(/class="el-nav-link el-nav-module" href="\/ops" data-current="true"/);
    expect(html).toContain('aria-label="Business Operations sections"');
    expect(html).toContain('href="/ops/students" aria-current="page"');
    // groups are always open and name their list
    expect(html).toMatch(
      /<span class="el-nav-heading" id="(el-navgroup-\d+)">Admissions<\/span><ul class="el-nav-list" aria-labelledby="\1">/,
    );
    expect(html).toContain('>Operations</span>');
    // a one-item group named like its item is a plain link
    expect(html).not.toContain('>Reports</span><ul');
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

  it('shows the profile (initials, name, roles); sign-out is in the account menu only', () => {
    const html = shell();
    expect(html).toContain('>OO<');
    expect(html).toContain('operations manager');
    expect(html.match(/action="\/ops\/api\/v1\/auth\/logout"/g)).toHaveLength(1);
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
  it('error state: a reference only when it exists, and an action slot for Try again', () => {
    const plain = renderToStaticMarkup(<ErrorState />);
    expect(plain).not.toContain('Reference');
    expect(plain).not.toContain('below');
    const out = renderToStaticMarkup(
      <ErrorState requestId="req-123" action={<a href="/ops/teachers">Try again</a>} />,
    );
    expect(out).toContain('<a href="/ops/teachers">Try again</a>');
    expect(out).toContain('<code class="el-request-id">req-123</code>');
  });
  it('brand logo: currentColor letters, orange chevrons, accessible name unless decorative', () => {
    const named = renderToStaticMarkup(<BrandLogo />);
    expect(named).toContain('role="img" aria-label="Elevate Education"');
    expect(named).toContain('<title>Elevate Education</title>');
    expect(named).toContain('stroke="currentColor"');
    expect(named).toContain('stroke-linecap="round"');
    expect(named).toContain('fill="#ff8623"');
    expect(named).toContain('fill="#ffa43d"');
    const decorative = renderToStaticMarkup(<BrandLogo decorative size="lg" />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('<title>');
    expect(decorative).toContain('el-brand-logo-lg');
  });
  it('login form keeps the post contract, shows the error above the form and the brand panel', () => {
    const html = renderToStaticMarkup(
      <LoginForm
        action="/marketing/api/v1/auth/login"
        next="/marketing"
        error="invalid"
        subtitle="Sign in to Marketing OS"
      />,
    );
    expect(html).toContain('action="/marketing/api/v1/auth/login" method="post"');
    expect(html).toContain('name="next" value="/marketing"');
    expect(html).toContain('<h1 id="el-login-title" class="el-login-title">Staff sign in</h1>');
    expect(html).toContain('Sign in to Marketing OS');
    expect(html.indexOf('Email or password is incorrect.')).toBeLessThan(html.indexOf('<form'));
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('aria-invalid'); // a wrong password is not pinned on one field
    expect(html).toContain('aria-label="Elevate Education"');
    for (const p of ['CLAT', 'IPMAT', 'CUET', 'CA Foundation', 'Class 11 Commerce', 'Dropper'])
      expect(html).toContain(`<li>${p}</li>`);
    expect(html).toContain('href="tel:+918505099888"');
    expect(html).toContain('Trouble signing in? Ask the operations manager.');
    expect(html).toMatch(/type="password" autoComplete="current-password"/);
  });
  it('login form marks both fields when the form came back empty', () => {
    const html = renderToStaticMarkup(
      <LoginForm action="/api/v1/auth/login" next="/" error="missing" />,
    );
    expect(html).toContain('Enter your email and password.');
    expect(html).toMatch(/aria-invalid="true" id="email"[^>]*aria-describedby="email-error"/);
    expect(html).toContain(
      '<p class="el-field-error" id="email-error">Enter your email address.</p>',
    );
    expect(html).toContain(
      '<p class="el-field-error" id="password-error">Enter your password.</p>',
    );
  });
  it('login form states the account domain and shows the Google link only when given', () => {
    const plain = renderToStaticMarkup(<LoginForm action="/api/v1/auth/login" next="/" />);
    expect(plain).toContain('Use your <strong>@elevateeducation.in</strong> account.');
    expect(plain).not.toContain('Sign in with Google');
    const href = 'http://localhost:3000/api/v1/auth/google/start?next=%2Facademic';
    const google = renderToStaticMarkup(
      <LoginForm action="/academic/api/v1/auth/login" next="/academic" googleHref={href} />,
    );
    expect(google).toContain(`href="${href}"`);
    expect(google).toContain('Sign in with Google');
    expect(google).toContain('action="/academic/api/v1/auth/login" method="post"');
  });
  it.each([
    ['google_domain', 'That Google account is not an Elevate Education account.'],
    ['google_cancelled', 'Google sign-in was cancelled.'],
    ['google_expired', 'Sign-in link expired — try again.'],
  ])('login error %s reads “%s”', (code, text) => {
    expect(
      renderToStaticMarkup(<LoginForm action="/api/v1/auth/login" next="/" error={code} />),
    ).toContain(text);
  });
});

describe('PageHeader and JourneyRail', () => {
  it('page header carries meta next to the title and the area tabs along its bottom', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="Admissions"
        meta={<SourceBadge source="sample" />}
        tabs={<nav className="el-subnav">t</nav>}
      />,
    );
    expect(html).toMatch(/<h1>Admissions<\/h1><span class="el-badge el-badge-sample"/);
    expect(html).toMatch(/<\/div><nav class="el-subnav">t<\/nav><\/div>$/);
  });

  const rail = (stages: Parameters<typeof JourneyRail>[0]['stages']) =>
    renderToStaticMarkup(<JourneyRail label="Admission journey" stages={stages} />);

  it.each([
    [
      'a count, linked, with a bar against the largest stage',
      { count: 5, href: '/ops/admissions' },
      ['href="/ops/admissions"', '>5<', 'width:50%'],
    ],
    ['a measured zero as 0', { count: 0 }, ['>0<', 'width:0%']],
    [
      'not recorded instead of 0, without a bar',
      { count: null },
      ['Not recorded', 'data-missing="true"'],
    ],
    [
      'the current stage in words and as aria-current',
      { state: 'current' as const },
      ['aria-current="step"', ': current stage'],
    ],
  ])('shows %s', (_, stage, expected) => {
    const html = rail([
      { key: 'top', label: 'Top', count: 10 },
      { key: 's', label: 'Demo', ...stage },
    ]);
    for (const e of expected) expect(html).toContain(e);
  });

  it('never draws a bar for a missing count', () => {
    expect(rail([{ key: 's', label: 'Demo', count: null }])).not.toContain('el-journey-bar');
  });
});
