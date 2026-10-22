# Business Ops UI kit (`src/ui`)

Server components unless marked _client_. Reuse `@elevate/shared-ui` first (`PageHeader` with `meta`/`tabs`, `JourneyRail`, `StatusBadge`, `Tabs`, `Card`, `EmptyState`, `Field`, `Button`, `Alert`, and the charts). Colours, type, shape and depth are tokens in `@elevate/shared-ui` (`styles.css` imports `css/base.css` tokens, `shell.css`, `components.css`, `charts.css`, `login.css`; `--el-*`: canvas `--el-bg`, well `--el-well`, card `--el-surface`, raised `--el-surface-muted`, overlay `--el-overlay`, radii `--el-radius-pill` / `-sm` / default / `-lg`, shadows `--el-shadow*`). `src/app/ops.css` holds only Ops-specific layout (KPI grid, record tables, detail table, the record pop-up, search toolbar, timeline). Tokens only: no hex, px radius, custom shadow or blur.

Layout (owner, 22 Oct 2026): a light linen canvas with a floating white sidebar rail and a frosted top bar; each page is a display-face masthead followed by rounded panels. A page is `PageHeader` (title, meta pills, one-line description, primary action, area tabs via `tabs={<AdmissionsNav … />}`, a pill segmented control) → KPI tiles (`<ul className="el-grid ops-kpis">` of `StatCard`s, a grid of raised tiles) → `SearchPanel` toolbar (search pill, "Filters" pill, chips) → view `Tabs` (pill segmented control) → `RecordTable` (a rounded well) → `Pager`. Records open in a frosted centred panel from 641px and a curved bottom sheet with a grab handle below. Orange is only for primary buttons, the current nav item / tab / KPI filter and the current journey stage; orange text uses `--el-accent-text`.

| Component | File | Use it for |
|---|---|---|
| `RecordModal` _client_ | `record-modal.tsx` | The centred record pop-up for `?open=<id>` |
| `FormModal` _client_ | `record-modal.tsx` | A create/edit flow in the same pop-up (narrower) |
| `RecordTable` | `record-table.tsx` | Every list table; whole-row click-through |
| `Segment` | `sections.tsx` | A section card with a title row (pages, pop-ups, profiles) |
| `Timeline` | `sections.tsx` | Activity: newest first, when · what · who |
| `JourneyRail` | `@elevate/shared-ui` | The admission journey (Demo → Application → Signed → Confirmed → Active): counts on dashboards, `state` per stage on a record |
| `DetailTable` | `sections.tsx` | Label/value facts of a record (replaces `<dl>` / loose text) |
| `FormSection` | `sections.tsx` | A titled group of fields in the 2-column form grid |
| `ActionForm` _client_ | `action-form.tsx` | Every JSON form posting to `/ops/api/v1` (details below) |
| `TaskList` | `sections.tsx` | "What is still needed" list (state in words, what is missing, link to fix it), built only from the server's own gap check |
| `MetricStrip` | `@elevate/shared-ui` | A grid of headline figure tiles from `Metric`s; a missing figure says "Not available", never 0 |
| `SearchPanel` | `list-controls.tsx` | The list search section (one box + "Filters" disclosure + chips) |
| `listHref`, `Pager`, `options` | `list-controls.tsx` | URLs that keep params, "Showing 1–25 of 112", select options |
| `BarChart`, `DonutChart`, `LineChart`, `Sparkline`, `FunnelChart`, `StatCard` | `@elevate/shared-ui` (`charts.tsx` and `chart-math.ts` here re-export them) | Charts with hover tooltips and KPI tiles; `el-chart*`, `el-hbar*`, `el-vbar*`, `el-donut*`, `el-line*`, `el-funnel*`, `el-kpi` classes and `--el-chart-*` tokens (the old `ops-chart*` CSS is gone) |

`FilterForm` (old inline filter row) is no longer used by any page; delete it when `list-controls.tsx` is next touched.

## RecordModal — `?open=<id>`

