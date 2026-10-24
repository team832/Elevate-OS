import { rosterCorrectionBody } from '@elevate/shared-contracts';
import { correctRosterInternal } from '../../../../../../../../server/services/assessment-ops';
import { opsWrite } from '../../../_write';

export const dynamic = 'force-dynamic';

/** POST /academic/api/internal/v1/assessments/{id}/roster/corrections — add / remove / restore a student, with a reason. */
export const POST = opsWrite({ body: rosterCorrectionBody }, (db, actor, p, body) =>
  correctRosterInternal(db, actor, p.id, body),
);
