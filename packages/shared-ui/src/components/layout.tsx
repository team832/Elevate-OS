import type { ReactNode } from 'react';
import { MODULES, type ModuleKey } from '@elevate/shared-types';

/** The lowercase "elevate" wordmark (rendered as text — the brand rule is "never the chevron alone"). */
export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <a className="el-wordmark" href={href} aria-label="elevate — home">
      elevate
    </a>
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
  /** Optional section name. When any item has one, the nav shows sections, then the active section's pages. */
  group?: string;
}

/**
 * First row: ungrouped items plus one link per group (to its first item); second row: the
 * active group's items. Without groups this is the flat row it always was.
 */
function navRows(nav: readonly NavItem[]) {
  const activeGroup = nav.find((n) => n.active)?.group;
  const top: { href: string; label: string; current?: 'page' | 'true' }[] = [];
  const seen = new Set<string>();
  for (const n of nav) {
    if (!n.group)
      top.push({ href: n.href, label: n.label, current: n.active ? 'page' : undefined });
    else if (!seen.has(n.group)) {
      seen.add(n.group);
      top.push({
        href: n.href,
        label: n.group,
        current: n.group === activeGroup ? 'true' : undefined,
      });
    }
  }
  const sub = activeGroup ? nav.filter((n) => n.group === activeGroup) : [];
  return { top, sub, activeGroup };
}

export interface AppShellProps {
  user: ShellUser;
  /** Modules the user can open (from `modulesFor(user)`); only these appear in the switcher. */
  modules: readonly ModuleKey[];
  /** The module this page belongs to. */
  current: ModuleKey;
  /** Form action that signs out, including the basePath, e.g. `/marketing/api/v1/auth/logout`. */
  logoutAction: string;
  /** Optional second-level navigation for the current module. */
  nav?: readonly NavItem[];
  children: ReactNode;
}

const moduleHref = (m: ModuleKey) => MODULES[m].basePath || '/';

/**
 * Page frame: top bar (wordmark, module switcher, user menu with sign-out),
 * optional module navigation, and the main region. Uses plain links and a
 * <details> menu, so it works in server components without client JS.
 * Module links are plain <a> because each module is a separate zone.
 */
export function AppShell({ user, modules, current, logoutAction, nav, children }: AppShellProps) {
  return (
    <div className="el-shell">
      <a className="el-skip-link" href="#main">
        Skip to content
      </a>
      <header className="el-topbar">
        <Wordmark />
        <nav aria-label="Modules">
          <ul className="el-module-switcher">
            {modules.map((m) => (
              <li key={m}>
                <a href={moduleHref(m)} aria-current={m === current ? 'page' : undefined}>
                  {MODULES[m].label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <details className="el-user-menu">
          <summary>
            <span className="el-visually-hidden">Account menu for </span>
            {user.displayName}
          </summary>
          <div className="el-user-menu-panel">
            <p>
              <strong>{user.displayName}</strong>
            </p>
            <p className="el-field-hint">{user.email}</p>
            <p className="el-field-hint">
              Roles: {user.roles.length ? user.roles.join(', ') : 'none'}
            </p>
            <form method="post" action={logoutAction}>
              <button className="el-button el-button-secondary el-button-block" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </details>
      </header>
      {nav && nav.length > 0 ? <ModuleNav nav={nav} label={MODULES[current].label} /> : null}
      <main id="main" className="el-main">
        {children}
      </main>
    </div>
  );
}

function ModuleNav({ nav, label }: { nav: readonly NavItem[]; label: string }) {
  const { top, sub, activeGroup } = navRows(nav);
  return (
    <>
      <nav className="el-subnav" aria-label={`${label} sections`}>
        {top.map((item) => (
          <a key={item.href + item.label} href={item.href} aria-current={item.current}>
            {item.label}
          </a>
        ))}
      </nav>
      {sub.length > 0 ? (
        <nav className="el-subnav el-subnav-pages" aria-label={`${activeGroup} pages`}>
          {sub.map((item) => (
            <a key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}
    </>
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
  children,
}: {
  title?: string;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="el-card">
      {title ? (
        <div className="el-card-header">
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}
      {children ? <div className="el-card-body">{children}</div> : null}
      {footer ? <div className="el-card-footer">{footer}</div> : null}
    </section>
  );
}
