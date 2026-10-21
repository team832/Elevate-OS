import { defineRoute } from '@elevate/server-kit';
import { idCardDocument } from '../../../../../../server/applications-confirm';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/admissions/[id]/id-card — ID card PDF (card size: name, admission number, programme, academic year; no guardian data, no QR). */
export const GET = defineRoute(
  { permission: 'ops:admissions:read', params: idParams },
  async ({ user, db, params }) => idCardDocument(db, user, params.id),
);