Native `<dialog>` + `showModal()`: from 641px a centred frosted panel `min(56rem, 100vw − 2rem)`, max 90% of the screen height, with a dimmed and blurred backdrop; at 640px and below a curved bottom sheet (max 92% of the screen height) with a grab handle. Scrolling body, sticky header whose section tabs are the shared pill segmented control. Escape, the close button and a backdrop click close it; closing does `router.replace(closeHref)` (strips `/ops`, D-022) and focuses the row link with `data-drawer-return={returnId}`. Page scroll is locked while open. Never open a modal from inside a modal: multi-step flows get their own route.

```tsx
import { RecordModal } from '../../ui/record-modal';

<RecordModal
  id="student-modal"
  title={d.person.fullName}
  meta={<><StatusBadge tone="success">Enrolled</StatusBadge> ADM-000009</>}
  fullHref={`/ops/students/${d.id}`}
  closeHref={listHref(BASE, params, { open: undefined })}
  returnId={d.id}
  tabs={[
    { key: 'overview', label: 'Overview', content: <Segment title="Admission" level={3} flush><DetailTable rows={…} /></Segment> },
    { key: 'fees', label: 'Fees', count: 3, content: <StudentFees … /> },
  ]}
>
  {/* optional summary shown above the tabs */}
</RecordModal>
```

Pages still importing `RecordModal as Drawer` work unchanged; rename when you touch them.

## FormModal + ActionForm sections

```tsx
<FormModal id="book-demo" title="Book a demo" closeHref={close}>
  <ActionForm
    action="/ops/api/v1/demos"
    submitLabel="Book demo"
    secondary={<a href={close}>Cancel</a>}
    fields={[
      { name: 'studentName', label: 'Student name', required: true, section: 'Student' },
      { name: 'phone', label: 'Phone', type: 'tel', section: 'Student' },
      { name: 'programmeId', label: 'Programme', type: 'select', options, section: 'Demo' },
      { name: 'notes', label: 'Notes', type: 'textarea', section: 'Demo' },
    ]}
  />
</FormModal>
```

Consecutive fields with the same `section` become one `FormSection` well with a header bar (2 columns from 720px; text areas and checkboxes span both). Field errors show under each field. Inside a modal the footer (error, Cancel, submit) sticks to the bottom as a frosted bar: put the form **last** in the modal body. Forms without `section` render exactly as before.

ActionForm behaviour (21 Oct 2026):
- **One request at a time.** The submit button is disabled before the request starts, so a double click sends one request.
- **Automatic `Idempotency-Key`.** Every request carries a key (`submitGate`). The key is kept until a request succeeds, so a retry after a network error replays on the server instead of posting twice; after a success a new key starts (a second identical payment is then deliberate). Fee routes accept the key (`idempotency: 'optional'`). `headers` can still add a page-made key.
- **`type: 'money'`** takes rupees as typed ("25,000.50"), opens a decimal keypad on phones and is sent as the typed text (the route parses rupees, e.g. `totalRupees`).
- **`amountLabel`** puts the amount in the button once the money field holds one: `amountLabel="Record payment of {amount}"` → "Record payment of ₹5,000".
- **`successText`** is shown after success (default "Saved."), e.g. "Attendance recorded for Day 2, class 1".
- **Errors:** one problem shows as one message; two or more field problems show a "There is a problem" summary at the top whose links move focus to each field (GOV.UK pattern), and the message under each field.

## RecordTable

```tsx
<RecordTable
  caption={`${total} students`}
  columns={columns}              // shared-ui Column<T>[]; numeric: true right-aligns
  rows={rows}
  rowKey={(r) => r.id}
  rowHref={(r) => listHref(BASE, params, { open: r.id })}
  linkColumn="name"              // default: first column
  empty={<EmptyState title="No students match" description="Clear a filter to see more." />}
/>
```

