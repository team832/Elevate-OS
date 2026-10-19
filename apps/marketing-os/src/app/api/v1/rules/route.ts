import { defineRoute } from '@elevate/server-kit';
import { listContentRules } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/rules — brand rules (BR-MKT-3) with status and source. */
export const GET = defineRoute({ permission: 'marketing:content:read' }, async ({ db }) =>
  listContentRules(db),
);
