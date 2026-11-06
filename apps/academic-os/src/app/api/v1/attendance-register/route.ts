import { z } from 'zod';
import { csvResponse, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { attendanceRegisterCsv } from '../../../../server/services/attendance-register';

export const dynamic = 'force-dynamic';

const query = z.object({ batchId: z.uuid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

/** GET /academic/api/v1/attendance-register?batchId&month=YYYY-MM — one batch's month of class attendance as CSV (teacher scope as the attendance report). Audited. */
export const GET = defineRoute({ permission: 'academic:attendance:read', query }, async (ctx) => {
  const { filename, csv } = await attendanceRegisterCsv(ctx.db, actorOf(ctx), ctx.query.batchId, ctx.query.month);
  return csvResponse(csv, filename);
});
