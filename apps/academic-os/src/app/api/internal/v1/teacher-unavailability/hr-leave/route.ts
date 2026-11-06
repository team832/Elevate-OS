import { defineInternalWriteRoute } from '@elevate/server-kit';
import { academicHrLeaveBody } from '@elevate/shared-contracts';
import { syncHrLeave } from '../../../../../../server';
import { internalActor } from '../../../../../../server/services/assessment-ops';

export const dynamic = 'force-dynamic';

/** POST /academic/api/internal/v1/teacher-unavailability/hr-leave — Business Ops sends a teacher's approved HR leave or its cancellation (D-134); their classes in those dates need cover while it stands. */
export const POST = defineInternalWriteRoute({ callers: ['ops'], body: academicHrLeaveBody }, async ({ db, body, actingUserId, requestId }) =>
  syncHrLeave(db, await internalActor(db, actingUserId, requestId), body),
);
