import type { ReactNode } from 'react';
import { MODULES, type ModuleKey } from '@elevate/shared-types';
import { BRAND_LOGO_SIZE } from '../brand-asset';
import { Icon, type IconName } from './icons';
import { ShellFrame } from './shell-client';

/** Company name shown next to the logo. */
export const COMPANY_NAME = 'Elevate Education';

/** The lowercase "elevate" wordmark as text (kept for places without the image). */
export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <a className="el-wordmark" href={href} aria-label="elevate — home">
      elevate
    </a>
  );
}

/**
 * Browser path of the brand logo for an app. Every app serves the same file from
 * `public/brand/elevate-logo.png` under its basePath (swap it with
 * `node packages/shared-ui/scripts/brand-logo.mjs <new-file.png>`).
 */
export function brandLogoSrc(basePath = ''): string {
  return `${basePath}/brand/elevate-logo.png`;
}

/** The logo image (white + orange on black). Height is set in CSS; width follows the file. */
export function BrandLogo({ basePath = '', className }: { basePath?: string; className?: string }) {
  return (
    // A plain <img>: the file is a static asset of each zone and must not be resized or re-encoded.
    <img
      className={['el-brand-logo', className].filter(Boolean).join(' ')}
      src={brandLogoSrc(basePath)}
      width={BRAND_LOGO_SIZE.width}
      height={BRAND_LOGO_SIZE.height}
      alt="elevate"
      decoding="async"
    />
  );
}

export interface ShellUser {
  displayName: string;
  email: string;
  roles: readonly string[];
}

export interface NavItem {
  href: string;
  label: string;
  active?: boolean;
  /** Optional section name. Items with the same group are listed under it in the sidebar. */
  group?: string;
}

export interface Crumb {
  label: string;
  href?: string;
}

export interface ShellSearch {
  /** Form action (GET), a browser path such as `/ops/leads`. */
  action: string;
  /** What is searched, used as label and placeholder, e.g. "Search leads". */
  label: string;
  /** Query parameter name (default `q`). */
  name?: string;
  defaultValue?: string;
}

export interface AppShellProps {
  user: ShellUser;
  /** Modules the user can open (from `modulesFor(user)`); only these appear in the sidebar. */
  modules: readonly ModuleKey[];
  /** The module this page belongs to. */
  current: ModuleKey;
  /** Form action that signs out, including the basePath, e.g. `/marketing/api/v1/auth/logout`. */
  logoutAction: string;
  /** Sections of the current module (only those the user may open). */
  nav?: readonly NavItem[];
  /** Breadcrumb trail; default: module › section › page from `nav`. */
  breadcrumbs?: readonly Crumb[];
  /** Top-bar search. Omit when the module has nothing to search: no dead control. */
  search?: ShellSearch;
  /** Link to the user's own work list. Omit to hide "My work". */
  myWorkHref?: string;
  /** Settings link (bottom of the sidebar). Omit to hide it. */
  settings?: { href: string; active?: boolean };
  /** Unread in-app notifications; `null`/omitted hides the indicator (unknown is not zero). */
  unreadNotifications?: number | null;
  children: ReactNode;
}

/** Sidebar names and icons of the modules (order = sidebar order). */
export const MODULE_NAV: readonly {
  key: Exclude<ModuleKey, 'platform'>;
  label: string;
  icon: IconName;
}[] = [
  { key: 'ops', label: 'Business Operations', icon: 'ops' },
  { key: 'academic', label: 'Academic OS', icon: 'academic' },
  { key: 'marketing', label: 'Marketing OS', icon: 'marketing' },
];

const moduleHref = (m: ModuleKey) => MODULES[m].basePath || '/';
const moduleLabel = (m: ModuleKey) =>
  m === 'platform' ? 'Overview' : (MODULE_NAV.find((x) => x.key === m)?.label ?? MODULES[m].label);

/** "Tara Teacher (fictional)" → "TT". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return (
    letters
      .map((w) => w?.[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}

const roleLabel = (roles: readonly string[]) =>
  roles.length ? roles.map((r) => r.replace(/_/g, ' ')).join(', ') : 'No roles';

export type NavSection =
  | { kind: 'link'; item: NavItem }
  | { kind: 'group'; name: string; items: NavItem[]; active: boolean };

/**
 * Sidebar structure of a module nav: ungrouped items are links; grouped items are
 * collected under their group (in order of first appearance). A group with a single
 * item named like the group is shown as a plain link.
 */
