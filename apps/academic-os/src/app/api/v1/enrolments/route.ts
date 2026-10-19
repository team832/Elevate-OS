import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { enrolmentsQuery, manualEnrolmentBody } from '../../../../server/schemas';
import { enrolManually, listEnrolments } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/enrolments — Enrolments (?batchId=). */
export const GET = defineRoute({ permission: 'academic:enrolments:read', query: enrolmentsQuery }, async (ctx) => listEnrolments(ctx.db, ctx.query));

/** POST /academic/api/v1/enrolments — Manual enrolment by a coordinator (reason required). */
export const POST = defineRoute({ permission: 'academic:enrolments:decide', body: manualEnrolmentBody }, async (ctx) => created(await enrolManually(ctx.db, actorOf(ctx), ctx.body)));
