'use client';

/**
 * Makes whole table rows open their record. Each clickable row's link cell holds
 * the real `<a data-row-link>` (keyboard and screen readers use that); a click
 * anywhere else on the row is forwarded to it. Clicks on links, buttons and form
 * controls inside the row keep their own behaviour, and text selection is left alone.
 */
import { useEffect, useRef, type ReactNode } from 'react';

const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, details, [role="button"], [role="group"]';

/** The link a row click should follow, or null when the click belongs to something else. */
export function rowLinkFor(target: Element): HTMLAnchorElement | null {
  const row = target.closest('tr');
  const hit = target.closest(INTERACTIVE);
  if (hit && row?.contains(hit)) return null; // only controls inside this row, not ancestors
  return row?.querySelector<HTMLAnchorElement>('a[data-row-link]') ?? null;
}

export function RowLinks({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || !(e.target instanceof Element)) return;
      if (window.getSelection()?.toString()) return;
      const { ctrlKey, metaKey, shiftKey, altKey } = e;
      rowLinkFor(e.target)?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey,
          metaKey,
          shiftKey,
          altKey,
        }),
      );
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
