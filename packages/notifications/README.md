# @elevate/notifications

In-app notifications stored in `core.notifications`, and external channel adapters.

```ts
import { notify, listNotifications, countUnread, markNotificationsRead, getEmailAdapter } from '@elevate/notifications';

await withTransaction(db, async (tx) => {
  // ... your change ...
  await notify(tx, { userIds: [coordinatorId], module: 'academic', kind: 'enrolment.requested',
                     title: 'New enrolment request', link: '/academic/enrolments/<id>' });
});
```

- `notify(tx, input)` — one row per distinct recipient; `link` must be a relative path.
- `listNotifications(db, userId, { unreadOnly?, limit? })`, `countUnread(db, userId)`.
- `markNotificationsRead(db, userId, ids | 'all')` — only touches the caller's own rows.

## Channels (D-014)
`ChannelAdapter.send()` returns `sent | not_sent | failed`. **Only `MockEmailAdapter` and `DisabledEmailAdapter` exist.** The mock logs (recipient domain + subject only) and returns `not_sent` — no screen may say an email was delivered. `getEmailAdapter()` reads `NOTIFICATIONS_EMAIL_ADAPTER` (`mock` default, `disabled`). A real provider needs an approved decision, credentials, and a verification call before it may report `connected`.

Tests: `tests/notifications.test.ts`.
