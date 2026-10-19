import { sql } from 'drizzle-orm';
import { getDb, type Database } from '@elevate/database';
import { successResponse } from '@elevate/shared-contracts';
import type { ModuleKey } from '@elevate/shared-types';

/**
 * GET health handler: 200 when the database answers `SELECT 1` within the
 * timeout, 503 otherwise. Never exposes connection strings or error text.
 */
export function createHealthHandler(options: {
  app: string;
  module: ModuleKey;
  getDb?: () => Database;
  timeoutMs?: number;
}) {
  return async function health(): Promise<Response> {
    let database: 'ok' | 'unavailable';
    try {
      const db = (options.getDb ?? getDb)();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), options.timeoutMs ?? 3000),
      );
      await Promise.race([db.execute(sql`SELECT 1`), timeout]);
      database = 'ok';
    } catch {
      database = 'unavailable';
    }
    const status = database === 'ok' ? 'ok' : 'degraded';
    return successResponse(
      {
        status,
        app: options.app,
        module: options.module,
        time: new Date().toISOString(),
        checks: { database },
      },
      { status: status === 'ok' ? 200 : 503 },
    );
  };
}
