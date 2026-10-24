/** New-notification toast (owner brief 23 Oct 2026 §8): static markup and the "new since" rule. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { AppShell, NotificationToaster, ToastList, afterDismiss, newSince } from '../src';

const item = (id: string, createdAt: string, readAt: string | null = null) => ({
  id,
  title: `Sample notice ${id}`,
  createdAt,
  readAt,
});

describe('ToastList markup', () => {
  const out = render(
    <ToastList base="/academic" toasts={[item('a1', '2026-10-23T05:00:00.000Z')]} />,
  );

  it('is a polite live region that links through the permission-checked open route', () => {
    expect(out).toMatch(/class="el-toasts" role="status" aria-live="polite"/);
    expect(out).toContain('href="/academic/notifications/a1/open"');
    expect(out).toContain('Dismiss<span class="el-visually-hidden"> — Sample notice a1</span>');
  });

  it('never takes focus or blocks the page', () => {
    expect(out).not.toMatch(/autofocus|tabindex|role="dialog"|role="alert"|aria-modal/i);
  });

  it('starts as an empty live region, so later toasts are announced', () => {
    expect(render(<NotificationToaster base="/ops" unread={3} />)).toBe(
      '<div class="el-toasts" role="status" aria-live="polite" aria-label="New notifications"></div>',
    );
  });

  it('has no motion under prefers-reduced-motion', () => {
    const css = readFileSync(new URL('../src/css/notify.css', import.meta.url), 'utf8');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.el-toast \{\s*animation: none;/,
    );
    expect(readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')).toContain(
      "@import './css/notify.css';",
    );
  });
});

describe('newSince', () => {
  const items = [
    item('n3', '2026-10-23T07:00:00.000Z'),
    item('n2', '2026-10-23T06:00:00.000Z', '2026-10-23T06:30:00.000Z'),
    item('n1', '2026-10-23T05:00:00.000Z'),
  ];
  it.each([
    ['no marker: every unread item', null, ['n3', 'n1']],
    ['after the marker only', '2026-10-23T05:30:00.000Z', ['n3']],
    ['nothing newer than the marker', '2026-10-23T07:00:00.000Z', []],
  ])('%s', (_, seen, ids) => expect(newSince(items, seen).map((n) => n.id)).toEqual(ids));
});

describe('afterDismiss (keyboard dismiss keeps focus in a sensible place)', () => {
  it.each([
    ['focus inside: the next toast', ['a', 'b', 'c'], 'b', true, { focus: 'c', paused: true }],
    [
      'focus inside, last toast: the previous one',
      ['a', 'b'],
      'b',
      true,
      { focus: 'a', paused: true },
    ],
    [
      'focus inside, only toast: back to the bell',
      ['a'],
      'a',
      true,
      { focus: 'bell', paused: false },
    ],
    [
      'mouse dismiss (focus elsewhere): focus untouched, timer resumes',
      ['a', 'b'],
      'a',
      false,
      { focus: null, paused: false },
    ],
  ] as const)('%s', (_, ids, id, inside, expected) =>
    expect(afterDismiss(ids, id, inside)).toEqual(expected),
  );

  it('toasts carry their id so focus can find them', () => {
    expect(
      render(<ToastList base="/ops" toasts={[item('z9', '2026-10-23T05:00:00.000Z')]} />),
    ).toContain('data-toast-id="z9"');
  });
});

describe('AppShell mounts the toaster once, only in a workspace with a count', () => {
  const shell = (current: 'ops' | 'platform', unread?: number) =>
    render(
      <AppShell
        user={{ displayName: 'Sample User', email: 'sample@example.test', roles: [] }}
        modules={['ops']}
        current={current}
        logoutAction="/ops/api/v1/auth/logout"
        unreadNotifications={unread}
      >
        <p>Body</p>
      </AppShell>,
    );
  it.each([
    ['ops', 2, 1],
    ['ops', undefined, 0],
    ['platform', 2, 0],
  ] as const)('%s with unread %s → %s', (current, unread, n) => {
    expect(shell(current, unread).split('class="el-toasts"').length - 1).toBe(n);
  });
});
