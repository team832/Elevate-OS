import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Column } from '@elevate/shared-ui';
import {
  donutArcs,
  fmtPercent,
  foldOther,
  funnelRows,
  linePath,
  linePoints,
  niceMax,
  percent,
  summarise,
} from '../../src/ui/chart-math';
import {
  BarChart,
  DonutChart,
  FunnelChart,
  LineChart,
  Sparkline,
  StatCard,
} from '../../src/ui/charts';
import { humanise } from '../../src/ui/format';
import { RecordTable } from '../../src/ui/record-table';
import { DetailTable, FormSection, Segment } from '../../src/ui/sections';
import { SearchPanel } from '../../src/ui/list-controls';
import { rowLinkFor } from '../../src/ui/row-links';
import { FormModal, RecordModal } from '../../src/ui/record-modal';
import {
  ActionForm,
  FormAlert,
  groupSections,
  plainError,
  submitGate,
} from '../../src/ui/action-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('chart maths', () => {
  it.each([
    [5, 20, 25],
    [0, 20, 0],
    [3, 0, null],
    [null, 20, null],
    [4, null, null],
  ])('percent(%s, %s) = %s', (part, whole, expected) => {
    expect(percent(part, whole)).toBe(expected);
  });

  it.each([
    [null, '—'],
    [0, '0%'],
    [0.4, '<1%'],
    [33.333, '33%'],
    [100, '100%'],
  ])('fmtPercent(%s) = %s', (p, expected) => expect(fmtPercent(p)).toBe(expected));

  it.each([
    [0, 1],
    [-3, 1],
    [1, 1],
    [3, 5],
    [7, 10],
    [12, 20],
    [23, 25],
    [140, 200],
    [0.3, 0.5],
  ])('niceMax(%s) = %s', (max, expected) => expect(niceMax(max)).toBeCloseTo(expected));

  it('folds everything after the fifth entry into "Other", keeping input order', () => {
    const data = [1, 2, 3, 4, 5, 6, 7].map((v) => ({ label: `P${v}`, value: v }));
    const folded = foldOther(data);
    expect(folded.map((d) => d.label)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'Other']);
    expect(folded.at(-1)?.value).toBe(13);
    expect(foldOther(data.slice(0, 6))).toHaveLength(6);
    expect(
      foldOther([...data.slice(0, 5), { label: 'A', value: null }, { label: 'B', value: null }]).at(
        -1,
      )?.value,
    ).toBeNull();
  });

  it('donut arcs share the circle, skip missing values and keep their input slot', () => {
    const arcs = donutArcs([
      { label: 'A', value: 30 },
      { label: 'B', value: null },
      { label: 'C', value: 10 },
    ]);
    expect(arcs?.map((a) => a.slot)).toEqual([0, 2]);
    expect(arcs?.map((a) => a.share)).toEqual([75, 25]);
    expect(arcs?.[0]?.offset).toBe(25); // starts at 12 o'clock
    expect(arcs?.[1]?.offset).toBe(-50);
    expect(arcs?.[0]?.dash).toBeCloseTo(74.2); // 75 minus the 0.8 gap
    expect(donutArcs([{ label: 'Only', value: 4 }])?.[0]?.dash).toBe(100);
  });

  it.each([[[]], [[{ label: 'A', value: 0 }]], [[{ label: 'A', value: null }]]])(
    'donut has nothing to draw for %j',
    (data) => expect(donutArcs(data)).toBeNull(),
  );

  it('line points scale to the top and a missing value breaks the line', () => {
    const points = linePoints([0, 5, null, 10], 10);
    expect(points).toEqual([{ x: 0, y: 40 }, { x: 33.33, y: 20 }, null, { x: 100, y: 0 }]);
    expect(linePath(points)).toBe('M0 40L33.33 20M100 0');
  });

  it('funnel rows give widths against the first stage and step conversion', () => {
    const rows = funnelRows([
      { label: 'Leads', value: 40 },
      { label: 'Demos', value: 10 },
      { label: 'Admissions', value: null },
      { label: 'Paid', value: 2 },
    ]);
    expect(rows?.map((r) => r.width)).toEqual([100, 25, null, 5]);
    expect(rows?.map((r) => r.fromPrevious)).toEqual([null, 25, null, null]);
    expect(funnelRows([{ label: 'Leads', value: 0 }])).toBeNull();
    expect(funnelRows([{ label: 'Leads', value: null }])).toBeNull();
  });

  it('summarises short series in full and long ones by shape', () => {
    expect(
      summarise('Demos', [
        { label: 'Mon', value: 2 },
        { label: 'Tue', value: null },
      ]),
    ).toBe('Demos: Mon 2, Tue not recorded.');
    const long = Array.from({ length: 14 }, (_, i) => ({
      label: `D${i + 1}`,
      value: i === 6 ? 9 : 1,
    }));
    expect(summarise('Leads', long)).toBe(
      'Leads: 14 points from D1 to D14; first D1 1, last D14 1, highest D7 9.',
    );
  });
});

