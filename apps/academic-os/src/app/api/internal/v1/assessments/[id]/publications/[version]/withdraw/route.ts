import { z } from 'zod';
import { withdrawPublicationBody } from '@elevate/shared-contracts';
import { withdrawInternal } from '../../../../../../../../../server/services/assessment-ops';
import { opsWrite } from '../../../../_write';

export const dynamic = 'force-dynamic';

/** POST /academic/api/internal/v1/assessments/{id}/publications/{version}/withdraw — withdraw the current publication, with a reason. */
export const POST = opsWrite(
  {
    body: withdrawPublicationBody,
    params: z.object({ id: z.uuid(), version: z.coerce.number().int().min(1) }),
  },
  (db, actor, p, body) => withdrawInternal(db, actor, p.id, p.version, body.reason),
);
