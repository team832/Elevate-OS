# @elevate/shared-ui

React 19 components that work as **server components** (no hooks, no client JS) plus one plain-CSS stylesheet of design tokens (no Tailwind). Light and dark themes follow the OS.

```tsx
// app/layout.tsx (once per app)
import '@elevate/shared-ui/styles.css';
```

| Component | Notes |
|---|---|
| `AppShell` | Top bar with the lowercase **elevate** wordmark (text), module switcher showing only `modules` you pass (use `modulesFor(user)`), user menu with a sign-out form posting to `logoutAction`; optional `nav` sub-navigation; `<main id="main">` with skip link. Module links are plain `<a>` (zones are separate apps). |
| `Wordmark` | The lowercase "elevate" wordmark. |
| `PageHeader` | `title`, `description`, `actions`. |
| `Card` | `title`, `description`, `footer`, children. |
| `DataTable` | `columns` (`key`, `header`, `render?`, `numeric?`), `rows`, `rowKey`, `caption`, `empty`. Renders `empty` (default EmptyState) when there are no rows. |
| `StatusBadge`, `FeatureStatusBadge` | Tones: neutral, info, success, warning, danger. FeatureStatusBadge maps D-013 statuses. |
| `Button`, `ButtonLink` | Variants: primary, secondary, danger, ghost; `block`. |
| `Field`, `TextInput`, `Select`, `TextArea`, `Checkbox`, `fieldDescribedBy()` | Accessible form primitives (label, hint, error, `aria-invalid`). |
| `Alert` | Tones info/success/warning/danger. |
| `EmptyState`, `ErrorState` (shows request reference), `LoadingState` | Every screen needs loading/empty/error/success states (BUILD_PLAN definition of done). Use `LoadingState` in `loading.tsx`. |
| `StatTile` | Renders a `Metric`. **Missing ≠ zero**: `missing` shows "Missing" + reason in a dashed tile, `estimated` shows "≈ value" + badge + basis, `ok` shows the number (0 is "0"). |
| `LoginForm` | Plain HTML form posting to the login route (`action`, `next`, `error` code). |

Client interactivity: write your own `'use client'` components in your module's `src/ui/` and keep using these classes (`el-*`).

Tests: `tests/shared-ui.test.tsx` (server rendering with `react-dom/server`).
