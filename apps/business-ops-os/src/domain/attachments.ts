/**
 * Uploaded-file rules (R6), shared by the server and the upload control: the allowed types by
 * file extension, a magic-byte check so a renamed program is refused, the 8 MB limit, a safe
 * display name and the download header. Pure: no I/O.
 */

/** Same value as OPS_ATTACHMENT_MAX_BYTES in the schema (a test keeps them equal). */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

const ZIP = [[0x50, 0x4b, 0x03, 0x04]];
/** null in a signature = any byte. `text` types have no signature but may not contain NUL bytes. */
type Signature = readonly (number | null)[];
const TYPES: Record<string, { mime: string; magic: readonly Signature[] | 'text' }> = {
  pdf: { mime: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]] },
  png: { mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  jpg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  webp: {
    mime: 'image/webp',
    magic: [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]],
  },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: ZIP,
  },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: ZIP },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    magic: ZIP,
  },
  zip: { mime: 'application/zip', magic: ZIP },
  csv: { mime: 'text/csv', magic: 'text' },
  txt: { mime: 'text/plain', magic: 'text' },
};

/** For `<input accept>`. */
export const ATTACHMENT_ACCEPT = Object.keys(TYPES)
  .map((e) => `.${e}`)
  .join(',');
export const ATTACHMENT_LIMITS_TEXT =
  'PDF, PNG, JPG, WebP, Word, Excel, PowerPoint, CSV, text or ZIP, up to 8 MB.';

const extension = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/** The stored type of a file name, or null when the type is not allowed. */
export const attachmentMime = (name: string): string | null => TYPES[extension(name)]?.mime ?? null;

/** Why the file cannot be stored, or null when it can. */
export function attachmentProblem(name: string, mime: string, bytes: Uint8Array): string | null {
  const type = TYPES[extension(name)];
  if (!type) return `This type of file cannot be uploaded. Allowed: ${ATTACHMENT_LIMITS_TEXT}`;
  if (mime !== type.mime) return 'The file type does not match the file name.';
  if (bytes.length === 0) return 'The file is empty.';
  if (bytes.length > ATTACHMENT_MAX_BYTES) return 'The file is larger than 8 MB.';
  const ok =
    type.magic === 'text'
      ? !bytes.includes(0)
      : type.magic.some((sig) => sig.every((b, i) => b === null || bytes[i] === b));
  return ok ? null : `The file's contents are not a real .${extension(name)} file.`;
}

/** A display name without folders, control or reserved characters; at most 255 characters. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const name = base
    // eslint-disable-next-line no-control-regex -- removing control characters is the point
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = name.replace(/^\.+/, '') || 'file';
  if (safe.length <= 255) return safe;
  const ext = extension(safe);
  return ext ? `${safe.slice(0, 254 - ext.length)}.${ext}` : safe.slice(0, 255);
}

/** `attachment` with an ASCII fallback and the exact UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
