import { defineInternalRoute } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { rangeQuery, staffParams } from '../../../../../../../server/schemas-sessions';
import { teacherActivity, todayIst } from '../../../../../../../server';

export const dynamic = 'force-dynamic';

/**
 * GET /academic/api/internal/v1/teachers/{staffId}/activity?from&to — AcademicTeacherActivityV1 for
 * Business Ops (bearer INTERNAL_SERVICE_TOKEN + X-Elevate-Caller: ops). Default window: the last
 * 30 days (IST). Operational counts only: not payroll, not HR attendance, no ratings.
 */
export const GET = defineInternalRoute({ callers: ['ops'], params: staffParams, query: rangeQuery }, async ({ db, params, query }) => {
  const to = query.to ?? todayIst();
  const from = query.from ?? addDays(to as IsoDate, -29);
  if (from > to) throw new ValidationError('from must not be after to.');
  if (from < addDays(to as IsoDate, -366)) throw new ValidationError('The window may span at most one year.');
  return teacherActivity(db, params.staffId, { from, to });
});
