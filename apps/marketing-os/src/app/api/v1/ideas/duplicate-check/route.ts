import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { COURSE_PREFIXES } from '../../../../../domain';
import { checkIdeaDuplicates } from '../../../../../server';

export const dynamic = 'force-dynamic';

const body = z
  .object({
    title: z.string().trim().min(1).max(300),
    coursePrefix: z.enum(COURSE_PREFIXES),
    excludeId: z.uuid().optional(),
  })
  .strict();

/** POST /marketing/api/v1/ideas/duplicate-check — candidates + decision (block | warn | clear); writes nothing. */
export const POST = defineRoute(
  { permission: 'marketing:ideas:read', body },
  async ({ db, body }) => checkIdeaDuplicates(db, body),
);
