import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { runFile } from '../../../../../../../server/payroll-read';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/payroll/runs/:id/download?format=pdf|csv — every payslip of a run. Audited. */
export const GET = defineRoute(
  {
    permission: { anyOf: ['ops:payroll:manage', 'ops:payroll:approve'] },
    params: idParams,
    query: z.object({ format: z.enum(['pdf', 'csv']).default('pdf') }),
  },
  ({ db, user, params, query }) => runFile(db, user, params.id, query.format),
);
