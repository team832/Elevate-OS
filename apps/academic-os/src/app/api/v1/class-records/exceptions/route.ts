import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { logExceptionsQuery } from '../../../../../server/schemas-teaching';
import { getLogExceptions } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/class-records/exceptions?from&to&batchId&teacherStaffId — Delivered sessions without a submitted log, and planned ≠ logged chapter. */
export const GET = defineRoute({ permission: 'academic:classes:read', query: logExceptionsQuery }, async (ctx) => getLogExceptions(ctx.db, actorOf(ctx), ctx.query));
