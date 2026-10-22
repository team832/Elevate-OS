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
