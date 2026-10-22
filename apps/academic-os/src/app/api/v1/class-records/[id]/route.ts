import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { updateClassBody } from '../../../../../server/schemas-teaching';
import { updateClassRecord } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** PATCH /academic/api/v1/class-records/:id — The author edits (and may submit) their draft; a stale `version` gets 409. */
export const PATCH = defineRoute({ permission: 'academic:classes:record', params: uuidParams, body: updateClassBody }, async (ctx) => updateClassRecord(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
