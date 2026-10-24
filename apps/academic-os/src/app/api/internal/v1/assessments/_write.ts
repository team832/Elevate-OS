import { z } from 'zod';
import { defineInternalWriteRoute } from '@elevate/server-kit';
import type { Database } from '@elevate/database';
import type { Actor } from '../../../../../server/context';
import { internalActor } from '../../../../../server/services/assessment-ops';
import { getAssessmentDetail } from '../../../../../server/services/assessment-views';

export const idParams = z.object({ id: z.uuid() });

/**
 * An Academic internal assessment WRITE route for Business Ops (caller `ops`, service token,
 * acting user = audit actor): run `write`, then answer with academic.assessment v1.
 */
export function opsWrite<B extends z.ZodType, P extends z.ZodType<{ id: string }>>(
  spec: { body: B; params?: P },
  write: (db: Database, actor: Actor, params: z.output<P>, body: z.output<B>) => Promise<unknown>,
) {
  return defineInternalWriteRoute(
    { callers: ['ops'], params: spec.params ?? idParams, body: spec.body },
    async ({ db, params, body, actingUserId, requestId }) => {
      const p = params as z.output<P>;
      await write(db, await internalActor(db, actingUserId, requestId), p, body as z.output<B>);
      return getAssessmentDetail(db, p.id);
    },
  );
}
