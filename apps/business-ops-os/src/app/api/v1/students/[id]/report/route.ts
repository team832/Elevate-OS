import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../../server/schemas';
import { reportBody } from '../../../../../../server/report-schemas';
import { generateStudentReport, getStudentReport } from '../../../../../../server/student-report';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/students/[id]/report — Draft report for a period and audience (snapshot, export reference, audit). */
export const POST = defineRoute(
  { permission: 'ops:student_reports:generate', params: idParams, body: reportBody },
  async ({ user, db, params, body, requestId }) =>
    created(await generateStudentReport(db, user, params.id, body, requestId)),
);

/** GET /ops/api/v1/students/[id]/report?ref=SR-… — The stored report, cut to the reader's permissions. */
export const GET = defineRoute(
  {
    permission: 'ops:student_reports:generate',
    params: idParams,
    query: z.object({ ref: z.string().regex(/^SR-[0-9A-Z]{10}$/) }),
  },
  async ({ user, db, params, query }) => {
    const {
      export: e,
      fields,
      view,
      actions,
      notice,
    } = await getStudentReport(db, user, params.id, query.ref);
    return { export: e, fields, view, actions, notice };
  },
);
