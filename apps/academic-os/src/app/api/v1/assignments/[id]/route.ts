import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { updateAssignmentBody } from '../../../../../server/schemas-placements';
import { reasonBody } from '../../../../../server/schemas-sessions';
import { updateAssignment, withdrawAssignment } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** PATCH /academic/api/v1/assignments/:id — Edit role, dates, year or branch; a batch on a pending assignment activates it. */
export const PATCH = defineRoute({ permission: 'academic:assignments:write', params: uuidParams, body: updateAssignmentBody }, async (ctx) => updateAssignment(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));

/** DELETE /academic/api/v1/assignments/:id — Withdraw a pending assignment (no batch, never granted access). */
export const DELETE = defineRoute({ permission: 'academic:assignments:write', params: uuidParams, body: reasonBody }, async (ctx) => withdrawAssignment(ctx.db, actorOf(ctx), ctx.params.id, ctx.body.reason));
