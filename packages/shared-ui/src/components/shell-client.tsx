'use client';

/**
 * Client half of the AppShell: the only state is "is the small-screen sidebar open".
 * - The menu button carries aria-expanded / aria-controls.
 * - Opening moves focus into the sidebar and makes the rest of the page inert
 *   (so Tab stays inside the menu); Escape, the close button or the backdrop
 *   close it and return focus to the menu button.
 * - On wide screens the sidebar is always visible and the button is hidden.
 * Everything inside the sidebar and the page is server-rendered and passed in.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

/** Width (px) from which the sidebar is permanently visible. Keep in sync with css/shell.css. */
export const SIDEBAR_BREAKPOINT = 1024;

interface NavigateEventLike {
  destination: { url: string; sameDocument: boolean };
  downloadRequest: string | null;
  formData: unknown;
}

/** True when a navigation replaces this page: not a download, a mail or phone link, or a jump within it. */
export function loadsNewPage({ destination, downloadRequest, formData }: NavigateEventLike) {
  const { protocol, pathname } = new URL(destination.url);
  // GET links into /api/ are PDFs and exports: the page stays. Sign-in and sign-out POST there and leave.
  const download = downloadRequest !== null || (pathname.includes('/api/') && !formData);
  return !destination.sameDocument && !download && /^https?:$/.test(protocol);
}

/**
 * Feedback from a click until the next page paints: a thin bar along the top. Links are plain <a>
 * (each click is a full page load) and D-022 rules out loading.tsx, so this listens to the
 * browser's Navigation API; a browser without it just shows nothing extra.
 */
export function NavPending() {
  useEffect(() => {
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout>;
    const hide = () => {
      clearTimeout(timer);
      root.removeAttribute('data-nav-pending');
    };
    const onNavigate = (e: Event) => {
      if (!loadsNewPage(e as Event & NavigateEventLike)) return;
      root.setAttribute('data-nav-pending', '');
      clearTimeout(timer);
      timer = setTimeout(hide, 15000); // a load the person stopped must not leave the bar up
    };
    nav?.addEventListener('navigate', onNavigate);
    window.addEventListener('pageshow', hide); // Back from the browser's page cache
    return () => {
      hide();
      nav?.removeEventListener('navigate', onNavigate);
      window.removeEventListener('pageshow', hide);
    };
  }, []);
  return null;
}

/** A wrong password reloads the page empty: keep the email for this tab (never in the URL). */
export function KeepLoginEmail() {
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('.el-login input[name="email"]');
    if (!input) return;
    const remember = () => {
      try {
        sessionStorage.setItem('el-login-email', input.value);
      } catch {
        // storage blocked: the field is just empty next time
      }
    };
    try {
      if (location.search.includes('error=')) input.value = sessionStorage.getItem('el-login-email') ?? '';
    } catch {
      // as above
    }
    input.form?.addEventListener('submit', remember);
    return () => input.form?.removeEventListener('submit', remember);
  }, []);
  return null;
}

export function ShellFrame({
  sidebarId,
  sidebar,
  topbar,
  children,
  defaultOpen = false,
}: {
  sidebarId: string;
  /** Start with the small-screen sidebar open (tests and previews). */
  defaultOpen?: boolean;
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) closeButton.current?.focus();
    else if (wasOpen.current) menuButton.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    const wide = window.matchMedia(`(min-width: ${SIDEBAR_BREAKPOINT}px)`);
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  return (
    <div className="el-shell" data-sidebar-open={open ? 'true' : undefined}>
      <NavPending />
      <a className="el-skip-link" href="#main">
        Skip to content
      </a>
      <aside id={sidebarId} className="el-sidebar" aria-label="Main navigation">
        <button
          ref={closeButton}
          type="button"
          className="el-icon-button el-sidebar-close"
          onClick={close}
        >
          <Icon name="close" />
          <span className="el-visually-hidden">Close menu</span>
        </button>
        {sidebar}
      </aside>
      {open ? <div className="el-sidebar-backdrop" aria-hidden="true" onClick={close} /> : null}
      <div className="el-shell-body" inert={open || undefined}>
        <header className="el-topbar el-glass">
          <button
            ref={menuButton}
            type="button"
            className="el-icon-button el-menu-button"
            aria-expanded={open}
            aria-controls={sidebarId}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="menu" />
            <span className="el-visually-hidden">Menu</span>
          </button>
          {topbar}
        </header>
        <main id="main" className="el-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
