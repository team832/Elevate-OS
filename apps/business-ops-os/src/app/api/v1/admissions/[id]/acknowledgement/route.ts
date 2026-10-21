import { defineRoute } from '@elevate/server-kit';
import { acknowledgementDocument } from '../../../../../../server/applications-confirm';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/admissions/[id]/acknowledgement — Admission acknowledgement PDF (final number, signed version kept on record); 409 before confirmation. */
export const GET = defineRoute(
  { permission: 'ops:admissions:read', params: idParams },
  async ({ user, db, params }) => acknowledgementDocument(db, user, params.id),
);
