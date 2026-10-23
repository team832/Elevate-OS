import { defineRoute } from '@elevate/server-kit';
import { inboxPage, inboxQuery, markRead, markReadBody } from '../../../notifications/inbox';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/notifications — Your in-app notifications, newest first, 25 a page (`?page=`), with total and unread counts. */
export const GET = defineRoute(
  { permission: 'platform:notifications:read', query: inboxQuery },
  async ({ user, db, query }) => inboxPage(db, user.id, query.page),
);

/** POST /ops/api/v1/notifications — Mark your notifications read: `{ ids: [...] }` or `{ all: true }`; other people's ids change nothing. */
export const POST = defineRoute(
  { permission: 'platform:notifications:read', body: markReadBody },
  async ({ user, db, body }) => markRead(db, user.id, body),
);
