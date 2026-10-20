'use client';

/**
 * Server-driven tabs: each tab is a link that sets a URL search parameter, the
 * page renders the selected panel on the server, and this component adds the
 * WAI-ARIA tab keyboard model (roving tabindex; arrows/Home/End move focus;
 * Enter or Space opens the focused tab). Without JavaScript the tabs are plain links.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { nextTabIndex } from './tab-keys';

export interface TabItem {
  key: string;
  label: string;
  /** Link that selects this tab (usually the current URL with a search parameter). */
  href: string;
  /** Optional count shown after the label; null shows nothing (unknown is not zero). */
  count?: number | null;
}

export function Tabs({
  idBase,
  label,
  items,
  selected,
  children,
}: {
  /** Prefix for element ids (unique on the page). */
  idBase: string;
  /** Accessible name of the tab list. */
  label: string;
  items: readonly TabItem[];
  selected: string;
  /** The selected tab's panel. */
  children: ReactNode;
}) {
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.currentTarget.click();
      return;
    }
    const next = nextTabIndex(e.key, index, items.length);
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };
  return (
    <div className="el-tabs">
      <div className="el-tablist" role="tablist" aria-label={label}>
        {items.map((t, i) => {
          const isSelected = t.key === selected;
          return (
            <a
              key={t.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`${idBase}-tab-${t.key}`}
              role="tab"
              href={t.href}
              aria-selected={isSelected}
              aria-controls={isSelected ? `${idBase}-panel` : undefined}
              tabIndex={isSelected ? 0 : -1}
              className="el-tab"
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
              {typeof t.count === 'number' ? <span className="el-tab-count">{t.count}</span> : null}
            </a>
          );
        })}
      </div>
      <div
        id={`${idBase}-panel`}
        role="tabpanel"
        aria-labelledby={`${idBase}-tab-${selected}`}
        className="el-tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
