import { defineRoute } from '@elevate/server-kit';
import { csvMappingBody, suggestCsvMapping } from '../../../../../server/ai-drafts';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/ai/csv-mapping — suggested column matching from headings and value shapes; the service checks the import permission of `kind`. */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:teacher_feedback:import', 'ops:attendance:manage'] },
    body: csvMappingBody,
    maxBodyBytes: 65_536,
  },
  async ({ user, db, body, requestId }) => ({
    items: await suggestCsvMapping(db, user, body, requestId),
  }),
);
