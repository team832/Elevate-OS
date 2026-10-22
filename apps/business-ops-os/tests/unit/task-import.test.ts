import { describe, expect, it } from 'vitest';
import {
  exportDateFromName,
  NO_REASON,
  NOT_AN_EXPORT,
  parseTrackerBackup,
  stableJson,
  suggestStaff,
  taskDifferences,
} from '../../src/domain/task-import';

const task = (over: Record<string, unknown> = {}) => ({
  id: 1729500000000,
  title: 'File GST return',
  details: '',
  by: 'Sample Boss',
  client: 'Sample Client',
  prio: 'High',
  deadlineDate: '2026-10-20',
  deadlineTime: '18:00',
  status: 'In progress',
  prog: 40,
  reason: '',
  recur: '',
  createdAt: '2026-10-18',
  completedAt: null,
  ...over,
});
const file = (tasks: unknown[], reports: unknown[] = []) =>
  JSON.stringify({
    setupDone: true,
    profile: { name: 'Sample A', email: 'A@Example.test', empId: 'E1' },
    clients: [],
    tasks,
    reports,
  });
const one = (over: Record<string, unknown>) => {
  const r = parseTrackerBackup(file([task(over)]));
  if (!r.ok) throw new Error(r.error);
  return r.backup.tasks[0]!;
};

describe('parseTrackerBackup', () => {
  it.each([
    ['<!DOCTYPE html><html><script>localStorage</script>', NOT_AN_EXPORT],
    ['  <html lang="en">', NOT_AN_EXPORT],
    ['<!-- saved page --><html>', NOT_AN_EXPORT],
    ['\uFEFF<!doctype html>', NOT_AN_EXPORT],
    ['not json', 'This file is not a tracker backup: it is not JSON.'],
    ['{"profile":{}}', 'This JSON file has no "tasks" list, so it is not a tracker backup.'],
  ])('refuses %j', (text, error) => {
    expect(parseTrackerBackup(text)).toEqual({ ok: false, error });
  });

  it.each([
    ['Not started', 'pending'],
    ['Not Started', 'pending'],
    ['In progress', 'in_progress'],
    ['In Progress', 'in_progress'],
    ['Done', 'done'],
    ['Blocked', 'blocked'],
    ['On-hold', 'on_hold'],
    ['On-Hold', 'on_hold'],
  ])('maps status %s → %s', (status, mapped) => {
    const t = one({ status, completedAt: status === 'Done' ? '2026-10-19' : null, reason: 'x' });
    expect(t.problem).toBeNull();
    expect(t.values?.status).toBe(mapped);
  });

  it.each([
    [{ status: 'Waiting' }, 'Status "Waiting" is not one the tracker uses.'],
    [{ status: undefined }, 'Status "" is not one the tracker uses.'],
    [{ prio: 'Urgent' }, 'Priority "Urgent" is not High, Medium or Low.'],
    [
      { deadlineDate: '' },
      'No deadline date. Elevate needs a due day: add one in the tracker and export again.',
    ],
    [{ deadlineTime: '6pm' }, 'Deadline time "6pm" is not HH:MM.'],
    [{ prog: 140 }, 'Progress 140% is outside 0–100.'],
    [{ status: 'Done', completedAt: null }, 'Marked Done without a completion date.'],
    [{ recur: 'yearly' }, 'Repeat "yearly" is not daily, weekly or monthly.'],
    [{ title: '  ' }, 'The task has no title.'],
  ])('leaves %j unresolved', (over, message) => {
    expect(one(over).problem).toEqual({ outcome: 'unresolved', message });
  });

  it('reads a backup saved with a byte-order mark', () => {
    expect(parseTrackerBackup('\uFEFF' + file([task()])).ok).toBe(true);
  });

  it('fails an unreadable record without failing the file', () => {
    const r = parseTrackerBackup(file([{ title: 'no id' }, task()]));
    expect(r.ok && r.backup.tasks.map((t) => t.problem?.outcome ?? 'ok')).toEqual(['failed', 'ok']);
  });

  it('maps fields, keeps legacy dates and never invents a reason or a completion', () => {
    expect(one({}).values).toEqual({
      title: 'File GST return',
      details: null,
      requesterNote: 'Given by Sample Boss · Client: Sample Client',
      priority: 'high',
      status: 'in_progress',
      progressPercent: 40,
      reason: null,
      recurrence: 'none',
      dueOn: '2026-10-20',
      dueTime: '18:00',
      createdOn: '2026-10-18',
      completedOn: null,
    });
    const blocked = one({ status: 'Blocked', reason: '' });
    expect(blocked.values?.reason).toBe(NO_REASON);
    expect(blocked.notes[0]).toContain(NO_REASON);
    expect(one({ status: 'Done', completedAt: '2026-10-19', prog: 50 }).values).toMatchObject({
      progressPercent: 100,
      completedOn: '2026-10-19',
    });
  });

  it('maps reports and drops the logo image from the copy it keeps', () => {
    const r = parseTrackerBackup(
      file(
        [],
        [
          {
            id: 5,
            reportDate: '2026-10-19',
            generatedAt: '2026-10-19T12:30:00.000Z',
            meta: { name: 'A', logo: 'data:image/png;base64,AAAA' },
            data: { done: [] },
            text: 'EOD',
          },
          { id: 6 },
        ],
      ),
    );
    expect(r.ok && r.backup.reports[0]!.values).toEqual({
      reportDate: '2026-10-19',
      generatedAt: '2026-10-19T12:30:00.000Z',
      text: 'EOD',
      legacy: { meta: { name: 'A' }, data: { done: [] } },
    });
    expect(r.ok && r.backup.reports[1]!.problem?.outcome).toBe('failed');
    expect(r.ok && r.backup.profile).toMatchObject({ email: 'a@example.test', empId: 'E1' });
  });

  it('hashes a record the same whatever its key order', () => {
    expect(stableJson({ b: 1, a: [{ d: null, c: 'x' }] })).toBe(
      stableJson({ a: [{ c: 'x', d: null }], b: 1 }),
    );
  });
});

describe('import helpers', () => {
  const staff = [
    { id: 's1', label: 'A', email: 'a@example.test', staffCode: null },
    { id: 's2', label: 'B', email: null, staffCode: 'E1' },
    { id: 's3', label: 'Sample A', email: null, staffCode: null },
  ];
  it('suggests staff by exact email or staff code, never by name', () => {
    const profile = {
      name: 'Sample A',
      email: 'a@example.test',
      empId: 'E1',
      department: null,
      designation: null,
    };
    expect(suggestStaff(profile, staff).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(suggestStaff({ ...profile, email: null, empId: null }, staff)).toEqual([]);
  });

  it('lists the fields where the newer tracker copy differs', () => {
    const v = one({}).values!;
    expect(taskDifferences(v, { ...v, dueTime: '18:00:00' })).toEqual([]);
    expect(taskDifferences(v, { ...v, dueTime: '17:00:00', status: 'done' })).toEqual([
      'Status',
      'Due time',
    ]);
  });

  it('reads the export date from the file name only', () => {
    expect(exportDateFromName('Task-EOD-backup-2026-10-21.json')).toBe('2026-10-21');
    expect(exportDateFromName('backup.json')).toBeNull();
  });
});
