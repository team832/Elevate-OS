# @elevate/shared-ui

React 19 components for all four Elevate OS apps plus one plain-CSS stylesheet of design tokens (no Tailwind, no component library). Most components are server components; the few interactive ones (`ShellFrame`, `Tabs`, `Dialog`, `ChartFigure`) are small `'use client'` files.

```tsx
// app/layout.tsx (once per app)
import '@elevate/shared-ui/styles.css';
```

## Look (tokens in `src/css/base.css`; `src/styles.css` imports base, shell, components, charts, login)
Redesigned 22 Oct 2026 on the owner's brief ("completely different, curves not edges, 3D with just enough blur, complete dashboards; keep only the Elevate branding"), superseding the dark theme of D-054/D-059. Light, warm, tangible: a linen canvas `--el-bg #f4f1eb` lit from the top-left; white surfaces `--el-surface` float on it with a 1 px top highlight and a warm shadow (`--el-shadow`, `--el-shadow-raised`, `--el-shadow-overlay`; never a coloured glow); wells `--el-well #f8f6f1` for tables and inputs; raised rows `--el-surface-muted #efebe4`. Blur only on floating layers through the class `el-glass` (top bar, popovers, sheets) and on dialog backdrops. Text `#1b1714` / muted `#625a51`. Orange `#ff8623` is a fill for action and position only (primary button, current page, current journey stage); orange text uses `--el-accent-text #a84a08`. Contrast decisions (computed, WCAG 2.2 AA) are at the top of `css/base.css`.

Shape family: pills (`--el-radius-pill`) for buttons, badges, chips, tabs and segmented controls; `--el-radius-sm` 12 px for inputs, wells and table wrappers; `--el-radius` 18 px for cards and tiles; `--el-radius-lg` 24 px for the sidebar rail, dialogs and sheets. No square corners.

Type: Bricolage Grotesque (OFL 1.1, latin subset vendored in `fonts/`, loaded by `@font-face` in base.css) for page and panel titles, figures and the workspace name; the platform's native UI face (Segoe UI Variable Text, SF Pro, Roboto) for body, tables and forms. Styles are mobile first (`min-width` queries at 641, 720 and 1024 px).

The brand chevron (the "a" of the wordmark) is the signature element: the current-page marker in the rail, the loader (two chevrons rising), the glyph in empty and error states, and the marker on the current journey stage.

## Components
| Component | Notes |
|---|---|
| `AppShell` | A floating white rail: logo, the **workspace switcher** (the current workspace's name; a popover with the other workspaces the person belongs to and "Choose default workspace", from `modules`/`moduleHrefs`), optional "My work", the current module's `nav` in foldable groups (`NavItem.group`, all open by default), Settings and the profile. A frosted top bar: breadcrumbs, search pill, unread-notification pill, account popover with sign-out. Props unchanged (`breadcrumbs`, `search`, `myWorkHref`, `settings`, `unreadNotifications`; omitted props hide their control — no dead buttons). |
| `ShellFrame` (client) | Small-screen rail behind a menu button: `aria-expanded`/`aria-controls`, focus moves into the rail, the page behind is `inert`, Escape/backdrop/close button close it and focus returns to the menu button. |
| `WORKSPACE_PURPOSE`, `MODULE_NAV` | One line per workspace, shared by the switcher and the chooser. |
| `BrandLogo`, `COMPANY_NAME`, `INSTITUTE`, `instituteTelHref` | The "elevate" wordmark as inline SVG (`size` sm/md/lg; `decorative` when visible text names the company) and the institute's public facts (D-034/D-037/D-048/D-049). |
| `Breadcrumbs`, `defaultBreadcrumbs`, `navSections`, `initialsOf` | Shell helpers (exported for tests). |
| `Icon` | Inline-SVG line icons: 24-unit grid, 1.5 px stroke, `currentColor`; decorative unless `label` is given. |
| `PageHeader` (+ `meta`, `tabs`), `Subnav` | The masthead: display title, small labels, one line of context, actions, and area tabs as a pill segmented control (`aria-current="page"`). |
| `Card` (+ `actions`, `meta`, `id`, `footer`) | A rounded panel. |
| `StatTile`, `MetricStrip` | Figures as tiles. **Missing is "Missing" / "Not available" + reason, never 0**; estimated shows "≈" and the basis. |
| `JourneyRail` | The admission journey as rounded stages joined by a line: counts (dashboards) or `state` per stage (one record); `null` = Not recorded. |
| `DataTable` (+ `compact`) | `columns`, `rows`, `rowKey`, `caption`, `empty`; a rounded well; `compact` rows become labelled blocks on phones. |
| `Tabs` (client) | Server-driven tabs (links that set a search parameter) as a pill segmented control with the WAI-ARIA keyboard model (`nextTabIndex`). |
| `Dialog` (client), `useDialogClose` | Native `<dialog>` + `showModal()`: a frosted centred panel from 641 px, a curved bottom sheet with a grab handle below; labelled by its title, Escape closes, focus returns to the trigger. |
| `BarChart`, `DonutChart`, `LineChart`, `Sparkline`, `FunnelChart`, `StatCard`, `ChartFigure` | Server-rendered charts (`components/charts.tsx`, maths in `chart-math.ts`, exported as `@elevate/shared-ui/chart-math`): `label`, `data: { label, value: number \| null, href? }[]`, `format`, `emptyText`. `null` is never drawn as 0; nothing known shows "Not enough data". Marks carry `data-tip`; `ChartFigure` (client) shows the tooltip. Single series use `--el-chart-bar`; donut slots use `--el-chart-1…6` in input order (validated with the dataviz palette checker on white). `StatCard` is a KPI tile; with `href` it is a filter link (`.el-kpi`, `current` = selected). |
| `StatusBadge`, `FeatureStatusBadge`, `SourceBadge`, `Button`, `ButtonLink`, `Field`, `TextInput`, `Select`, `TextArea`, `Checkbox`, `Alert`, `EmptyState`, `ErrorState`, `LoadingState`, `LoginForm`, `WorkspaceChooser` | As before; pills, rounded fields, states with the chevron. `LoginForm`: brand panel + a floating sign-in card; Google first when `googleHref` is passed; same form contract and error codes. |

## Logo and favicon
The logo is code (`BrandLogo`), so there is no image file to install. The tab icon is `apps/*/src/app/icon.svg` (the two chevrons); `apps/platform/public/favicon.ico` is the same mark at 48 px. To change the mark, edit the paths in `brand.tsx` and `icon.svg` together.

Tests: `tests/shared-ui.test.tsx` and `tests/components.test.tsx` (server rendering with `react-dom/server`; the keyboard model is tested through `nextTabIndex`). The previous (dark) UI is tagged `ui-v1-dark-2026-10-22` and copied to `C:\OPENBOT\UI-Backup\2026-10-22-dark-ui`.
