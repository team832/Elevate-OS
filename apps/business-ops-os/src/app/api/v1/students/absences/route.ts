import { created, csvResponse, defineRoute } from '@elevate/server-kit';
import {
  absenceCallBody,
  absencesCsv,
  absencesQuery,
  logAbsenceCall,
} from '../../../../../server/absences';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/students/absences?from&to — Absent students as a spreadsheet (CSV), your scope. Audited. */
export const GET = defineRoute(
  { permission: 'ops:student_private:read', query: absencesQuery },
  async ({ user, db, query }) => {
    const out = await absencesCsv(db, user, query);
    return csvResponse(out.csv, out.filename);
  },
);

/** POST /ops/api/v1/students/absences — Log a follow-up call about absences (outcome + note). Audited. */
export const POST = defineRoute(
  { permission: 'ops:guardians:write', body: absenceCallBody },
  async ({ user, db, body, requestId }) => created(await logAbsenceCall(db, user, body, requestId)),
);
