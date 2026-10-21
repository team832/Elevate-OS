import { created, defineRoute } from '@elevate/server-kit';
import { convertDemo, previewConversion } from '../../../../../../server/conversion';
import { idParams } from '../../../../../../server/schemas';
import { convertBody } from '../../../../../../server/students-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/demos/[id]/convert — What the Convert-to-admission wizard shows (identity matches, checklist, number preview); writes nothing. */
export const GET = defineRoute(
  { permission: 'ops:admissions:convert', params: idParams },
  async ({ user, db, params }) => previewConversion(db, user, params.id),
);

/** POST /ops/api/v1/demos/[id]/convert — Convert the demo to an admission in one transaction (Idempotency-Key honoured; a second conversion is 409). */
export const POST = defineRoute(
  {
    permission: 'ops:admissions:convert',
    params: idParams,
    body: convertBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    created(await convertDemo(db, user, params.id, body, requestId)),
);
