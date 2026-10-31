import { defineInternalWriteRoute } from '@elevate/server-kit';
import { z } from 'zod';
import { internalActor } from '../../../../../../server/services/assessment-ops';
import { runEnrolmentExits } from '../../../../../../server/services/enrolment-exit';

export const dynamic = 'force-dynamic';

/** POST /academic/api/internal/v1/enrolment-exits/run — Business Ops runs the exit consumer ("Send exits to Academic"). */
export const POST = defineInternalWriteRoute({ callers: ['ops'], body: z.strictObject({}) }, async ({ db, actingUserId, requestId }) => {
  await internalActor(db, actingUserId, requestId);
  return runEnrolmentExits(db);
});
