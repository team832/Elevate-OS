'use client';

/**
 * The frame around every chart: a <figure> that shows a tooltip for the mark under the
 * pointer. Marks carry their words in `data-tip` ("12 Oct: 14 demos"); the server renders
 * them, so this is the only client code a chart needs. The tooltip is visual only — the
 * values are already in the marks' text, the legend or the "Show as table" view.
 */
import { useState, type HTMLAttributes, type PointerEvent, type ReactNode } from 'react';

export function ChartFigure({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const onPointerOver = (e: PointerEvent<HTMLElement>) => {
    const mark = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (!mark || !e.currentTarget.contains(mark)) {
      setTip(null);
      return;
    }
    const frame = e.currentTarget.getBoundingClientRect();
    const box = mark.getBoundingClientRect();
    setTip({
      text: mark.dataset.tip ?? '',
      x: box.left + box.width / 2 - frame.left,
      y: box.top - frame.top,
    });
  };
  return (
    <figure
      className={['el-chart', className].filter(Boolean).join(' ')}
      onPointerOver={onPointerOver}
      onPointerLeave={() => setTip(null)}
      {...rest}
    >
      {children}
      {tip ? (
        <div className="el-chart-tip" aria-hidden="true" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      ) : null}
    </figure>
  );
}
