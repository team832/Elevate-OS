/** Every list download refuses more than 5,000 rows with a plain 400; none is cut short (FR-B M7). */
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../src/server/context';
import { exportList, type ExportList } from '../../src/server/list-exports';

// The page services, each answering "5,001 rows match".
vi.mock('../../src/server/students', async (orig) => ({
  ...(await orig<object>()),
  listStudents: vi.fn(async () => ({ items: [], total: 5001 })),
}));
vi.mock('../../src/server/leads', async (orig) => ({
  ...(await orig<object>()),
  leadCounts: vi.fn(async () => ({ total: 5001 })),
  listLeads: vi.fn(async () => []),
}));
vi.mock('../../src/server/lead-stages', async (orig) => ({
  ...(await orig<object>()),
  listLeadStages: vi.fn(async () => []),
}));
vi.mock('../../src/server/fee-collections', async (orig) => ({
  ...(await orig<object>()),
  listCollections: vi.fn(async () => ({ rows: [], total: 5001 })),
  outstandingInstalments: vi.fn(async () =>
    Array.from({ length: 5001 }, () => ({ dueDate: null })),
  ),
}));
vi.mock('../../src/server/organisation', async (orig) => ({
  ...(await orig<object>()),
  getDirectory: vi.fn(async () => ({ staff: [], total: 5001 })),
}));
vi.mock('../../src/server/staff-tasks', async (orig) => ({
  ...(await orig<object>()),
  listTasks: vi.fn(async () => ({ rows: [], total: 5001 })),
}));

describe('row limit', () => {
  it.each<ExportList>(['students', 'leads', 'collections', 'outstanding', 'staff', 'tasks'])(
    '%s: 5,001 matching rows → 400 asking to narrow the filters',
    async (list) => {
      await expect(exportList({} as never, {} as Actor, list, {})).rejects.toMatchObject({
        status: 400,
        message: 'This list has 5001 rows. Narrow the filters to 5000 or fewer to download it.',
      });
    },
  );
});
