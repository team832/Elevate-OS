import { describe, expect, it } from 'vitest';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import {
  DisabledEmailAdapter,
  MockEmailAdapter,
  countUnread,
  getEmailAdapter,
  listNotifications,
  markNotificationsRead,
  notify,
} from '../src/index';

const ctx = setupTestDatabase();

describe('in-app notifications', () => {
  it('notifies recipients, lists newest first, marks read only own rows', async () => {
    const a = await createTestUser(ctx.db, { roles: ['teacher'] });
    const b = await createTestUser(ctx.db, { roles: ['teacher'] });
    const [first] = await notify(ctx.db, {
      userIds: [a.id, a.id],
      module: 'academic',
      kind: 'class.assigned',
      title: 'First',
      link: '/academic',
    });
    await notify(ctx.db, {
      userIds: [a.id, b.id],
      module: 'academic',
      kind: 'class.assigned',
      title: 'Second',
    });
    expect(await countUnread(ctx.db, a.id)).toBe(2);
    expect((await listNotifications(ctx.db, a.id)).map((n) => n.title)).toEqual([
      'Second',
      'First',
    ]);

    expect(await markNotificationsRead(ctx.db, b.id, [first!])).toBe(0);
    expect(await markNotificationsRead(ctx.db, a.id, [first!])).toBe(1);
    expect(
      (await listNotifications(ctx.db, a.id, { unreadOnly: true })).map((n) => n.title),
    ).toEqual(['Second']);
    expect(await markNotificationsRead(ctx.db, a.id, 'all')).toBe(1);
    expect(await countUnread(ctx.db, a.id)).toBe(0);
    expect(await countUnread(ctx.db, b.id)).toBe(1);
  });

  it('rejects absolute links', async () => {
    const a = await createTestUser(ctx.db);
    await expect(
      notify(ctx.db, {
        userIds: [a.id],
        module: 'ops',
        kind: 'x',
        title: 'x',
        link: 'https://evil.example',
      }),
    ).rejects.toThrow();
  });
});

describe('channel adapters', () => {
  it('mock email records the message but never claims delivery', async () => {
    const adapter = new MockEmailAdapter();
    const result = await adapter.send({
      to: 'parent@example.test',
      subject: 'Class moved',
      text: 'x',
    });
    expect(result.status).toBe('not_sent');
    expect(adapter.connection).toBe('sandbox');
    expect(adapter.sent).toHaveLength(1);
  });

  it('selects the adapter from configuration', () => {
    expect(getEmailAdapter('mock')).toBeInstanceOf(MockEmailAdapter);
    expect(getEmailAdapter('disabled')).toBeInstanceOf(DisabledEmailAdapter);
    expect(() => getEmailAdapter('smtp')).toThrow();
  });
});