describe('charts render honestly', () => {
  const data = [
    { label: 'CLAT', value: 12, href: '/ops/students?programme=clat' },
    { label: 'IPMAT', value: null },
  ];

  it('horizontal bars: a labelled list, links, and "Not recorded" instead of 0', () => {
    const out = html(<BarChart label="Students by programme" data={data} />);
    expect(out).toContain('aria-label="Students by programme"');
    expect(out).toContain('href="/ops/students?programme=clat"');
    expect(out).toContain('Not recorded');
    expect(out).not.toMatch(/el-hbar-value">0</);
  });

  it('vertical bars: image summary plus a table toggle', () => {
    const out = html(<BarChart label="Per day" data={data} orientation="vertical" />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Per day: CLAT 12, IPMAT not recorded."');
    expect(out).toContain('Show as table');
  });

  it.each([
    ['bar', <BarChart key="b" label="X" data={[{ label: 'A', value: null }]} />],
    ['donut', <DonutChart key="d" label="X" data={[{ label: 'A', value: 0 }]} />],
    ['line', <LineChart key="l" label="X" data={[{ label: 'A', value: 3 }]} />],
    ['funnel', <FunnelChart key="f" label="X" data={[{ label: 'A', value: null }]} />],
  ])('%s chart shows "Not enough data" instead of drawing zeros', (_, node) => {
    const out = html(node);
    expect(out).toContain('Not enough data');
    expect(out).not.toContain('<svg');
  });

  it('donut: arcs, centre total and legend with shares', () => {
    const out = html(
      <DonutChart
        label="Outcomes"
        data={[
          { label: 'Joined', value: 3 },
          { label: 'Lost', value: 1 },
        ]}
      />,
    );
    expect(out.match(/el-donut-arc/g)).toHaveLength(2);
    expect(out).toContain('Outcomes: Joined 3 (75%), Lost 1 (25%). Total 4.');
    expect(out).toContain('el-c2');
  });

  it('line chart labels the last value; sparkline is decorative without a label', () => {
    const out = html(
      <LineChart
        label="Leads"
        data={[
          { label: '1 Oct', value: 2 },
          { label: '2 Oct', value: 5 },
        ]}
      />,
    );
    expect(out).toContain('el-line-end">5<');
    expect(html(<Sparkline values={[1, 2, 3]} />)).toContain('aria-hidden="true"');
    expect(html(<Sparkline values={[1]} />)).toBe('');
  });

  it('funnel shows step conversion', () => {
    const out = html(
      <FunnelChart
        label="Admissions funnel"
        data={[
          { label: 'Leads', value: 40 },
          { label: 'Demos', value: 10 },
          { label: 'Admitted', value: 5 },
        ]}
      />,
    );
    expect(out).toContain('25% of previous');
    expect(out).toContain('Leads to Admitted: 13%');
  });

  it('stat card: missing is "Not recorded", a link marks the active filter', () => {
    expect(html(<StatCard label="Fees due" value={null} />)).toContain('Not recorded');
    expect(
      html(<StatCard label="Conversion" value={null} missingLabel="Not enough data" />),
    ).toMatch(/el-stat-missing.*Not enough data/);
    const out = html(
      <StatCard label="Today" value={0} href="/ops/admissions?view=current" current />,
    );
    expect(out).toContain('aria-current="true"');
    expect(out).toContain('el-stat-value">0<');
  });
});

describe('humanise', () => {
  it.each([
    ['upi', 'UPI'],
    ['whatsapp', 'WhatsApp'],
    ['sms', 'SMS'],
    ['bank_transfer', 'Bank transfer'],
    [null, '—'],
  ])('%s → %s', (code, label) => expect(humanise(code)).toBe(label));
});

describe('tables and sections', () => {
  type Row = { id: string; name: string; fees: number };
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Student' },
    { key: 'fees', header: 'Fees', numeric: true },
  ];

  it('record table: real link in the first cell, numbers right-aligned', () => {
    const out = html(
      <RecordTable
        columns={columns}
        rows={[{ id: 'a1', name: 'Asha (fictional)', fees: 1200 }]}
        rowKey={(r) => r.id}
        rowHref={(r) => `/ops/students?open=${r.id}`}
        caption="1 student"
      />,
    );
    expect(out).toContain(
      '<a href="/ops/students?open=a1" data-row-link="" data-drawer-return="a1">',
    );
    expect(out).toContain('class="ops-row-link"');
    expect(out).toContain('<td class="el-num" data-label="Fees"><div>1200</div></td>');
    expect(out).toContain('<caption>1 student</caption>');
  });

  it('record table: phone cards get labels from string headers; only long lists get a well', () => {
    const row = (i: number) => ({ id: `r${i}`, name: `Sample ${i}`, fees: i });
    const table = (n: number, cols = columns) =>
      html(
        <RecordTable
          columns={cols}
          rows={Array.from({ length: n }, (_, i) => row(i))}
          rowKey={(r) => r.id}
        />,
      );
    expect(table(1)).toContain('class="el-table el-table-compact ops-table"');
    expect(table(1)).toContain('<td data-label="Student"><div>Sample 0</div></td>');
    expect(table(1, [{ key: 'name', header: <b>Student</b> }])).toContain(
      '<td><div>Sample 0</div></td>',
    );
    const multi: Column<Row> = {
      key: 'due',
      header: 'Due',
      render: () => (
        <>
          Today<small>hint</small>
          <button>Mark done</button>
        </>
      ),
    };
    expect(table(1, [multi])).toContain(
      '<td data-label="Due"><div>Today<small>hint</small><button>Mark done</button></div></td>',
    );
    expect(table(25)).toContain('class="el-table-wrap"');
    expect(table(26)).toContain('class="el-table-wrap ops-table-well"');
  });

  it('record table: empty state row under the real headers', () => {
    const out = html(
      <RecordTable columns={columns} rows={[]} rowKey={(r) => r.id} empty="No students yet." />,
    );
    expect(out).toContain('<th scope="col">Student</th>');
    expect(out).toContain('<td colSpan="2" class="ops-table-empty">No students yet.</td>');
  });

  it('detail table skips falsy rows; segment uses the requested heading level', () => {
    const out = html(
      <Segment title="Admission" level={3} flush>
        <DetailTable rows={[{ label: 'Counsellor', value: 'Unassigned' }, false, null]} />
      </Segment>,
    );
    expect(out).toContain('<h3');
    expect(out).toContain('ops-segment-flush');
    expect(out.match(/<tr>/g)).toHaveLength(1);
    expect(out).toContain('<th scope="row">Counsellor</th>');
    expect(html(<FormSection title="Programme">x</FormSection>)).toContain(
      '<legend>Programme</legend>',
    );
  });

  it('search panel: search box, filters disclosure and chips that drop one filter and the page', () => {
    const out = html(
      <SearchPanel
        action="/ops/students"
        hidden={{ tab: 'former' }}
        search={{ name: 'q', label: 'Name or admission number', value: 'asha' }}
        filters={[
          {
            name: 'programme',
            label: 'Programme',
            type: 'select',
            options: [{ value: 'clat', label: 'CLAT' }],
            value: 'clat',
          },
          { name: 'from', label: 'From', type: 'date', value: '2026-10-01' },
          { name: 'owner', label: 'Counsellor' },
        ]}
      />,
    );
    expect(out).toContain('type="search"');
    expect(out).toContain('Filters (2 active)');
    expect(out).toContain('Programme: CLAT');
    expect(out).toContain('From: 1 Oct 2026');
    expect(out).toContain('href="/ops/students?tab=former&amp;q=asha&amp;from=2026-10-01"');
    expect(out).toContain('Remove filter Programme');
  });
});

describe('record modal and forms', () => {
  it('renders a centred dialog with header actions and accessible tabs', () => {
    const out = html(
      <RecordModal
        id="student-modal"
        title="Asha (fictional)"
        fullHref="/ops/students/a1"
        closeHref="/ops/students"
        tabs={[
          { key: 'overview', label: 'Overview', content: 'First panel' },
          { key: 'fees', label: 'Fees', content: 'Second panel', count: 2 },
        ]}
      />,
    );
    expect(out).toContain('<dialog id="student-modal" class="el-dialog ops-modal"');
    expect(out).toContain('Open full record');
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-selected="true"');
    expect(out).toMatch(/id="student-modal-panel-fees"[^>]*hidden/);
    expect(html(<FormModal id="f" title="Book a demo" closeHref="/ops/admissions" />)).toContain(
      'el-dialog ops-modal ops-modal-form',
    );
  });

  it('action form groups consecutive fields into sections with a footer', () => {
    const fields = [
      { name: 'a', label: 'A', section: 'Student' },
      { name: 'b', label: 'B', section: 'Student', type: 'textarea' as const },
      { name: 'c', label: 'C', section: 'Fees' },
    ];
    expect(groupSections(fields).map((g) => [g.title, g.fields.length])).toEqual([
      ['Student', 2],
      ['Fees', 1],
    ]);
    const out = html(
      <ActionForm action="/ops/api/v1/x" submitLabel="Save" fields={fields} secondary="Cancel" />,
    );
    expect(out.match(/<legend>/g)).toHaveLength(2);
    expect(out).toContain('el-field el-field-wide');
    expect(out).toMatch(/ops-form-footer el-glass">Cancel<button type="submit"/);
  });

  it('submit gate: one request at a time; a failed key is reused only for the same body', async () => {
    let n = 0;
    const gate = submitGate(() => `test-key-${++n}`);
    const keys: string[] = [];
    let release = () => {};
    const slow = (key: string) =>
      new Promise<{ error?: { code: string; message: string } }>((resolve) => {
        keys.push(key);
        release = () => resolve({});
      });
    const first = gate('a', slow);
    // A double click while the first request is in flight never sends a second one.
    expect(await gate('a', slow)).toBeNull();
    release();
    await first;
    const fail = async (key: string) => (
      keys.push(key),
      { error: { code: 'NETWORK', message: 'x' } }
    );
    const ok = async (key: string) => (keys.push(key), {});
    await gate('a', fail);
    await gate('a', ok); // retry of the same body replays under the same key
    await gate('a', ok); // after a success the same body is a new request
    await gate('b', fail);
    await gate('c', ok); // changed after a failure: new key, never "already used with a different request"
    expect(keys).toEqual([
      'test-key-1',
      'test-key-2',
      'test-key-2',
      'test-key-3',
      'test-key-4',
      'test-key-5',
    ]);
    const conflict = {
      code: 'CONFLICT',
      message: 'This Idempotency-Key was already used with a different request.',
    };
    expect(plainError(conflict).message).not.toContain('Idempotency');
    const business = { code: 'CONFLICT', message: 'Admission already confirmed.' };
    expect(plainError(business)).toBe(business);
  });

  it('labelSuffix gives repeated row forms distinct accessible names', () => {
    const out = html(
      <ActionForm
        action="/x"
        submitLabel="Save"
        labelSuffix=" for Call Asha"
        fields={[{ name: 'status', label: 'Status' }]}
      />,
    );
    expect(out).toMatch(/Status<span class="el-visually-hidden"> for Call Asha<\/span>/);
    expect(out).toMatch(/Save<span class="el-visually-hidden"> for Call Asha<\/span><\/button>/);
  });

  it('error summary: 2+ field issues link to their fields; one issue keeps the server message', () => {
    const fieldFor = (i: { path?: (string | number)[] }) =>
      i.path?.[0] === 'other'
        ? undefined
        : { id: `f-${i.path?.[0]}`, label: `Label ${i.path?.[0]}` };
    const error = { code: 'VALIDATION', message: 'The request body is not valid.' };
    const two = html(
      <FormAlert
        error={error}
        fieldFor={fieldFor}
        issues={[
          { path: ['amountRupees'], message: 'Enter an amount' },
          { path: ['notes'], message: 'Give a reason' },
        ]}
      />,
    );
    expect(two).toContain('role="alert" tabindex="-1"');
    expect(two).toContain('There is a problem');
    expect(two).toContain('<a href="#f-amountRupees">Label amountRupees: Enter an amount</a>');
    const one = html(
      <FormAlert error={error} fieldFor={fieldFor} issues={[{ path: ['notes'], message: 'x' }]} />,
    );
    expect([one.includes(error.message), one.includes('<ul>')]).toEqual([true, false]);
    // An issue no field shows is listed as text.
    expect(
      html(
        <FormAlert
          error={error}
          fieldFor={fieldFor}
          issues={[{ path: ['other'], message: 'Bad id' }]}
        />,
      ),
    ).toContain('<li>Bad id</li>');
  });

  it('fields: phone keypads, hints tied to inputs, the typed amount in the button', () => {
    const out = html(
      <ActionForm
        action="/ops/api/v1/x"
        submitLabel="Record payment"
        amountLabel="Record {amount} payment"
        fields={[
          {
            name: 'amountRupees',
            label: 'Amount (₹)',
            type: 'money',
            defaultValue: '5000',
            hint: 'e.g. 25000',
          },
          { name: 'phone', label: 'Phone', type: 'tel' },
          { name: 'kind', label: 'Kind', type: 'select', options: [{ value: 'a', label: 'A' }] },
        ]}
      />,
    );
    expect(out).toMatch(/type="text" inputMode="decimal"/);
    expect(out).toMatch(/type="tel" inputMode="tel" autoComplete="tel"/);
    expect(out).toMatch(/aria-describedby="([^"]+)-amountRupees-hint"/);
    expect(out).toMatch(/<p id="[^"]+-amountRupees-hint" class="el-field-hint">e.g. 25000<\/p>/);
    expect(out).toContain('Record ₹5,000 payment</button>');
    expect(out).not.toContain('disabled');
    // Without an amount the plain label shows.
    expect(
      html(
        <ActionForm
          action="/x"
          submitLabel="Record payment"
          amountLabel="Record {amount} payment"
          fields={[{ name: 'amountRupees', label: 'Amount', type: 'money' }]}
        />,
      ),
    ).toContain('Record payment</button>');
  });

  it('a row click follows the row link unless it landed on something interactive', () => {
    const link = { tag: 'row link' };
    const row = { querySelector: () => link, contains: () => true };
    const el = (interactive: boolean) =>
      ({
        closest: (sel: string) => (sel === 'tr' ? row : interactive ? {} : null),
      }) as unknown as Element;
    expect(rowLinkFor(el(false))).toBe(link);
    expect(rowLinkFor(el(true))).toBeNull();
    // Taps inside a disclosure ("Mark done") or a button group (attendance) stay there.
    let selector = '';
    rowLinkFor({
      closest: (sel: string) => ((selector ||= sel === 'tr' ? '' : sel), null),
    } as unknown as Element);
    expect(selector).toContain('details');
    expect(selector).toContain('[role="group"]');
    // A disclosure around the whole table is an ancestor, not a control in the row.
    const outside = { querySelector: () => link, contains: () => false };
    expect(
      rowLinkFor({ closest: (sel: string) => (sel === 'tr' ? outside : {}) } as unknown as Element),
    ).toBe(link);
  });
});
