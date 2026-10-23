import { defineRoute } from '@elevate/server-kit';
import { contentDisposition } from '../../../../../domain/attachments';
import { attachmentDownload, deleteAttachment } from '../../../../../server/attachments';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET <base>/api/v1/attachments/:id — the file, if the caller may read its record (else 404). */
export const GET = defineRoute(
  { permission: 'authenticated', module: 'ops', params: idParams },
  async ({ db, user, params }) => {
    const { row, bytes } = await attachmentDownload(db, user, params.id);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        'content-type': row.mime,
        'content-length': String(bytes.length),
        'content-disposition': contentDisposition(row.originalName),
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    });
  },
);

/** DELETE <base>/api/v1/attachments/:id — hide the file (uploader or record manager). Audited. */
export const DELETE = defineRoute(
  { permission: 'authenticated', module: 'ops', params: idParams },
  async ({ db, user, params, requestId }) => deleteAttachment(db, user, params.id, requestId),
);
