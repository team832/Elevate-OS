# @elevate/shared-ui

React 19 components for all four Elevate OS apps plus one plain-CSS stylesheet of design tokens (no Tailwind, no component library). Most components are server components; the few interactive ones (`ShellFrame`, `Tabs`, `Dialog`) are small `'use client'` files.

```tsx
// app/layout.tsx (once per app)
import '@elevate/shared-ui/styles.css';
```

## Look (tokens in `src/css/base.css`; `src/styles.css` imports base, shell, components, login)
Dark theme, owner-approved (black + Elevate orange); layout redesigned 21 Oct 2026. A black frame (sidebar, top bar and each page's masthead) around a warm-dark work tray: canvas `--el-bg #0d0b09`, well `--el-well #0a0907`, card `--el-surface #16130f`, overlay `--el-overlay #1a1712`, raised `--el-surface-muted #1f1b16`, hairlines `--el-border #2b2621`. Text `#f5f1ea` / muted `#b3a99b`. Orange `#ff8623` / `#ffa43d` only for primary buttons, the current nav item, tab and KPI filter, and the current journey stage; links are text colour with an underline. Radii 10 / 6 / 4 px (cards / controls / badges). Contrast decisions (computed, WCAG AA) are at the top of `css/base.css`. Type is the platform's native UI face (Segoe UI Variable Text, Display for titles and figures). Styles are mobile first (`min-width` queries at 720 px and 1024 px).

## Components
| Component | Notes |
|---|---|
| `AppShell` | Sidebar (logo + "Elevate Education", Overview, optional platform `nav`, My work, the modules the user can open — the current module expanded with its `nav` grouped by `NavItem.group`, other modules as entry links — Settings, profile with sign-out) and top bar (breadcrumbs, search, unread-notification count, account menu). Props are backward compatible; new optional props: `breadcrumbs`, `search` ({action,label}), `myWorkHref`, `settings` ({href,active}), `unreadNotifications` (null hides it). Omitted props hide their control — no dead buttons. |
| `ShellFrame` (client) | Small-screen sidebar behind a menu button: `aria-expanded`/`aria-controls`, focus moves into the sidebar, the page behind is `inert`, Escape/backdrop/close button close it and focus returns to the menu button. |
| `BrandLogo`, `COMPANY_NAME`, `INSTITUTE` | The "elevate" wordmark as inline SVG (`src/components/brand.tsx`, 21 Oct 2026): letters in `currentColor` with round ends, the "a" as two orange chevrons (#ff8623 / #ffa43d) with softened corners, transparent ground. `size` sm (sidebar) / md / lg (sign-in); `decorative` hides it from screen readers when text beside it names the company, otherwise it is `role="img"` named "Elevate Education". `INSTITUTE` holds the public facts (site, privacy policy, phone, programmes per D-034/D-037) used by the sign-in page and the platform front page. |
| `Breadcrumbs`, `defaultBreadcrumbs`, `navSections`, `initialsOf` | Shell helpers (exported for tests). |
| `Icon` | Inline-SVG line icons: 24-unit grid, 1.5 px stroke, `currentColor`; decorative unless `label` is given. |
| `MetricStrip` | Headline figures in one band with fine dividers. **Missing is "Not available" + reason, never 0.** |
| `Tabs` (client) | Server-driven tabs (links that set a search parameter) with the WAI-ARIA keyboard model (`nextTabIndex`). |
| `Dialog` (client), `useDialogClose` | Native `<dialog>` + `showModal()`: labelled by its title, Escape closes, focus returns to the trigger. |
| `SourceBadge` | "Sample data" label for fictional data; renders nothing for live data. |
| `PageHeader` (+ `meta`, `tabs`), `Card` (+ `actions`, `meta`, `id`) | The page masthead (title, one-line description, actions, area tabs) and section cards. |
| `JourneyRail` | The admission journey as chevron stages: counts (dashboards) or `state` per stage (one record); `null` = Not recorded. |
| `DataTable` (+ `compact`) | `columns`, `rows`, `rowKey`, `caption`, `empty`. `compact` rows become labelled blocks on phones. |
| `StatusBadge`, `FeatureStatusBadge`, `Button`, `ButtonLink`, `Field`, `TextInput`, `Select`, `TextArea`, `Checkbox`, `Alert`, `EmptyState`, `ErrorState`, `LoadingState`, `StatTile`, `LoginForm` | As before. `LoginForm` (21 Oct 2026): two parts on desktop (Elevate Education panel: logo, what Elevate OS is, programmes, the institute's number; and the "Staff sign in" card), one column on phones. Card: account domain, Google button first when `googleHref` is passed, an "or" divider, labelled email/password with autocomplete, one "Sign in" button, the error alert above the form (and on both fields for `missing`), a help line. Same form contract and error codes as before; `subtitle` shows under the heading. |

## Logo and favicon
The logo is code (`BrandLogo`), so there is no image file to install. The tab icon is `apps/*/src/app/icon.svg` (the two chevrons; Next.js links it automatically); `apps/platform/public/favicon.ico` is the same mark rendered at 48 px for browsers that ask for `/favicon.ico`. To change the mark, edit the paths in `brand.tsx` and `icon.svg` together.

Tests: `tests/shared-ui.test.tsx` (server rendering with `react-dom/server`; the keyboard model is tested through `nextTabIndex`).
