# @elevate/shared-ui

React 19 components for all four Elevate OS apps plus one plain-CSS stylesheet of design tokens (no Tailwind, no component library). Most components are server components; the few interactive ones (`ShellFrame`, `Tabs`, `Dialog`) are small `'use client'` files.

```tsx
// app/layout.tsx (once per app)
import '@elevate/shared-ui/styles.css';
```

## Look (tokens in `src/styles.css`)
Near-black sidebar (`--el-ink #16140F`), warm off-white canvas (`--el-bg #F5F4F1`), white surfaces, thin warm-grey rules (`--el-border #E4E1DB`), radii 8 / 6 / 4 px by role (panels / controls / badges), no shadows except overlays. Brand orange `#ED862A` (`--el-accent`) only for primary actions, the selected state and attention counts. Contrast decisions (measured, WCAG AA) are written at the top of `styles.css`; the important one: **white on #ED862A is 2.61:1, so primary buttons use near-black text on orange (6.58:1)** and orange text on light surfaces uses `--el-accent-text #A84F0D` (5.54:1). Type is the platform's native UI face (Segoe UI Variable on Windows) with tabular numbers. Styles are mobile first (`min-width` queries at 720 px and 1024 px). Light theme only.

## Components
| Component | Notes |
|---|---|
| `AppShell` | Sidebar (logo + "Elevate Education", Overview, optional platform `nav`, My work, the modules the user can open — the current module expanded with its `nav` grouped by `NavItem.group`, other modules as entry links — Settings, profile with sign-out) and top bar (breadcrumbs, search, unread-notification count, account menu). Props are backward compatible; new optional props: `breadcrumbs`, `search` ({action,label}), `myWorkHref`, `settings` ({href,active}), `unreadNotifications` (null hides it). Omitted props hide their control — no dead buttons. |
| `ShellFrame` (client) | Small-screen sidebar behind a menu button: `aria-expanded`/`aria-controls`, focus moves into the sidebar, the page behind is `inert`, Escape/backdrop/close button close it and focus returns to the menu button. |
| `BrandLogo`, `brandLogoSrc(basePath)`, `Wordmark` | Logo image from each app's `public/brand/elevate-logo.png` with explicit width/height (`BRAND_LOGO_SIZE`). |
| `Breadcrumbs`, `defaultBreadcrumbs`, `navSections`, `initialsOf` | Shell helpers (exported for tests). |
| `Icon` | Inline-SVG line icons: 24-unit grid, 1.5 px stroke, `currentColor`; decorative unless `label` is given. |
| `MetricStrip` | Headline figures in one band with fine dividers. **Missing is "Not available" + reason, never 0.** |
| `Tabs` (client) | Server-driven tabs (links that set a search parameter) with the WAI-ARIA keyboard model (`nextTabIndex`). |
| `Dialog` (client), `useDialogClose` | Native `<dialog>` + `showModal()`: labelled by its title, Escape closes, focus returns to the trigger. |
| `SourceBadge` | "Sample data" label for fictional data; renders nothing for live data. |
| `PageHeader`, `Card` (+ `actions`, `meta`, `id`) | Page and panel headings. |
| `DataTable` (+ `compact`) | `columns`, `rows`, `rowKey`, `caption`, `empty`. `compact` rows become labelled blocks on phones. |
| `StatusBadge`, `FeatureStatusBadge`, `Button`, `ButtonLink`, `Field`, `TextInput`, `Select`, `TextArea`, `Checkbox`, `Alert`, `EmptyState`, `ErrorState`, `LoadingState`, `StatTile`, `LoginForm` | As before. `LoginForm` now shows the zone's logo (basePath taken from its `action`), says "Use your @elevateeducation.in account.", shows a "Sign in with Google" link-button only when `googleHref` is passed, and has messages for the `google_*` error codes. |

## Swapping the logo
Put the new PNG in the repo root and run
`node packages/shared-ui/scripts/brand-logo.mjs "<new file>.png"`.
It trims the black margin losslessly (pixel bytes copied, verified), writes `apps/*/public/brand/elevate-logo.png`, `apps/platform/public/favicon.ico` (the first letter) and `src/brand-asset.ts` (the size). `--no-trim` copies the file unchanged. No code changes are needed.

Tests: `tests/shared-ui.test.tsx` (server rendering with `react-dom/server`; the keyboard model is tested through `nextTabIndex`).
