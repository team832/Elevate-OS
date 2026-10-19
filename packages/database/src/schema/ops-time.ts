/**
 * OWNER: Business Ops OS team.
 *
 * Staff attendance, shifts, work calendars, holidays and leave (OPS-050…, D-028). Separate from Academic OS class attendance, which Ops never stores.
 *
 * Rules: same as ops.ts — `ops.table(...)` (import `ops` from './ops'), exports
 * prefixed `ops`, UUID PKs, human codes in separate unique columns, FKs only
 * into `ops` or `core`, column helpers from './ops-columns', only
 * `import type` from workspace packages, no `drizzle-kit generate`.
 */
export {};
