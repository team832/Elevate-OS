import { defineRoute } from '@elevate/server-kit';
import { z } from 'zod';
import { summariseStudent } from '../../../../../server/ai-report-drafts';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/ai/student-summary — AI summary of a student from linked records the reader may see (never saved; D-111). */
export const POST = defineRoute(
  { permission: 'ops:students:read', body: z.object({ studentId: z.uuid() }), maxBodyBytes: 4096 },
  async ({ user, db, body, requestId }) => ({
    items: await summariseStudent(db, user, body.studentId, requestId),
  }),
);
