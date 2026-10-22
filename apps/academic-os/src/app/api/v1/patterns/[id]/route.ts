import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { patternUpdateBody, deleteDraftBody } from '../../../../../server/schemas-sessions';
import { deleteDraftPattern, updateDraftPattern } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** PATCH /academic/api/v1/patterns/:id — Edit a draft pattern (version-checked; published patterns change through a series edit). */
export const PATCH = defineRoute({ permission: 'academic:timetable:write', params: uuidParams, body: patternUpdateBody }, async (ctx) => updateDraftPattern(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));

/** DELETE /academic/api/v1/patterns/:id — Delete a draft pattern (it generated no classes; the audit keeps its content). */
export const DELETE = defineRoute({ permission: 'academic:timetable:write', params: uuidParams, body: deleteDraftBody }, async (ctx) => deleteDraftPattern(ctx.db, actorOf(ctx), ctx.params.id, ctx.body.version));
