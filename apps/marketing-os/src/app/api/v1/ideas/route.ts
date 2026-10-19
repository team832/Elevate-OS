import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { COURSE_PREFIXES, IDEA_STATUSES } from '../../../../domain';
import { createIdea, createIdeaBody, listIdeas } from '../../../../server';

export const dynamic = 'force-dynamic';

const query = z.object({
  q: z.string().trim().max(100).optional(),
  course: z.enum(COURSE_PREFIXES).optional(),
  status: z.enum(IDEA_STATUSES).optional(),
  quarantined: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** GET /marketing/api/v1/ideas */
export const GET = defineRoute(
  { permission: 'marketing:ideas:read', query },
  async ({ db, query }) => {
    const rows = await listIdeas(db, {
      q: query.q,
      coursePrefix: query.course,
      status: query.status,
      quarantined: query.quarantined === undefined ? undefined : query.quarantined === 'true',
      limit: query.limit,
    });
    return rows;
  },
);

/** POST /marketing/api/v1/ideas — 201 { idea, duplicates }; 409 on an exact same-course duplicate. */
export const POST = defineRoute(
  { permission: 'marketing:ideas:write', body: createIdeaBody, idempotency: 'optional' },
  async ({ db, body, user, requestId }) => created(await createIdea(db, user, body, { requestId })),
);
