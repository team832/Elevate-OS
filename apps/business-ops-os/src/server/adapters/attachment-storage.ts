/**
 * Where uploaded files are kept (R6, D-014). Outside production: a local folder (ATTACHMENTS_DIR,
 * default `<repo>/.data/attachments`, git-ignored). In production: not configured until the
 * owner picks a storage provider, so uploads and downloads are refused instead of pretending.
 * Keys are random UUIDs made by the server, never the user's file name.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRepoRoot } from '@elevate/configuration/node';

export interface AttachmentStorage {
  readonly name: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export const STORAGE_NOT_SET_UP =
  'File storage is not set up yet, so files cannot be uploaded or downloaded. Ask the administrator to choose where files are kept.';

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function localDisk(dir: string): AttachmentStorage {
  const file = (key: string) => {
    if (!KEY.test(key)) throw new Error('Invalid attachment storage key');
    return path.join(dir, key);
  };
  return {
    name: 'Local folder (development)',
    async put(key, bytes) {
      await mkdir(dir, { recursive: true });
      await writeFile(file(key), bytes, { flag: 'wx' });
    },
    get: async (key) => readFile(file(key)),
    delete: (key) => rm(file(key), { force: true }),
  };
}

/** The storage in use, or null when none is configured. */
export function attachmentStorage(env: NodeJS.ProcessEnv = process.env): AttachmentStorage | null {
  if (env.NODE_ENV === 'production') return null;
  const root = findRepoRoot();
  const dir = env.ATTACHMENTS_DIR || (root && path.join(root, '.data', 'attachments'));
  return dir ? localDisk(dir) : null;
}
