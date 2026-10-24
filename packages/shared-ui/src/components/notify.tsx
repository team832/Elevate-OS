'use client';

/**
 * Brief toast for new in-app notifications (owner brief 23 Oct 2026 §8), mounted once by the
 * AppShell top bar. Lightest option: no polling and no timer while idle. It reads
 * `<base>/api/v1/notifications` only when the page renders with unread notifications (a page
 * load or a navigation that changes the count), and shows those newer than this browser's last
 * seen marker. Non-modal: a polite live region that never takes focus, auto-dismisses after
 * 8 s, pauses while hovered or focused, and has no motion under prefers-reduced-motion
 * (css/notify.css). The person's "pop-ups off" setting (`popUps: false`) shows nothing.
 * DOM order: the region sits right after the bell in the top bar, so Tab goes bell → toasts →
 * account menu even though the toasts are drawn in the bottom corner (no aria-flowto needed).
 */
import { useEffect, useState, type FocusEvent, type MouseEvent } from 'react';

export interface ToastItem {
  id: string;
  title: string;
  createdAt: string;
}
type InboxItem = ToastItem & { readAt: string | null };

const SEEN_KEY = 'el-notify-seen';
const SHOW_MS = 8000;
const MAX = 3;

function seenMarker(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function markSeen(at: string) {
  try {
    if ((localStorage.getItem(SEEN_KEY) ?? '') < at) localStorage.setItem(SEEN_KEY, at);
  } catch {
    // storage blocked: toasts may repeat on the next page, nothing else breaks
  }
}

/** Unread items created after the marker, newest first (no marker = every unread item). */
export const newSince = (items: readonly InboxItem[], seen: string | null) =>
  items.filter((n) => !n.readAt && (!seen || n.createdAt > seen)).slice(0, MAX);

/**
 * Where focus goes when toast `id` is dismissed: if focus was in the toasts, the next toast (else
 * the previous, else the bell); otherwise nowhere. The timer stays paused only while focus is
 * still on a toast — a removed toast can no longer be hovered or focused.
 */
export function afterDismiss(ids: readonly string[], id: string, focusInside: boolean) {
  if (!focusInside) return { focus: null, paused: false };
  const i = ids.indexOf(id);
  const next = ids[i + 1] ?? ids[i - 1];
  return next ? { focus: next, paused: true } : { focus: 'bell', paused: false };
}

export function NotificationToaster({ base, unread }: { base: string; unread: number }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (unread === 0) return;
    let live = true;
    fetch(`${base}/api/v1/notifications`, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: { items: InboxItem[]; popUps: boolean } } | null) => {
        const d = body?.data;
        if (!live || !d?.items.length) return;
        const seen = seenMarker();
        markSeen(d.items[0]!.createdAt);
        if (d.popUps) setToasts(newSince(d.items, seen));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [base, unread]);

  useEffect(() => {
    if (!toasts.length || paused) return;
    const timer = setTimeout(() => setToasts([]), SHOW_MS);
    return () => clearTimeout(timer);
  }, [toasts, paused]);

  return (
    <ToastList
      base={base}
      toasts={toasts}
      onPause={setPaused}
      onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))}
    />
  );
}

/** The live region and its toasts (rendered empty until there is something new). */
export function ToastList({
  base,
  toasts,
  onPause,
  onDismiss,
}: {
  base: string;
  toasts: readonly ToastItem[];
  onPause?: (paused: boolean) => void;
  onDismiss?: (id: string) => void;
}) {
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) onPause?.(false);
  };
  const dismiss = (e: MouseEvent<HTMLButtonElement>, id: string) => {
    const region = e.currentTarget.closest('.el-toasts');
    const ids = toasts.map((t) => t.id);
    const next = afterDismiss(ids, id, !!region?.contains(document.activeElement));
    const target =
      next.focus === 'bell'
        ? document.querySelector<HTMLElement>('.el-notify')
        : next.focus
          ? region?.querySelector<HTMLElement>(`[data-toast-id="${next.focus}"] a`)
          : null;
    target?.focus();
    onPause?.(next.paused);
    onDismiss?.(id);
  };
  return (
    <div
      className="el-toasts"
      role="status"
      aria-live="polite"
      aria-label="New notifications"
      onMouseEnter={() => onPause?.(true)}
      onMouseLeave={() => onPause?.(false)}
      onFocus={() => onPause?.(true)}
      onBlur={leave}
    >
      {toasts.map((t) => (
        <div key={t.id} className="el-toast" data-toast-id={t.id}>
          <a className="el-toast-link" href={`${base}/notifications/${t.id}/open`}>
            {t.title}
          </a>
          <button type="button" className="el-toast-close" onClick={(e) => dismiss(e, t.id)}>
            Dismiss<span className="el-visually-hidden"> — {t.title}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
