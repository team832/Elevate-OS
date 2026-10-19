import { defineRoute } from '@elevate/server-kit';
import { listConceptBooks } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/concept-books — Concept-book indices (planned question counts only). */
export const GET = defineRoute({ permission: 'academic:courses:read' }, async (ctx) => listConceptBooks(ctx.db));
