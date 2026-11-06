import { defineInternalRoute } from '@elevate/server-kit';
import { academicAbsencesQuery } from '@elevate/shared-contracts';
import { absencesBetween } from '../../../../../server';

export const dynamic = 'force-dynamic';

/**
 * GET /academic/api/internal/v1/absences?from&to — AcademicAbsencesV1 for Business Ops (bearer
 * INTERNAL_SERVICE_TOKEN + X-Elevate-Caller: ops, F4-06): students marked absent, absent only.
 */
export const GET = defineInternalRoute({ callers: ['ops'], query: academicAbsencesQuery }, async ({ db, query }) => absencesBetween(db, query));
