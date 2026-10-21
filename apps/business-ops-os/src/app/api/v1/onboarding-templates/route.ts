import { created, defineRoute } from '@elevate/server-kit';
import { listTemplates, publishTemplateVersion } from '../../../../server/onboarding';
import { templateBody } from '../../../../server/profile-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/onboarding-templates — Onboarding checklist templates, every version (newest first per code). */
export const GET = defineRoute({ permission: 'ops:settings:read' }, async ({ user, db }) =>
  listTemplates(db, user),
);

/** POST /ops/api/v1/onboarding-templates — Publish the next version of a template (earlier version retired; existing checklists unchanged). */
export const POST = defineRoute(
  { permission: 'ops:settings:manage', body: templateBody },
  async ({ user, db, body, requestId }) =>
    created(await publishTemplateVersion(db, user, body, requestId)),
);
