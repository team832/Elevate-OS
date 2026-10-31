import { z } from 'zod';
import { inBase } from '@elevate/authorization';
import { defineRoute, requestWorkspace } from '@elevate/server-kit';
import { MODULES } from '@elevate/shared-types';
import { openNotification } from '../../../../server/notification-open';
import { linkUrl } from '../../../../server/task-links';

export const dynamic = 'force-dynamic';

/**
 * GET <base>/notifications/{id}/open — marks your notification read, re-checks access to where it
 * points, then redirects there (303). Refused (gone, no access, off-site link): back to
 * <base>/notifications?open=<reason>, which says so in words instead of a 403 page.
 * Shared by every workspace (D-073; hosts re-export it from `@elevate/business-ops-os/work`).
 */
export const GET = defineRoute(
  { permission: 'platform:notifications:read', params: z.object({ id: z.uuid() }) },
  async ({ request, user, db, params }) => {
    const base = MODULES[requestWorkspace(request) ?? 'platform'].basePath;
    const r = await openNotification(db, user, params.id);
    const to =
      'href' in r
        ? inBase(r.href, base)
          ? r.href
          : linkUrl(r.href)
        : `${base}/notifications?open=${r.refused}`;
    return new Response(null, { status: 303, headers: { Location: to } });
  },
);
