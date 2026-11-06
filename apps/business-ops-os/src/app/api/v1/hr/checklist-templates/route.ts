import { created, defineRoute } from '@elevate/server-kit';
import {
  checklistTemplateBody,
  publishChecklistTemplate,
} from '../../../../../server/hr-staff-records';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/checklist-templates — publish the next joining or leaving template version (F4-09). */
export const POST = defineRoute(
  { permission: 'ops:hr_settings:manage', body: checklistTemplateBody },
  async ({ user, db, body, requestId }) =>
    created(await publishChecklistTemplate(db, user, body, requestId)),
);
