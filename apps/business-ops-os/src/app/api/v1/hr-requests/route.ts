import { created, defineRoute } from '@elevate/server-kit';
import { createHrRequest } from '../../../../server/hr-requests';
import { hrQueue, listForwardedToMe, listMyRequests } from '../../../../server/hr-requests-read';
import { hrRequestBody, hrRequestListQuery } from '../../../../server/hr-requests-schemas';

export const dynamic = 'force-dynamic';

const ANY = { anyOf: ['ops:hr_requests:create', 'ops:hr_requests:read'] } as const;

/**
 * GET <base>/api/v1/hr-requests?view=mine|forwarded|queue — your requests, what HR forwarded to
 * you, or (ops:hr_requests:read) the HR queue with `?tab=new|review|forwarded|closed&urgency&category&q`.
 */
export const GET = defineRoute(
  { permission: ANY, query: hrRequestListQuery },
  async ({ user, db, query }) =>
    query.view === 'queue'
      ? hrQueue(db, user, query)
      : query.view === 'forwarded'
        ? listForwardedToMe(db, user)
        : listMyRequests(db, user, query.page),
);

/** POST <base>/api/v1/hr-requests — Send a request through HR (`draft: true` keeps it as a draft). */
export const POST = defineRoute(
  { permission: 'ops:hr_requests:create', body: hrRequestBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) =>
    created(await createHrRequest(db, user, body, requestId)),
);
