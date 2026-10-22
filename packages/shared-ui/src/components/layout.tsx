import type { ReactNode } from 'react';
import { MODULES, type ModuleKey } from '@elevate/shared-types';
import { BrandLogo } from './brand';
import { Icon, type IconName } from './icons';
import { ShellFrame } from './shell-client';

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
  /** Modules the user can open (from `modulesFor(user)`); only these appear in the switcher. */
  modules: readonly ModuleKey[];
  /**
   * Absolute workspace URLs (`workspaceHrefs()` from @elevate/server-kit/next, D-072): each
   * workspace has its own origin. Default: the module's base path on this origin.
   */
  moduleHrefs?: Partial<Record<ModuleKey, string>>;
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

/** Sidebar names and icons of the modules (order = switcher order). */
export const MODULE_NAV: readonly {
  key: Exclude<ModuleKey, 'platform'>;
  label: string;
  icon: IconName;
}[] = [
  { key: 'ops', label: 'Business Operations', icon: 'ops' },
  { key: 'academic', label: 'Academic OS', icon: 'academic' },
  { key: 'marketing', label: 'Marketing OS', icon: 'marketing' },
];

/** What each workspace is for, in the words of the people who use it. */
export const WORKSPACE_PURPOSE: Record<Exclude<ModuleKey, 'platform'>, string> = {
  ops: 'Admissions, students, fees, teachers, tasks and reports.',
  academic: 'Your classes, batches, attendance, teaching logs and student reviews.',
  marketing: 'Leads, follow-ups, campaigns and the content calendar.',
};

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

/**
 * The workspace switcher at the top of the rail: the current workspace's name, and (when the
 * person belongs to more than one, or is on the platform overview) a popover with the others.
 */
function WorkspaceSwitcher({ modules, current, moduleHrefs }: AppShellProps) {
  const options = MODULE_NAV.filter((m) => modules.includes(m.key));
  const name = (
    <span className="el-ws-text">
      <span className="el-ws-label">Workspace</span>
      <span className="el-ws-name">{moduleLabel(current)}</span>
    </span>
  );
  if (options.length < 2 && current !== 'platform')
    return <div className="el-ws-static">{name}</div>;
  return (
    <details className="el-ws">
      <summary>
        {name}
        <Icon name="chevron-down" />
      </summary>
      <ul className="el-ws-panel el-glass" aria-label="Workspaces">
        {current === 'platform' ? (
          <li>
            <a className="el-ws-option" href="/" aria-current="true">
              <Icon name="overview" />
              <span>Overview</span>
            </a>
          </li>
        ) : null}
        {options.map((m) => (
          <li key={m.key}>
            <a
              className="el-ws-option"
              href={moduleHrefs?.[m.key] ?? moduleHref(m.key)}
              aria-current={m.key === current || undefined}
            >
              <Icon name={m.icon} />
              <span>
                {m.label}
                <span className="el-ws-purpose">{WORKSPACE_PURPOSE[m.key]}</span>
              </span>
            </a>
          </li>
        ))}
        {options.length > 1 ? (
          <li className="el-ws-footer">
            <a href={`${MODULES[current].basePath}/workspaces`}>Choose default workspace</a>
          </li>
        ) : null}
      </ul>
    </details>
  );
}

/** The current module's sections; each group can be folded and starts open. */
function ModuleSections({ nav, label }: { nav: readonly NavItem[]; label: string }) {
  return (
    <ul className="el-nav-list el-nav-sections" aria-label={label}>
      {navSections(nav).map((s, i) =>
        s.kind === 'link' ? (
          <li key={s.item.href + s.item.label}>
            <SidebarLink href={s.item.href} label={s.item.label} current={s.item.active} />
          </li>
        ) : (
          <li key={`group-${s.name}`}>
            <details className="el-nav-group" open>
              <summary id={`el-navgroup-${i}`} className="el-nav-heading">
                <span>{s.name}</span>
                <Icon name="chevron-down" size={14} />
              </summary>
              <ul className="el-nav-list" aria-labelledby={`el-navgroup-${i}`}>
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
  const { user, current, nav = [], myWorkHref, settings } = props;
  return (
    <div className="el-sidebar-inner">
      <a className="el-sidebar-brand" href="/">
        <BrandLogo size="sm" />
      </a>
      <WorkspaceSwitcher {...props} />
      <nav className="el-sidebar-nav" aria-label="Modules and sections">
        {myWorkHref ? (
          <ul className="el-nav-list" aria-label="My work">
            <li>
              <SidebarLink href={myWorkHref} label="My work" icon="my-work" />
            </li>
          </ul>
        ) : null}
        {nav.length > 0 ? (
          <ModuleSections nav={nav} label={`${moduleLabel(current)} sections`} />
        ) : null}
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
          <div className="el-user-menu-panel el-glass">
            <p>
              <strong>{user.displayName}</strong>
            </p>
            <p className="el-field-hint">{user.email}</p>
            <p className="el-field-hint">Roles: {roleLabel(user.roles)}</p>
            {props.modules.filter((m) => m !== 'platform').length > 1 ? (
              <p>
                <a href={`${MODULES[current].basePath}/workspaces`}>Choose default workspace</a>
              </p>
            ) : null}
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
 * Page frame used by all four apps: a floating white rail (logo, workspace switcher, the
 * current module's sections in foldable groups, Settings and the profile) and a frosted
 * top bar (breadcrumbs, search, notifications, account popover with sign-out). Workspace
 * links are plain <a> because each workspace is a separate zone. On small screens the rail
 * sits behind a menu button (see ShellFrame).
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
  meta,
  tabs,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small labels next to the title (status, reference, "Sample data"). */
  meta?: ReactNode;
  /** Area navigation shown under the header (e.g. <AdmissionsNav />). */
  tabs?: ReactNode;
}) {
  return (
    <div className="el-page-header">
      <div className="el-page-head">
        <div className="el-page-titles">
          <div className="el-page-titlerow">
            <h1>{title}</h1>
            {meta ?? null}
          </div>
          {description ? <p className="el-page-description">{description}</p> : null}
        </div>
        {actions ? <div className="el-page-actions">{actions}</div> : null}
      </div>
      {tabs ?? null}
    </div>
  );
}

/** Area tabs for a PageHeader (`tabs`): a pill segmented control; the current one is marked for screen readers. */
export function Subnav({
  label,
  items,
  current,
}: {
  label: string;
  items: readonly (readonly [href: string, text: string])[];
  /** Href of the current page. */
  current?: string;
}) {
  return (
    <nav className="el-subnav" aria-label={label}>
      {items.map(([href, text]) => (
        <a key={href} href={href} aria-current={href === current ? 'page' : undefined}>
          {text}
        </a>
      ))}
    </nav>
  );
}

export function Card({
  title,
  description,
  footer,
  actions,
  meta,
  id,
  className,
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
  /** Layout hook for the page grid (e.g. a panel that spans the row). */
  className?: string;
  children?: ReactNode;
}) {
  const headingId = id && title ? `${id}-title` : undefined;
  return (
    <section
      className={['el-card', className].filter(Boolean).join(' ')}
      id={id}
      aria-labelledby={headingId}
    >
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
