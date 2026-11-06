/**
 * Where uploaded files are kept (R6). In production, the owner's office mode included: in the
 * database, table ops.attachment_files (D-135, free). Outside production: a local folder
 * (ATTACHMENTS_DIR, default `<repo>/.data/attachments`, git-ignored), so files made while
 * developing stay readable. Keys are random UUIDs made by the server, never the user's file name.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { findRepoRoot } from '@elevate/configuration/node';
import { opsAttachmentFiles, type Database } from '@elevate/database';

export interface AttachmentStorage {
  readonly name: string;
  /** Fails when the key is already used. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Fails when nothing is stored under the key. */
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

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

/** A duplicate key breaks the primary key, as `wx` refuses an existing file. */
function database(db: Database): AttachmentStorage {
  const byKey = (key: string) => eq(opsAttachmentFiles.key, key);
  return {
    name: 'Database',
    async put(key, bytes) {
      await db.insert(opsAttachmentFiles).values({ key, bytes, sizeBytes: bytes.length });
    },
    async get(key) {
      const [row] = await db
        .select({ bytes: opsAttachmentFiles.bytes })
        .from(opsAttachmentFiles)
        .where(byKey(key))
        .limit(1);
      if (!row) throw new Error('No attachment stored under this key');
      return row.bytes;
    },
    async delete(key) {
      await db.delete(opsAttachmentFiles).where(byKey(key));
    },
  };
}

export function attachmentStorage(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
): AttachmentStorage {
  if (env.NODE_ENV === 'production') return database(db);
  const root = findRepoRoot();
  const dir = env.ATTACHMENTS_DIR || (root && path.join(root, '.data', 'attachments'));
  return dir ? localDisk(dir) : database(db);
}
