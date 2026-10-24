import { publishResultsBody } from '@elevate/shared-contracts';
import { publishInternal } from '../../../../../../../server/services/assessment-ops';
import { opsWrite } from '../../_write';

export const dynamic = 'force-dynamic';

/** POST /academic/api/internal/v1/assessments/{id}/publications — publish version current + 1 (roster or cohort ranking; completeness gate). */
export const POST = opsWrite({ body: publishResultsBody }, (db, actor, p, body) =>
  publishInternal(db, actor, p.id, body),
);
