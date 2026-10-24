import { finaliseResultsBody } from '@elevate/shared-contracts';
import { finaliseAssessment } from '../../../../../../../server/services/results';
import { opsWrite } from '../../_write';

export const dynamic = 'force-dynamic';

/** POST /academic/api/internal/v1/assessments/{id}/finalise — mirror the roster into attempts and write result version 1. */
export const POST = opsWrite({ body: finaliseResultsBody }, (db, actor, p) =>
  finaliseAssessment(db, actor, p.id),
);