export function navSections(nav: readonly NavItem[]): NavSection[] {
  const out: NavSection[] = [];
  const groups = new Map<string, Extract<NavSection, { kind: 'group' }>>();
  for (const item of nav) {
    if (!item.group) {
      out.push({ kind: 'link', item });
      continue;
    }
    let g = groups.get(item.group);
    if (!g) {
      g = { kind: 'group', name: item.group, items: [], active: false };
      groups.set(item.group, g);
      out.push(g);
    }
    g.items.push(item);
    if (item.active) g.active = true;
  }
  return out.map((s) =>
    s.kind === 'group' && s.items.length === 1 && s.items[0]?.label === s.name
      ? { kind: 'link', item: s.items[0] }
      : s,
  );
}

/** Default breadcrumb: module › group › active page. */
export function defaultBreadcrumbs(current: ModuleKey, nav: readonly NavItem[] = []): Crumb[] {
  const crumbs: Crumb[] = [{ label: moduleLabel(current), href: moduleHref(current) }];
  const active = nav.find((n) => n.active);
  if (active && active.href !== moduleHref(current)) {
    if (active.group && active.group !== active.label) crumbs.push({ label: active.group });
    crumbs.push({ label: active.label, href: active.href });
  }
  return crumbs;
}

export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav className="el-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`}>
              {last ? (
                <span aria-current="page">{c.label}</span>
              ) : c.href ? (
                <a href={c.href}>{c.label}</a>
              ) : (
                <span>{c.label}</span>
              )}
              {last ? null : <Icon name="chevron-right" size={14} className="el-crumb-sep" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SidebarLink({
  href,
  label,
  icon,
  current,
}: {
  href: string;
  label: string;
  icon?: IconName;
  current?: boolean;
}) {
  return (
    <a className="el-nav-link" href={href} aria-current={current ? 'page' : undefined}>
      {icon ? <Icon name={icon} /> : <span className="el-nav-mark" aria-hidden="true" />}
      <span>{label}</span>
    </a>
  );
}

function ModuleSections({ nav }: { nav: readonly NavItem[] }) {
  return (
    <ul className="el-nav-list el-nav-sub">
      {navSections(nav).map((s) =>
        s.kind === 'link' ? (
          <li key={s.item.href + s.item.label}>
            <SidebarLink href={s.item.href} label={s.item.label} current={s.item.active} />
          </li>
        ) : (
          <li key={`group-${s.name}`}>
            <details className="el-nav-group" open={s.active || undefined}>
              <summary>
                <span>{s.name}</span>
                <Icon name="chevron-down" size={16} className="el-nav-caret" />
              </summary>
              <ul className="el-nav-list">
                {s.items.map((item) => (
                  <li key={item.href + item.label}>
                    <SidebarLink href={item.href} label={item.label} current={item.active} />
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

function Sidebar(props: AppShellProps) {
  const { user, modules, current, logoutAction, nav = [], myWorkHref, settings } = props;
  const basePath = MODULES[current].basePath;
  const overviewCurrent = current === 'platform' && !nav.some((n) => n.active);
  return (
    <div className="el-sidebar-inner">
      <a className="el-sidebar-brand" href="/">
        <BrandLogo basePath={basePath} />
        <span className="el-sidebar-company">{COMPANY_NAME}</span>
      </a>
      <nav className="el-sidebar-nav" aria-label="Modules and sections">
        <ul className="el-nav-list">
          <li>
            <SidebarLink href="/" label="Overview" icon="overview" current={overviewCurrent} />
          </li>
          {current === 'platform'
            ? nav.map((n) => (
                <li key={n.href}>
                  <SidebarLink href={n.href} label={n.label} icon="dashboard" current={n.active} />
                </li>
              ))
            : null}
          {myWorkHref ? (
            <li>
              <SidebarLink href={myWorkHref} label="My work" icon="my-work" />
            </li>
          ) : null}
        </ul>
        <ul className="el-nav-list el-nav-modules">
          {MODULE_NAV.filter((m) => modules.includes(m.key)).map((m) =>
            m.key === current ? (
              <li key={m.key}>
                <details className="el-nav-module" open>
                  <summary>
                    <Icon name={m.icon} />
                    <span>{m.label}</span>
                    <Icon name="chevron-down" size={16} className="el-nav-caret" />
                  </summary>
                  {nav.length > 0 ? (
                    <ModuleSections nav={nav} />
                  ) : (
                    <ul className="el-nav-list el-nav-sub">
                      <li>
                        <SidebarLink href={moduleHref(m.key)} label="Dashboard" />
                      </li>
                    </ul>
                  )}
                </details>
              </li>
            ) : (
              <li key={m.key}>
                <SidebarLink href={moduleHref(m.key)} label={m.label} icon={m.icon} />
              </li>
            ),
          )}
        </ul>
      </nav>
      <div className="el-sidebar-foot">
        {settings ? (
          <SidebarLink
            href={settings.href}
            label="Settings"
            icon="settings"
            current={settings.active}
          />
        ) : null}
        <div className="el-profile">
          <span className="el-avatar" aria-hidden="true">
            {initialsOf(user.displayName)}
          </span>
          <div className="el-profile-text">
            <p className="el-profile-name">{user.displayName}</p>
            <p className="el-profile-roles">{roleLabel(user.roles)}</p>
          </div>
        </div>
        <form method="post" action={logoutAction}>
          <button className="el-nav-link el-signout" type="submit">
            <Icon name="sign-out" />
            <span>Sign out</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function TopBar(props: AppShellProps) {
  const { user, current, nav, breadcrumbs, search, unreadNotifications, logoutAction } = props;
  const crumbs = breadcrumbs ?? defaultBreadcrumbs(current, nav);
  const searchId = `el-search-${current}`;
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <div className="el-topbar-tools">
        {search ? (
          <form className="el-search" role="search" method="get" action={search.action}>
            <label className="el-visually-hidden" htmlFor={searchId}>
              {search.label}
            </label>
            <Icon name="search" size={16} className="el-search-icon" />
            <input
              id={searchId}
              className="el-search-input"
              type="search"
              name={search.name ?? 'q'}
              placeholder={search.label}
              defaultValue={search.defaultValue}
              maxLength={100}
            />
          </form>
        ) : null}
        {typeof unreadNotifications === 'number' ? (
          <span
            className="el-notify"
            role="status"
            data-unread={unreadNotifications > 0 ? 'true' : undefined}
            title="Unread in-app notifications"
          >
            <Icon name="bell" />
            <span className="el-visually-hidden">
              {unreadNotifications === 1
                ? '1 unread notification'
                : `${unreadNotifications} unread notifications`}
            </span>
            {unreadNotifications > 0 ? (
              <span className="el-notify-count" aria-hidden="true">
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            ) : null}
          </span>
        ) : null}
        <details className="el-user-menu">
          <summary className="el-avatar-button">
            <span className="el-avatar" aria-hidden="true">
              {initialsOf(user.displayName)}
            </span>
            <span className="el-visually-hidden">Account menu for {user.displayName}</span>
          </summary>
          <div className="el-user-menu-panel">
            <p>
              <strong>{user.displayName}</strong>
            </p>
            <p className="el-field-hint">{user.email}</p>
            <p className="el-field-hint">Roles: {roleLabel(user.roles)}</p>
            <form method="post" action={logoutAction}>
              <button className="el-button el-button-secondary el-button-block" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </>
  );
}

/**
 * Page frame used by all four apps: a near-black sidebar (logo, Overview, My work,
 * the modules the user can open with the current module's sections, Settings and
 * the profile with sign-out) and a top bar (breadcrumbs, search, notifications,
 * account menu). Module links are plain <a> because each module is a separate zone.
 * On small screens the sidebar sits behind a menu button (see ShellFrame).
 */
export function AppShell(props: AppShellProps) {
  const sidebarId = `el-sidebar-${props.current}`;
  return (
    <ShellFrame
      sidebarId={sidebarId}
      sidebar={<Sidebar {...props} />}
      topbar={<TopBar {...props} />}
    >
      {props.children}
    </ShellFrame>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="el-page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="el-page-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  description,
  footer,
  actions,
  meta,
  id,
  children,
}: {
  title?: string;
  description?: ReactNode;
  footer?: ReactNode;
  /** Controls at the right of the header (links, filters). */
  actions?: ReactNode;
  /** Small label next to the title, e.g. <SourceBadge source="sample" />. */
  meta?: ReactNode;
  id?: string;
  children?: ReactNode;
}) {
  const headingId = id && title ? `${id}-title` : undefined;
  return (
    <section className="el-card" id={id} aria-labelledby={headingId}>
      {title ? (
        <div className="el-card-header">
          <div className="el-card-heading">
            <div className="el-card-titlerow">
              <h2 id={headingId}>{title}</h2>
              {meta ?? null}
            </div>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="el-card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children ? <div className="el-card-body">{children}</div> : null}
      {footer ? <div className="el-card-footer">{footer}</div> : null}
    </section>
  );
}
