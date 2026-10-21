import { z } from 'zod';
import { defineInternalRoute } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { todayIst } from '../../../../../../../server/context';
import { summaryQuery } from '../../../../../../../server/schemas';
import { buildStudentSummary } from '../../../../../../../server/services/student-summary';

export const dynamic = 'force-dynamic';

/**
 * GET /academic/api/internal/v1/students/{id}/summary?from&to — AcademicStudentSummaryV1 for
 * Business Ops only (bearer INTERNAL_SERVICE_TOKEN + X-Elevate-Caller: ops). Default window:
 * the last 365 days (IST). Absent is never a score; missing is never zero.
 */
export const GET = defineInternalRoute(
  { callers: ['ops'], params: z.object({ id: z.uuid() }), query: summaryQuery },
  async ({ db, params, query }) => {
    const to = query.to ?? todayIst();
    const from = query.from ?? addDays(to as IsoDate, -364);
    if (from > to) throw new ValidationError('from must not be after to.');
    if (from < addDays(to as IsoDate, -3 * 366))
      throw new ValidationError('The window may span at most three years.');
    return buildStudentSummary(db, params.id, { from, to });
  },
);
