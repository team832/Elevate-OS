import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextActionButton } from '../../src/app/tasks/_components/task-common';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const row = (id: string, title: string, more = {}) => ({
  id,
  title,
  version: 1,
  status: 'pending' as const,
  reviewRequired: true,
  acknowledgedAt: null,
  blockedAt: null,
  ...more,
});

describe('My Tasks next action (brief §18, review M2)', () => {
  it('each row’s button is named after its task', () => {
    const html = renderToStaticMarkup(
      <>
        <NextActionButton t={row('a', 'Call Asha')} base="/academic" />
        <NextActionButton t={row('b', 'Print forms')} base="/academic" />
      </>,
    );
    for (const title of ['Call Asha', 'Print forms'])
      expect(html).toContain(`Acknowledge<span class="el-visually-hidden"> — ${title}</span>`);
  });

  it('submit opens the task’s submit form in the host workspace; submitted waits', () => {
    const html = renderToStaticMarkup(
      <NextActionButton
        t={row('a', 'Worksheet', { status: 'in_progress', acknowledgedAt: new Date() })}
        base="/academic"
      />,
    );
    expect(html).toContain('href="/academic/tasks/a#submit"');
    expect(
      renderToStaticMarkup(
        <NextActionButton
          t={row('a', 'Worksheet', { status: 'in_review', acknowledgedAt: new Date() })}
          base="/academic"
        />,
      ),
    ).toContain('Waiting for review');
  });
});
