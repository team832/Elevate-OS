import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { homeworkMarksBody } from '../../../../../../server/schemas-homework';
import { markHomework } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** PUT /academic/api/v1/homework/:id/marks — Save the marks sent (submitted, late, not submitted, excused + remark); others stay as they are. */
export const PUT = defineRoute({ permission: 'academic:classes:record', params: uuidParams, body: homeworkMarksBody }, async (ctx) => markHomework(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
