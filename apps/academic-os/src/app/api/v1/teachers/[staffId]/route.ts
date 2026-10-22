import { defineRoute } from '@elevate/server-kit';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { actorOf } from '../../../../../server/route-helpers';
import { rangeQuery, staffParams } from '../../../../../server/schemas-sessions';
import { teacherProfile, todayIst } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/teachers/:staffId?from&to — Teacher profile: assignments, timetable, operational hours (not payroll). Default: last 30 days. */
export const GET = defineRoute({ permission: 'academic:assignments:read', params: staffParams, query: rangeQuery }, async (ctx) => {
  const to = ctx.query.to ?? todayIst();
  return teacherProfile(ctx.db, actorOf(ctx), ctx.params.staffId, { from: ctx.query.from ?? addDays(to as IsoDate, -29), to });
});
