/**
 * Opening a notification (owner brief 23 Oct 2026 §8): mark it read, then re-check the
 * destination as it stands now — the workspace, and for a task or lead the record's own access
 * rule — before sending the person there. Access may have changed since it was sent.
 */
import { and, eq } from 'drizzle-orm';
import { can, type Permission } from '@elevate/authorization';
import { notifications, type Database } from '@elevate/database';
import { isRelativeLink, markNotificationsRead } from '@elevate/notifications';
import { AppError } from '@elevate/shared-contracts';
import type { NotificationId } from '@elevate/shared-types';
import type { Actor } from './context';
import { getLead } from './leads-read';
import { loadTaskFor } from './task-store';

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
/** Destinations with a record-level rule; other pages check access themselves when opened. */
const RECORD_CHECKS: [RegExp, (db: Database, actor: Actor, id: string) => Promise<unknown>][] = [
  [new RegExp(`^/tasks/${UUID}(?:[/?#]|$)`), (db, a, id) => loadTaskFor(db, a, id, false)],
  [new RegExp(`^/leads/${UUID}(?:[/?#]|$)`), getLead],
];

/** A link this redirect will follow: relative, in a known workspace, no `..` (plain or encoded). */
const WORKSPACE_LINK = /^\/(ops|academic|marketing)(\/.*)?$/;
const DOT_SEGMENT = /(^|\/)(\.|%2e){2}(\/|[?#]|$)/i;
const zoneOf = (link: string) =>
  isRelativeLink(link) && !DOT_SEGMENT.test(link) ? WORKSPACE_LINK.exec(link) : null;

async function mayOpen(db: Database, actor: Actor, [, zone, rest = '']: RegExpExecArray) {
  if (!can(actor, `${zone}:module:access` as Permission)) return false;
  for (const [pattern, check] of RECORD_CHECKS) {
    const id = pattern.exec(rest)?.[1];
    if (!id) continue;
    try {
      await check(db, actor, id);
    } catch (error) {
      if (error instanceof AppError && error.status < 500) return false;
      throw error;
    }
  }
  return true;
}

export type OpenResult = { href: string } | { refused: 'missing' | 'denied' | 'no_link' };

export async function openNotification(
  db: Database,
  actor: Actor,
  id: string,
): Promise<OpenResult> {
  const [n] = await db
    .select({ id: notifications.id, link: notifications.link })
    .from(notifications)
    .where(and(eq(notifications.id, id as NotificationId), eq(notifications.userId, actor.id)));
  if (!n) return { refused: 'missing' };
  await markNotificationsRead(db, actor.id, [n.id]);
  if (!n.link) return { refused: 'no_link' };
  const target = zoneOf(n.link);
  if (!target) return { refused: 'missing' };
  if (!(await mayOpen(db, actor, target))) return { refused: 'denied' };
  return { href: n.link };
}
