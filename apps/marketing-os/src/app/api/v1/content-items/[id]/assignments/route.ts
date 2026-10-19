import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { assignmentBody, setAssignment } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** PUT — set (or clear, with no assignee) the writer/designer/editor/presenter. */
export const PUT = defineRoute(
  { permission: 'marketing:content:write', params: idParams, body: assignmentBody },
  async ({ db, params, body, user, requestId }) =>
    setAssignment(db, user, params.id, body, requestId),
);
