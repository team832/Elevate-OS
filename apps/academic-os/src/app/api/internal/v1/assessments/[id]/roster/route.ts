import { rosterSnapshotBody } from '@elevate/shared-contracts';
import { snapshotRosterInternal } from '../../../../../../../server/services/assessment-ops';
import { opsWrite } from '../../_write';

export const dynamic = 'force-dynamic';

/** POST /academic/api/internal/v1/assessments/{id}/roster — snapshot the selected batches' active enrolments on the scheduled date (once). */
export const POST = opsWrite({ body: rosterSnapshotBody }, (db, actor, p, body) =>
  snapshotRosterInternal(db, actor, p.id, body),
);
