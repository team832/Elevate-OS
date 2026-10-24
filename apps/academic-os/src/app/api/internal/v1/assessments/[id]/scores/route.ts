import { recordScoresBody } from '@elevate/shared-contracts';
import { recordScores } from '../../../../../../../server/services/assessment-ops';
import { opsWrite } from '../../_write';

export const dynamic = 'force-dynamic';

/** POST /academic/api/internal/v1/assessments/{id}/scores — attendance and marks on the roster (all rows or none; stale → 409). */
export const POST = opsWrite({ body: recordScoresBody }, (db, actor, p, body) =>
  recordScores(db, actor, p.id, body),
);
