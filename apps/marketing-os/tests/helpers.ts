/** Shared fixtures for Marketing OS integration tests (fictional users, unique titles). */
import type { Database } from '@elevate/database';
import { authedRequest, callRoute, createTestUser, type TestUser } from '@elevate/testing';
import { importLegacyAccounts, importLegacyRules, seedPolicySettings } from '../src/server';
import { loadLegacyMarketingData } from '../src/server/legacy/load';

export const legacy = loadLegacyMarketingData();

let seeded = new WeakSet<object>();

/** Policy settings, brand rules and the account registry (what most tests need). */
export async function seedRegistry(db: Database): Promise<void> {
  if (seeded.has(db)) return;
  await seedPolicySettings(db);
  await importLegacyRules(db, legacy.rules);
  await importLegacyAccounts(db, legacy.accounts, legacy.rules);
  seeded.add(db);
}

export function resetSeedMemo() {
  seeded = new WeakSet<object>();
}

export interface Team {
  manager: TestUser;
  manager2: TestUser;
  contributor: TestUser;
  director: TestUser;
  auditor: TestUser;
  teacher: TestUser;
}

export async function makeTeam(db: Database): Promise<Team> {
  return {
    manager: await createTestUser(db, { roles: ['marketing_manager'] }),
    manager2: await createTestUser(db, { roles: ['marketing_manager'] }),
    contributor: await createTestUser(db, { roles: ['marketing_contributor'] }),
    director: await createTestUser(db, { roles: ['director'] }),
    auditor: await createTestUser(db, { roles: ['auditor'] }),
    teacher: await createTestUser(db, { roles: ['teacher'] }),
  };
}

let n = 0;
export function uniqueTitle(base = 'Fictional test idea'): string {
  n += 1;
  return `${base} ${Date.now().toString(36)} number ${n} zq${n}x`;
}

type Handler = Parameters<typeof callRoute>[0];

export async function call<T = unknown>(
  handler: Handler,
  user: TestUser | null,
  path: string,
  options: {
    method?: string;
    json?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
) {
  const req = user
    ? authedRequest(user, path, {
        method: options.method,
        json: options.json,
        headers: options.headers,
      })
    : new Request(new URL(path, 'http://localhost:3000'), {
        method: options.method ?? (options.json ? 'POST' : 'GET'),
        headers: options.json ? { 'content-type': 'application/json' } : undefined,
        body: options.json ? JSON.stringify(options.json) : undefined,
      });
  return callRoute<T>(handler, req, options.params ?? {});
}

/** Acknowledge every checklist item of the current rule check. */
export function allChecklistCodes(
  check: { checklist: { ruleCode: string }[] } | null | undefined,
): string[] {
  return [...new Set((check?.checklist ?? []).map((c) => c.ruleCode))];
}
