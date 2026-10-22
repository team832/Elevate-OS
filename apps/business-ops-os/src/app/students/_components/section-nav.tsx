'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** The record's section tabs (the shared pill segmented control, one row): keeps the current tab in view when the row scrolls. */
export function SectionNav({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && current)
      nav.scrollLeft +=
        current.getBoundingClientRect().left - nav.getBoundingClientRect().left - 16;
  }, []);
  return (
    <nav ref={ref} className="el-subnav" aria-label={label}>
      {children}
    </nav>
  );
}