The link column's cell is wrapped in the real `<a data-row-link data-drawer-return>` (keyboard: Tab to it, Enter). A click anywhere else on the row follows that link; clicks on other links, buttons and inputs in the row keep their own behaviour. **Keep the link column free of other links or buttons** (no nested `<a>`). The table stacks into labelled cards below 720px (shared `.el-table-compact` in `@elevate/shared-ui`, labels from `data-label`; the link cell is the card title); only lists longer than 25 rows get a scroll well with a sticky header. Put the `Pager` after it.

## Segment, DetailTable

```tsx
<Segment title="Admission" level={3} flush actions={<a href={editHref}>Edit admission</a>}>
  <DetailTable
    rows={[
      { label: 'Admission no.', value: d.admissionNumber ?? 'Not assigned' },
      { label: 'Status', value: <StatusBadge tone={tone}>{label}</StatusBadge> },
      d.holdReviewDate && { label: 'On hold until', value: fmtDate(d.holdReviewDate) },
      { label: 'Programmes', value: <ul>{…}</ul> },
    ]}
  />
</Segment>
```

`level={3}` inside a RecordModal (its title is the h2), 2 on pages. `flush` lets the table meet the segment border. Falsy rows are skipped. Missing data says so ("Not recorded", "Not assigned"), never blank or 0.

## SearchPanel

```tsx
<SearchPanel
  action={BASE}
  hidden={{ tab: params.tab ?? 'current' }}
  search={{ name: 'q', label: 'Name or reference', value: params.q }}
  filters={[
    { name: 'programme', label: 'Programme', type: 'select', options: programmes, value: params.programme },
    { name: 'counsellor', label: 'Counsellor', type: 'select', options: staff, value: params.counsellor },
    { name: 'from', label: 'Class from', type: 'date', value: params.from },
  ]}
/>
```

GET form, works without JavaScript; submitting drops `page`. While "Filters" is closed, active filters show as chips whose × link removes just that filter.

## Charts and StatCard

All take `label` (what is plotted: the accessible name), `data: { label, value: number | null, href? }[]`, optional `format` (default en-IN number) and `emptyText`. `null` means not recorded: it is never drawn as 0, and a chart with nothing known shows "Not enough data" plus `emptyText`. Counts must come from the same server query as the list.

| Chart | Form | Notes |
|---|---|---|
| `BarChart` | `orientation="horizontal"` (default) for categories; `"vertical"` for days/months | horizontal rows can link (`href`) to the filtered list; vertical has "Show as table" |
| `DonutChart` | share of a whole, `totalLabel` in the centre | max 6 segments (rest fold into "Other"); colours follow input order, keep it stable |
| `LineChart` | trend over days/weeks, one series | gaps where values are missing; needs 2+ known values |
| `Sparkline` | tiny trend, `values: (number \| null)[]` | decorative unless given `label` |
| `FunnelChart` | ordered stages | bar width vs first stage, "x% of previous", overall line |
| `StatCard` | KPI tile (`.el-stat`) | `value: null` shows "Not recorded"; `href` + `current` make it the filter link (`.el-kpi`, selected = orange underline); `trend` adds a sparkline — only pass one where the service returns a real per-day series |

```tsx
<ul className="el-grid ops-kpis">
  <li><StatCard label="Current demos" value={kpis.current} note="First class on or before today" href={listHref(BASE, params, { view: 'current' })} current={view === 'current'} /></li>
  <li><StatCard label="Leads received" value={leads} note="First received in the period" trend={series?.leadsPerDay.map((d) => d.count)} /></li>
</ul>
<div className="ops-panels">
  <Segment title="Demo outcomes this month">
    <DonutChart label="Demo outcomes this month" data={outcomes} totalLabel="Demos" />
  </Segment>
</div>
```

Tiles inside a `Segment` sit in wells (a card never holds raised cards). One series uses `--el-chart-bar`; categories use `--el-chart-1..6` in fixed order (validated on white). Status colours stay for status badges only. The Overview (`src/app/page.tsx`, `_components/overview-blocks.tsx`) is the pattern: headline tiles → chart panels in `.ops-panels` → "Your work today".
