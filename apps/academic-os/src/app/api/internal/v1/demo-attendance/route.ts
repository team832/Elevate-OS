import { defineInternalRoute } from '@elevate/server-kit';
import { demoAttendanceQuery } from '../../../../../server/schemas-sessions';
import { demoAttendanceFeed } from '../../../../../server';

export const dynamic = 'force-dynamic';

/**
 * GET /academic/api/internal/v1/demo-attendance?ids=<ops demo session ids> — AcademicDemoAttendanceV1
 * for Business Ops (caller ops): teacher-recorded demo marks and the actual teachers once delivered.
 */
export const GET = defineInternalRoute({ callers: ['ops'], query: demoAttendanceQuery }, async ({ db, query }) => demoAttendanceFeed(db, query.ids));
