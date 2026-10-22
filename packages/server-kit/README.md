# @elevate/server-kit

Everything a module's server code needs to follow the platform conventions. Import from `@elevate/server-kit`; page helpers from `@elevate/server-kit/next`.

## `defineRoute(spec, handler, options?)`
Wraps a Next.js App Router route handler: request id → session → permission (server-side) → params/query/body validation (zod) → handler → D-012 envelope, one JSON log line per request.

```ts
// apps/business-ops-os/src/app/api/v1/leads/[id]/route.ts
import { z } from 'zod';
import { created, defineRoute, NotFoundError } from '@elevate/server-kit';

export const PATCH = defineRoute(
  {
    permission: 'ops:leads:write',              // or { anyOf: [...] } | 'authenticated' | 'public'
    params: z.object({ id: z.uuid() }),
    query: z.object({ dryRun: z.enum(['true', 'false']).default('false') }),
    body: z.object({ status: z.enum(['new', 'contacted']) }),
    idempotency: 'optional',                     // honour Idempotency-Key (runs in a transaction)
  },
  async ({ params, query, body, user, scope, db, requestId, log }) => {
    // scope is 'all' | 'own' for the route permission
    return { id: params.id };                    // → 200 { data }
    // return created(value)  → 201;  respond(value, { status, meta, headers });  or a Response
    // throw new NotFoundError('…') → 404 { error: { code, message, requestId } }
  },
);
```
Order of checks: no session → 401 `UNAUTHENTICATED`; missing permission → 403 `FORBIDDEN` (before any validation); bad input → 400 `VALIDATION_FAILED` with `details: [{ location, path, message }]`; body routes require `Content-Type: application/json`. Thrown `AppError`s keep their code; zod errors → 400; PG unique violation → 409 `CONFLICT`; FK/check violations → 400; anything else → 500 `INTERNAL` with a generic message (details only in the log). Every response carries `x-request-id`.

## Transactions and audit
- `withTransaction(db, async (tx) => …)` — business rows, audit, outbox events and notifications commit together.
- `recordAudit(tx, { actorUserId, module, action, entityType, entityId, before?, after?, requestId?, metadata? })` → `core.audit_events` (append-only; no update/delete API).

## Approvals (`core.approvals`, history-preserving)
```ts
export const publishPolicy = defineApprovalPolicy({
  key: 'marketing.content.publish', module: 'marketing', subjectType: 'content_item',
  deciderPermission: 'marketing:content:approve', requesterPermission: 'marketing:content:write',
  allowSelfApproval: false, description: '…',
});
await requestApproval(tx, { policy, subjectId, requestedBy: user, comment, requestId });
await decideApproval(tx, { policy, approvalId, decider: user, decision: 'approved' | 'rejected', comment, requestId });
await withdrawApproval(tx, { policy, approvalId, actor: user });
await listApprovalHistory(db, { module, subjectType, subjectId });   // oldest first
await findPendingApproval(db, policy, subjectId);
```
Rules enforced: decider holds `deciderPermission`; requester ≠ decider unless `allowSelfApproval`; only `pending` can be decided (`INVALID_STATE_TRANSITION`); one pending request per subject+policy (`CONFLICT`); rejection needs a comment (unless `requireCommentOnReject: false`); every step audited; rows are never deleted.

## Outbox (D-011.1)
```ts
await publishEvent(tx, { type: 'ops.admission.enrolment_requested', version: 1,
  idempotencyKey: enrolmentKeys.request(admissionId, 1), payload, correlationId?, causationId? });
// → { id, created }  (same producer+key → same event, created:false)

await processEvents(db, {
  consumer: 'academic.enrolment-intake',
  handlers: { 'ops.admission.enrolment_requested': async (event, { db: tx, log }) => { … } },
  batchSize: 50, maxAttempts: 5,
});
// or { consumer, types: [...], handler: async (event, ctx) => … }
// → { processed, failed, skipped }
```
Payloads are validated against the registry on publish and on delivery. Each event is handled in its own transaction with a `core.event_deliveries` row (unique event+consumer): processing twice has one effect; a failing handler rolls back, is recorded `failed` with the error, retried next run, and becomes `dead` after `maxAttempts`. `getDelivery(db, eventId, consumer)` shows the state. **Nothing runs `processEvents` on a schedule yet** — the consumer module calls it (from a route, a script, or a cron added in wave 3).

## Internal service calls (D-011.2)
- `defineInternalRoute({ callers?, query?, params? }, handler)` for `/<zone>/api/internal/v1/...`: requires `Authorization: Bearer <token>` (constant-time compare) and `X-Elevate-Caller: <module>`. With the single `INTERNAL_SERVICE_TOKEN` the caller is self-declared; with `INTERNAL_SERVICE_TOKENS` (`ops:<t>,academic:<t>,marketing:<t>,platform:<t>`, 32+ characters each, the same in all four apps) the caller is the module whose token matched — 401 when none matches, 403 when the header names another module — and a malformed map fails closed (D-077). `fetchInternal` sends the calling module's token.
- `fetchInternal(url, schema, { caller, timeoutMs? })` → `SourceResult<T>`: never throws, never substitutes zeros; returns `{ status: 'unavailable', reason }` on network error, timeout, non-2xx or contract mismatch.

## Idempotency
`withIdempotency(tx, { scope, key, userId, requestHash }, run)` (used by `defineRoute`'s `idempotency` option): stored responses kept 24 h in `core.idempotency_keys`; same key + same body → replay (`idempotency-replayed: true`); same key + different body → 409; failure rolls back the key.

## Other
- `createHealthHandler({ app, module })` — 200/503 with `checks.database`.
- `createLogger(fields)` — JSON lines, `LOG_LEVEL`.
- `toAppPath(browserPath, basePath)`.
- `@elevate/server-kit/next`: `requirePageAccess(permission, { loginPath, returnTo, basePath })` → redirect (307) when signed out, `{ status: 'allowed' | 'forbidden', user, modules }` otherwise; `requireUser(...)`, `getCurrentUser()`, `currentRequestId()`. Pass **browser paths**; Next's `redirect()` adds the basePath itself and the helper strips it first.

Tests: `tests/define-route.test.ts`, `tests/approvals.test.ts`, `tests/outbox.test.ts`, `tests/internal.test.ts`.
