import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { isoDateSchema } from '@elevate/shared-contracts';
import { idParams } from '../../../../../../server/schemas';
import { generateTeacherReport, listTeacherReports } from '../../../../../../server/teacher-report';

export const dynamic = 'force-dynamic';

const periodBody = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    comment: z.string().trim().max(2000).nullish(),
  })
  .strict()
  .refine((b) => b.from <= b.to, { error: 'The start must be on or before the end', path: ['to'] });

/** POST /ops/api/v1/teachers/[id]/report — Internal teacher report for a period (stored snapshot, TR- reference, audit). */
export const POST = defineRoute(
  { permission: 'ops:teacher_reports:generate', params: idParams, body: periodBody },
  async ({ user, db, params, body, requestId }) =>
    created(await generateTeacherReport(db, user, params.id, body, requestId)),
);

/** GET /ops/api/v1/teachers/[id]/report — Stored reports of the teacher, newest first. */
export const GET = defineRoute(
  { permission: 'ops:teacher_reports:generate', params: idParams },
  ({ user, db, params }) => listTeacherReports(db, user, params.id),
);
