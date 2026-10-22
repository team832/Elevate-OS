import { describe, expect, it } from 'vitest';
import { ConfigurationError, isLocalDatabaseUrl, loadEnv, loadEnvKeys } from '../src/index';

const good = {
  DATABASE_URL: 'pglite://memory',
  SESSION_SECRET: 'x'.repeat(40),
  INTERNAL_SERVICE_TOKEN: 'y'.repeat(40),
  MARKETING_OS_URL: 'http://localhost:3001',
  ACADEMIC_OS_URL: 'http://localhost:3002',
  BUSINESS_OPS_OS_URL: 'http://localhost:3003',
};

describe('loadEnv', () => {
  it('returns typed values and applies defaults', () => {
    const env = loadEnv('platform', good);
    expect(env.DATABASE_URL).toBe('pglite://memory');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NODE_ENV).toBe('development');
    expect(env.NOTIFICATIONS_EMAIL_ADAPTER).toBe('mock');
  });

  it('lists every missing variable in one clear error', () => {
    let caught: unknown;
    try {
      loadEnv('platform', { DATABASE_URL: 'pglite://memory' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationError);
    const error = caught as ConfigurationError;
    const keys = error.problems.map((p) => p.key).sort();
    // Workspace URLs default to the local ports (D-072), so only the secrets are missing.
    expect(keys).toEqual(['INTERNAL_SERVICE_TOKEN', 'SESSION_SECRET']);
    expect(error.message).toContain('SESSION_SECRET: missing');
    expect(error.message).toContain('.env.example');
  });

  it('rejects short secrets, placeholders and bad URLs', () => {
    expect(() => loadEnv('server', { ...good, SESSION_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() =>
      loadEnv('server', { ...good, SESSION_SECRET: 'replace-with-at-least-32-random-characters' }),
    ).toThrow(/placeholder/);
    expect(() => loadEnv('server', { ...good, DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
    expect(() => loadEnv('platform', { ...good, MARKETING_OS_URL: 'localhost:3001' })).toThrow(
      /MARKETING_OS_URL/,
    );
  });

  it('module subsets do not demand the platform rewrite URLs', () => {
    const { MARKETING_OS_URL: _m, ACADEMIC_OS_URL: _a, BUSINESS_OPS_OS_URL: _b, ...rest } = good;
    expect(loadEnv('academic', rest).DATABASE_URL).toBe('pglite://memory');
  });

  it('treats empty strings as missing', () => {
    expect(() => loadEnvKeys(['DATABASE_URL'], { DATABASE_URL: '' })).toThrow(
      /DATABASE_URL: missing/,
    );
  });
});

describe('isLocalDatabaseUrl', () => {
  it('accepts localhost and PGlite, rejects remote hosts', () => {
    expect(isLocalDatabaseUrl('postgres://u:p@127.0.0.1:54320/elevate')).toBe(true);
    expect(isLocalDatabaseUrl('postgres://u:p@localhost/elevate')).toBe(true);
    expect(isLocalDatabaseUrl('pglite://memory')).toBe(true);
    expect(isLocalDatabaseUrl('postgres://u:p@db.example.com/elevate')).toBe(false);
  });
});

describe('BOOTSTRAP_OWNER_EMAILS', () => {
  const owners = (value?: string) =>
    loadEnvKeys(['BOOTSTRAP_OWNER_EMAILS'], { BOOTSTRAP_OWNER_EMAILS: value })
      .BOOTSTRAP_OWNER_EMAILS;

  it('is optional and parses a comma-separated, lower-cased list', () => {
    expect(owners()).toEqual([]);
    expect(owners('')).toEqual([]);
    expect(owners(' Owner@ElevateEducation.in , second@elevateeducation.in,')).toEqual([
      'owner@elevateeducation.in',
      'second@elevateeducation.in',
    ]);
  });

  it.each([
    'someone@gmail.com',
    'tara@example.test',
    'a@sub.elevateeducation.in',
    'a@elevateeducation.in.evil.com',
    '@elevateeducation.in',
    'owner@elevateeducation.in, someone@gmail.com',
  ])('refuses %s', (value) => {
    expect(() => owners(value)).toThrow(
      /BOOTSTRAP_OWNER_EMAILS may list only @elevateeducation.in/,
    );
  });
});
