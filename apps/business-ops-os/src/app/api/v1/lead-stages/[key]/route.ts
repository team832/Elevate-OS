import { defineRoute } from '@elevate/server-kit';
import { deleteLeadStage, updateLeadStage } from '../../../../../server/lead-stages';
import { stageKeyParams, stageUpdateBody } from '../../../../../server/lead-stages-schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/lead-stages/[key] — Rename, reorder or switch a stage on/off (the key never changes). */
export const PATCH = defineRoute(
  { permission: 'ops:leads:assign', params: stageKeyParams, body: stageUpdateBody },
  async ({ user, db, params, body, requestId }) =>
    updateLeadStage(db, user, params.key, body, requestId),
);

/** DELETE /ops/api/v1/lead-stages/[key] — Remove an unused stage a manager added (system stages stay). */
export const DELETE = defineRoute(
  { permission: 'ops:leads:assign', params: stageKeyParams },
  async ({ user, db, params, requestId }) => deleteLeadStage(db, user, params.key, requestId),
);
