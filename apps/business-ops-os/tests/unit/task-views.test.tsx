import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DayTable } from '../../src/app/tasks/_components/task-views';
import type { EodItem } from '../../src/domain/staff-tasks';
import type { RowOptions } from '../../src/server/task-detail';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const row = (id: string, title: string): EodItem => ({
  id,
  title,
  priority: 'medium',
  dueOn: '2026-10-21',
  dueTime: null,
  overdue: false,
  status: 'pending',
  progressPercent: 0,
  reason: null,
});

const opts = new Map(
  ['a', 'b'].map((id): [string, RowOptions] => [
    id,
    { version: 1, statuses: ['pending', 'in_progress'] },
  ]),
);

describe('My day row forms (review M2)', () => {
  it('each row’s fields and Save button are named after its task', () => {
    const html = renderToStaticMarkup(
      <DayTable rows={[row('a', 'Call Asha'), row('b', 'Print forms')]} edit={opts} />,
    );
    for (const title of ['Call Asha', 'Print forms'])
      expect(html.match(new RegExp(`for ${title}<`, 'g'))).toHaveLength(4); // 3 labels + Save
  });
});
