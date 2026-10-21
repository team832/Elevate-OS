import { created, defineRoute, respond } from '@elevate/server-kit';
import { errorResponse, RateLimitedError } from '@elevate/shared-contracts';
import { confirmAdmission } from '../../../../../../server/applications-confirm';
import { confirmBody } from '../../../../../../server/applications-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/applications/[id]/confirm — Final admission confirmation by an approver with their own password and the reviewed version: admission number, approval, enrolment request. A retry or concurrent click replays the one approval (200, replayed: true); 429 + Retry-After after repeated wrong passwords.
 */
export const POST = defineRoute(
  { permission: 'ops:admissions:confirm', params: idParams, body: confirmBody },
  async ({ user, db, params, body, requestId }) => {
    try {
      const r = await confirmAdmission(db, user, params.id, body, requestId);
      return r.replayed ? respond(r) : created(r);
    } catch (e) {
      if (!(e instanceof RateLimitedError)) throw e;
      const { retryAfterSeconds } = e.details as { retryAfterSeconds: number };
      return errorResponse(e, requestId, { headers: { 'retry-after': String(retryAfterSeconds) } });
    }
  },
);
