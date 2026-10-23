import { created, defineRoute, respond } from '@elevate/server-kit';
import { uploadAttachment, uploadAttachmentBody } from '../../../../server/attachments';

export const dynamic = 'force-dynamic';

/**
 * POST <base>/api/v1/attachments — upload one file (JSON, base64) to a record the caller may
 * change. 201 { id }; the same file again on the same record → 200 { id, duplicate: true }.
 * Access is decided per record kind in server/attachments.ts, not by one route permission.
 */
export const POST = defineRoute(
  // 8 MB as base64 is about 11.2 MB of JSON.
  {
    permission: 'authenticated',
    module: 'ops',
    body: uploadAttachmentBody,
    maxBodyBytes: 12 * 1024 * 1024,
  },
  async ({ db, user, body, requestId }) => {
    const out = await uploadAttachment(db, user, body, requestId);
    return out.duplicate ? respond(out) : created(out);
  },
);
