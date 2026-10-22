import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { metric } from '@elevate/shared-contracts';
import {
  Alert,
  AppShell,
  Breadcrumbs,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  ICON_NAMES,
  Icon,
  JourneyRail,
  LoadingState,
  LoginForm,
  MetricStrip,
  PageHeader,
  Select,
  Subnav,
  Tabs,
  TextArea,
  TextInput,
  fieldDescribedBy,
  nextTabIndex,
  type AppShellProps,
} from '../src/index';

const tagWithId = (html: string, id: string) =>
  html.match(new RegExp(`<[a-z]+\\s[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

const shell = (props: Partial<AppShellProps> = {}) =>
  render(
    <AppShell
      user={{ displayName: 'Ola Ops (fictional)', email: 'ops@example.test', roles: ['ops'] }}
      modules={['platform', 'ops', 'academic']}
      current="ops"
      logoutAction="/ops/api/v1/auth/logout"
      nav={[{ href: '/ops/leads', label: 'Leads', active: true }]}
      search={{ action: '/ops/leads', label: 'Search leads' }}
      {...props}
    >
      <p>content</p>
    </AppShell>,
  );

describe('Buttons', () => {
  it.each([
    [
      'defaults to type="button" so it never submits a form by accident',
      <Button>Save</Button>,
      /^<button type="button"/,
    ],
    [
      'keeps an explicit submit type',
      <Button type="submit">Save</Button>,
      /^<button type="submit"/,
    ],
    [
      'passes disabled through (double-submit guard)',
      <Button disabled>Save</Button>,
      /disabled=""/,
    ],
    [
      'ButtonLink navigates with a real <a href>',
      <ButtonLink href="/ops">Open</ButtonLink>,
      /^<a class="el-button[^"]*" href="\/ops">Open<\/a>$/,
    ],
  ])('%s', (_, el, pattern) => {
    expect(render(el)).toMatch(pattern);
  });
});

describe('Field wiring', () => {
  it.each([
    ['TextInput', (p: object) => <TextInput {...p} />],
    [
      'Select',
      (p: object) => (
        <Select {...p}>
          <option>a</option>
        </Select>
      ),
    ],
    ['TextArea', (p: object) => <TextArea {...p} />],
  ])('%s: label, invalid state and error/hint are associated with the control', (_, control) => {
    const html = render(
      <Field id="f" label="Phone" hint="With +91" error="Enter a phone number.">
        {control({
          id: 'f',
          invalid: true,
          'aria-describedby': fieldDescribedBy('f', 'With +91', 'Enter a phone number.'),
        })}
      </Field>,
    );
    expect(html).toContain('<label for="f">Phone</label>');
    const tag = tagWithId(html, 'f');
    expect(tag).toContain('aria-invalid="true"');
    expect(tag).toContain('aria-describedby="f-hint f-error"');
    expect(html).toContain('id="f-hint">With +91</p>');
    expect(html).toContain('id="f-error">Enter a phone number.</p>');
  });

  it('a valid control has no aria-invalid and no dangling describedby or error text', () => {
    const html = render(
      <Field id="g" label="Name">
        <TextInput id="g" invalid={false} aria-describedby={fieldDescribedBy('g')} />
      </Field>,
    );
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('el-field-error');
  });

  it.each([
    [undefined, undefined, undefined],
    ['hint', undefined, 'x-hint'],
    [undefined, 'error', 'x-error'],
    ['hint', 'error', 'x-hint x-error'],
  ])('fieldDescribedBy(hint=%s, error=%s) → %s', (hint, error, expected) => {
    expect(fieldDescribedBy('x', hint, error)).toBe(expected);
  });

  it('Checkbox wraps its input in the label (clicking the text toggles it)', () => {
    expect(render(<Checkbox name="ok" label="Fee paid" />)).toBe(
      '<label class="el-checkbox"><input type="checkbox" name="ok"/>Fee paid</label>',
    );
  });
});

describe('Dialog', () => {
  const html = render(
    <Dialog id="d" title="New enquiry" triggerLabel="New enquiry" triggerIcon="plus">
      <p>form</p>
    </Dialog>,
  );
  it('has no dangling aria-describedby when there is no description', () => {
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('d-description');
  });
  it('trigger and close are type="button"; their icons are decorative', () => {
    const buttons = html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b).toMatch(/^<button[^>]*type="button"/);
      expect(b).toMatch(/<svg[^>]*aria-hidden="true"/);
    }
    expect(buttons[1]).toContain('<span class="el-visually-hidden">Close</span>');
  });
});

describe('Tabs', () => {
  it.each([
    ['ArrowUp', 0, 4, 3],
    ['ArrowLeft', 2, 4, 1],
    ['ArrowDown', 3, 4, 0],
    ['ArrowRight', 0, 1, 0],
    ['Enter', 1, 4, null],
    ['Tab', 1, 4, null],
    [' ', 1, 4, null],
  ])('nextTabIndex(%j, %i, %i) → %s', (key, index, count, expected) => {
    expect(nextTabIndex(key, index, count)).toBe(expected);
  });

  it('exactly one tab is selected and focusable; the panel is focusable and labelled by it', () => {
    const html = render(
      <Tabs
        idBase="t"
        label="Lead views"
        selected="b"
        items={[
          { key: 'a', label: 'Open', href: '?v=a', count: 0 },
          { key: 'b', label: 'Closed', href: '?v=b' },
        ]}
      >
        <p>panel</p>
      </Tabs>,
    );
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(2); // the selected tab + the panel
    expect(tagWithId(html, 't-panel')).toMatch(/role="tabpanel" aria-labelledby="t-tab-b"/);
    // a measured 0 is shown, and screen readers hear "Open, 0" rather than "Open0"
    expect(html).toContain(
      'Open<span class="el-visually-hidden">, </span><span class="el-tab-count">0</span>',
    );
  });
});

describe('Icons', () => {
  it('every icon is decorative by default, not focusable, and draws a path', () => {
    for (const name of ICON_NAMES) {
      const html = render(<Icon name={name} />);
      expect(html, name).toContain('aria-hidden="true" focusable="false"');
      expect(html, name).not.toContain('role=');
      expect(html, name).toMatch(/<path d="M[^"]+"/);
    }
  });
  it('a labelled icon is not also hidden', () => {
    expect(render(<Icon name="alert" label="Overdue" />)).not.toContain('aria-hidden');
  });
});

describe('AppShell landmarks and controls', () => {
  const html = shell({ unreadNotifications: 2 });

  it('the skip link is the first focusable element and targets the focusable main', () => {
    expect(html.match(/<(a|button|input|summary)\b[^>]*>/)?.[0]).toBe(
      '<a class="el-skip-link" href="#main">',
    );
    expect(html).toContain('<main id="main" class="el-main" tabindex="-1">');
  });

  it('has one main, one header, a labelled sidebar and labelled navs', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<header\b/g)).toHaveLength(1);
    expect(html).toContain(
      '<aside id="el-sidebar-ops" class="el-sidebar" aria-label="Main navigation">',
    );
    expect(html.match(/<nav\b[^>]*>/g)).toEqual([
      '<nav class="el-sidebar-nav" aria-label="Modules and sections">',
      '<nav class="el-breadcrumbs" aria-label="Breadcrumb">',
    ]);
  });

  it('every button has a type and an accessible name', () => {
    const buttons = html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) {
      expect(b).toMatch(/^<button[^>]*type="(button|submit)"/);
      expect(
        b
          .replace(/<svg.*?<\/svg>/g, '')
          .replace(/<[^>]+>/g, '')
          .trim(),
      ).not.toBe('');
    }
  });

  it('the current module is announced, not shown by colour alone', () => {
    expect(html).toMatch(/class="el-ws-option" href="\/ops" aria-current="true"/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it('the search box has a label tied to its input; the account menu is named', () => {
    expect(html).toContain(
      '<label class="el-visually-hidden" for="el-search-ops">Search leads</label>',
    );
    expect(tagWithId(html, 'el-search-ops')).toContain('type="search"');
    expect(html).toContain(
      '<span class="el-visually-hidden">Account menu for Ola Ops (fictional)</span>',
    );
  });

  it.each([
    [0, '0 unread notifications', null],
    [1, '1 unread notification', '1'],
    [120, '120 unread notifications', '99+'],
  ])('%i unread: screen readers hear "%s", the badge shows %s', (n, spoken, badge) => {
    const out = shell({ unreadNotifications: n });
    expect(out).toContain(`<span class="el-visually-hidden">${spoken}</span>`);
    const count = out.match(/<span class="el-notify-count" aria-hidden="true">(.*?)<\/span>/);
    expect(count?.[1] ?? null).toBe(badge);
  });
});

describe('Navigation', () => {
  it('breadcrumbs: the last crumb is the current page (not a link), separators are hidden', () => {
    const html = render(
      <Breadcrumbs
        items={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admissions' },
          { label: 'Leads', href: '/ops/leads' },
        ]}
      />,
    );
    expect(html).toContain('<a href="/ops">Ops</a>');
    expect(html).toContain('<span>Admissions</span>');
    expect(html).toContain('<span aria-current="page">Leads</span>');
    expect(html).not.toContain('href="/ops/leads"');
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(2);
    expect(render(<Breadcrumbs items={[]} />)).toBe('');
  });

  it('subnav is a labelled nav that marks only the current link', () => {
    const html = render(
      <Subnav
        label="Admissions areas"
        current="/b"
        items={[
          ['/a', 'Demos'],
          ['/b', 'Students'],
        ]}
      />,
    );
    expect(html).toBe(
      '<nav class="el-subnav" aria-label="Admissions areas"><a href="/a">Demos</a><a href="/b" aria-current="page">Students</a></nav>',
    );
  });

  it('a card is a section named by its heading only when the heading has an id', () => {
    expect(
      render(
        <Card id="c" title="Fees">
          x
        </Card>,
      ),
    ).toMatch(
      /^<section class="el-card" id="c" aria-labelledby="c-title">.*<h2 id="c-title">Fees<\/h2>/,
    );
    expect(render(<Card title="Fees">x</Card>)).not.toContain('aria-labelledby');
  });

  it('page header has exactly one h1', () => {
    expect(
      render(<PageHeader title="Leads" description="All enquiries" />).match(/<h1\b/g),
    ).toHaveLength(1);
  });
});

describe('Empty, loading and error states', () => {
  it.each([
    [
      'loading (default)',
      <LoadingState />,
      'role="status"',
      ['Loading…', '<span class="el-spinner" aria-hidden="true">'],
    ],
    [
      'loading (custom)',
      <LoadingState label="Loading leads…" />,
      'role="status"',
      ['Loading leads…'],
    ],
    [
      'error (default)',
      <ErrorState />,
      'role="alert"',
      ['<h2>Something went wrong</h2>', 'Try again', 'administrator'],
    ],
    [
      'no access (replaces the page, so it is the h1)',
      <ErrorState level={1} title="No access" description="Ask a platform administrator." />,
      'role="alert"',
      ['<h1>No access</h1>', 'Ask a platform administrator.'],
    ],
    [
      'empty with a next action',
      <EmptyState
        title="No leads yet"
        description="Leads appear when an enquiry is saved."
        action={<a href="/ops/leads/new">Add a lead</a>}
      />,
      'data-state="empty"',
      [
        '<h2>No leads yet</h2>',
        'Leads appear when an enquiry is saved.',
        '<a href="/ops/leads/new">Add a lead</a>',
      ],
    ],
  ])('%s says what is happening and what to do', (_, el, marker, texts) => {
    const html = render(el);
    expect(html).toContain(marker);
    for (const t of texts) expect(html).toContain(t);
    expect(html.replace(/<[^>]+>/g, '').trim()).not.toMatch(/^0?$/);
  });

  it.each([
    ['danger', 'alert'],
    ['warning', 'status'],
    ['success', 'status'],
    ['info', 'status'],
  ] as const)('Alert tone %s uses role="%s"', (tone, role) => {
    expect(
      render(
        <Alert tone={tone} title="Saved">
          Done
        </Alert>,
      ),
    ).toContain(`role="${role}"`);
  });
});

describe('DataTable', () => {
  const cols = [
    { key: 'name', header: 'Name' },
    { key: 'fee', header: 'Fee', numeric: true },
  ];

  it('has a caption and column headers with scope="col"', () => {
    const html = render(
      <DataTable
        caption="Students"
        columns={cols}
        rows={[{ name: 'Sample Student', fee: 5 }]}
        rowKey={(r) => r.name}
      />,
    );
    expect(html).toMatch(/<table class="el-table"><caption>Students<\/caption><thead>/);
    expect(html.match(/<th scope="col"/g)).toHaveLength(2);
  });

  it('with no rows shows a message (default or given) instead of an empty table', () => {
    const none = render(<DataTable columns={cols} rows={[]} rowKey={() => ''} />);
    expect(none).not.toContain('<table');
    expect(none).toContain('<h2>Nothing here yet</h2>');
    const custom = render(
      <DataTable
        columns={cols}
        rows={[]}
        rowKey={() => ''}
        empty={<EmptyState title="No students in this batch" />}
      />,
    );
    expect(custom).toContain('No students in this batch');
    expect(custom).not.toContain('Nothing here yet');
  });

  it.each([
    [undefined, ''],
    [null, ''],
    [0, '0'],
  ])('a fee of %s renders as "%s" (never "undefined"/"null"; zero stays 0)', (fee, shown) => {
    const html = render(
      <DataTable columns={cols} rows={[{ name: 'A', fee }]} rowKey={(r) => r.name} />,
    );
    expect(html).toContain(`data-label="Fee">${shown}</td>`);
  });

  it('long text is rendered in full and cells wrap instead of truncating', () => {
    const long = 'Sample Student '.repeat(30).trim();
    expect(
      render(<DataTable columns={cols} rows={[{ name: long, fee: 1 }]} rowKey={(r) => r.name} />),
    ).toContain(`>${long}</td>`);
    const css = readFileSync(new URL('../src/css/components.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.el-table td \{[^}]*overflow-wrap: break-word/);
  });

  it('a field whose control is required shows a visible marker', () => {
    const css = readFileSync(new URL('../src/css/components.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.el-field:has\([^)]*:required[^{]*> label::after \{[^}]*content: ' \*'/);
  });
});

describe('Escaping user text', () => {
  const evil = '<script>alert("x")</script>';
  it.each<[string, () => string]>([
    [
      'table cell',
      () =>
        render(
          <DataTable
            columns={[{ key: 'n', header: 'N' }]}
            rows={[{ n: evil }]}
            rowKey={() => 'k'}
          />,
        ),
    ],
    ['empty state title', () => render(<EmptyState title={evil} />)],
    [
      'field label',
      () =>
        render(
          <Field id="e" label={evil}>
            <TextInput id="e" />
          </Field>,
        ),
    ],
    ['page title', () => render(<PageHeader title={evil} />)],
    [
      'shell user name',
      () => shell({ user: { displayName: evil, email: 'a@example.test', roles: [] } }),
    ],
  ])('%s escapes markup', (_, html) => {
    expect(html()).not.toContain('<script>');
    expect(html()).toContain('&lt;script&gt;');
  });

  it('quotes in labels stay inside the attribute', () => {
    expect(
      render(
        <Tabs idBase="q" label={'Say "hi"'} items={[]} selected="">
          x
        </Tabs>,
      ),
    ).toContain('aria-label="Say &quot;hi&quot;"');
  });
});

describe('LoginForm', () => {
  const html = render(<LoginForm action="/api/v1/auth/login" next="/" />);

  it.each([
    ['email', ['name="email"', 'type="email"', 'autoComplete="username"', 'required=""']],
    [
      'password',
      ['name="password"', 'type="password"', 'autoComplete="current-password"', 'required=""'],
    ],
  ])('%s field: labelled, typed for autofill and required', (id, attrs) => {
    expect(html).toContain(`<label for="${id}">`);
    const tag = tagWithId(html, id);
    for (const a of attrs) expect(tag).toContain(a);
  });

  it('without an error there is no alert and no field is marked invalid', () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid');
  });

  it('submits with a real submit button inside the post form', () => {
    expect(html).toMatch(
      /<form action="\/api\/v1\/auth\/login" method="post">.*<button type="submit"[^>]*>Sign in<\/button><\/form>/,
    );
  });

  it.each([
    ['locked', 'Too many failed attempts. Try again in 15 minutes.'],
    ['unavailable', 'Sign-in is unavailable right now. Try again shortly.'],
    ['domain', 'Only @elevateeducation.in accounts can sign in.'],
    ['google_disabled', 'This account is switched off. Ask a platform administrator.'],
    ['something_new', 'Email or password is incorrect.'],
  ])('error "%s" shows a plain-language alert, never the raw code', (code, text) => {
    const out = render(<LoginForm action="/a" next="/" error={code} />);
    expect(out).toMatch(new RegExp(`role="alert"><div class="el-alert-body">${text}</div>`));
    expect(out).not.toContain(`>${code}<`);
  });
});

describe('Missing is not zero (strip and journey)', () => {
  it('an estimated strip figure shows ≈ and its basis', () => {
    const html = render(
      <MetricStrip
        label="Reach"
        items={[
          {
            label: 'Views',
            metric: metric.estimated(1500, 'From 2 of 5 accounts', {
              definition: 'Post views',
              window: { from: '2026-10-01', to: '2026-10-07' },
              unit: 'count',
            }),
          },
        ]}
      />,
    );
    expect(html).toContain('class="el-metric-value">≈ 1,500<');
    expect(html).toContain('Estimated: From 2 of 5 accounts');
  });

  it.each([
    ['done', ': done'],
    ['upcoming', ': not reached'],
  ] as const)('a %s stage is stated in words for screen readers', (state, words) => {
    const html = render(
      <JourneyRail label="Journey" stages={[{ key: 'a', label: 'Demo', state }]} />,
    );
    expect(html).toContain(`<span class="el-visually-hidden">${words}</span>`);
    expect(html).not.toContain('aria-current');
  });
});
