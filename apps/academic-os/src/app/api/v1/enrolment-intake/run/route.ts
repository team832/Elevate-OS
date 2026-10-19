import { defineRoute } from '@elevate/server-kit';
import { runEnrolmentIntake } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/enrolment-intake/run — Run the academic.enrolment-intake consumer now (no scheduler yet). */
export const POST = defineRoute({ permission: 'academic:enrolments:decide' }, async (ctx) => runEnrolmentIntake(ctx.db, { triggeredByUserId: ctx.user.id }));
