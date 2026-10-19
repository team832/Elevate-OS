import { z } from 'zod';

/**
 * Every environment variable Elevate OS reads, with its validation rule and a
 * human explanation used in error messages. Apps load only the subset they
 * need (see `ENV_SUBSETS`), so a module app does not demand the platform's
 * rewrite URLs and a test run does not demand the seed password.
 */
const secret = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(32, { error: `${name} must be at least 32 characters` })
    .refine((v) => !/^replace-with/i.test(v), {
      error: `${name} still holds the placeholder from .env.example`,
    });

const url = (name: string) =>
  z
    .url({ error: `${name} must be an absolute http(s) URL` })
    .refine((v) => /^https?:\/\//.test(v), {
      error: `${name} must start with http:// or https://`,
    });

export const ENV_FIELDS = {
  NODE_ENV: {
    schema: z.enum(['development', 'test', 'production']).default('development'),
    description: 'Runtime mode. Next.js sets it; production enables the Secure cookie flag.',
  },
  DATABASE_URL: {
    schema: z
      .string({ error: 'DATABASE_URL is required' })
      .min(1, { error: 'DATABASE_URL is required' })
      .refine((v) => /^(postgres(ql)?:\/\/|pglite:\/\/)/.test(v), {
        error: 'DATABASE_URL must start with postgres://, postgresql:// or pglite://',
      }),
    description:
      'Database connection: postgres://… (node-postgres) or pglite://memory | pglite://<dir>.',
  },
  SESSION_SECRET: {
    schema: secret('SESSION_SECRET'),
    description: 'HMAC key for session tokens (>= 32 chars). Changing it signs everyone out.',
  },
  INTERNAL_SERVICE_TOKEN: {
    schema: secret('INTERNAL_SERVICE_TOKEN'),
    description:
      'Bearer token for /api/internal/* server-to-server routes (>= 32 chars, same in every app).',
  },
  PLATFORM_URL: {
    schema: url('PLATFORM_URL').default('http://localhost:3000'),
    description:
      'Browser-facing origin of the platform app; module apps accept Server Actions from it.',
  },
  MARKETING_OS_URL: {
    schema: url('MARKETING_OS_URL'),
    description: 'Origin of the Marketing OS app, e.g. http://localhost:3001 (platform rewrites).',
  },
  ACADEMIC_OS_URL: {
    schema: url('ACADEMIC_OS_URL'),
    description: 'Origin of the Academic OS app, e.g. http://localhost:3002 (platform rewrites).',
  },
  BUSINESS_OPS_OS_URL: {
    schema: url('BUSINESS_OPS_OS_URL'),
    description:
      'Origin of the Business Ops OS app, e.g. http://localhost:3003 (platform rewrites).',
  },
  SEED_USER_PASSWORD: {
    schema: z
      .string({ error: 'SEED_USER_PASSWORD is required' })
      .min(12, { error: 'SEED_USER_PASSWORD must be at least 12 characters' })
      .refine((v) => !/^replace-with/i.test(v), {
        error: 'SEED_USER_PASSWORD still holds the placeholder from .env.example',
      }),
    description: 'Password for the fictional seed users (development only).',
  },
  MARKETING_PUBLISHING_ADAPTER: {
    schema: z.enum(['mock', 'disabled']).default('mock'),
    description: 'Publishing adapter for Marketing OS. Only mock/disabled exist (D-014).',
  },
  MARKETING_METRICS_ADAPTER: {
    schema: z.enum(['mock', 'disabled']).default('mock'),
    description: 'Metrics import adapter for Marketing OS. Only mock/disabled exist (D-014).',
  },
  NOTIFICATIONS_EMAIL_ADAPTER: {
    schema: z.enum(['mock', 'disabled']).default('mock'),
    description: 'Email channel adapter. mock only logs and never claims delivery.',
  },
  LOG_LEVEL: {
    schema: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    description: 'Minimum structured-log level.',
  },
} as const;

export type EnvKey = keyof typeof ENV_FIELDS;
type FieldSchema<K extends EnvKey> = (typeof ENV_FIELDS)[K]['schema'];
export type EnvOf<K extends EnvKey> = { [P in K]: z.output<FieldSchema<P>> };

const SERVER_BASE = [
  'NODE_ENV',
  'DATABASE_URL',
  'SESSION_SECRET',
  'INTERNAL_SERVICE_TOKEN',
  'LOG_LEVEL',
] as const;

/** Which variables each runtime needs. */
export const ENV_SUBSETS = {
  platform: [
    ...SERVER_BASE,
    'MARKETING_OS_URL',
    'ACADEMIC_OS_URL',
    'BUSINESS_OPS_OS_URL',
    'NOTIFICATIONS_EMAIL_ADAPTER',
  ],
  marketing: [
    ...SERVER_BASE,
    'PLATFORM_URL',
    'MARKETING_PUBLISHING_ADAPTER',
    'MARKETING_METRICS_ADAPTER',
    'NOTIFICATIONS_EMAIL_ADAPTER',
  ],
  academic: [...SERVER_BASE, 'PLATFORM_URL', 'NOTIFICATIONS_EMAIL_ADAPTER'],
  ops: [...SERVER_BASE, 'PLATFORM_URL', 'NOTIFICATIONS_EMAIL_ADAPTER'],
  /** Shared runtime needs of every server package (auth, server-kit). */
  server: SERVER_BASE,
  database: ['NODE_ENV', 'DATABASE_URL'],
  seed: ['NODE_ENV', 'DATABASE_URL', 'SEED_USER_PASSWORD'],
} as const satisfies Record<string, readonly EnvKey[]>;

export type EnvSubset = keyof typeof ENV_SUBSETS;
export type EnvFor<S extends EnvSubset> = EnvOf<(typeof ENV_SUBSETS)[S][number]>;

export class ConfigurationError extends Error {
  readonly problems: readonly { key: string; message: string; description: string }[];
  constructor(
    label: string,
    problems: readonly { key: string; message: string; description: string }[],
  ) {
    const lines = problems.map((p) => `  - ${p.key}: ${p.message}\n      (${p.description})`);
    super(
      `Invalid environment configuration for "${label}" — ${problems.length} problem(s):\n${lines.join('\n')}\n` +
        'Copy .env.example to .env in the repository root and fill in the values.',
    );
    this.name = 'ConfigurationError';
    this.problems = problems;
  }
}

/** Validate an explicit list of keys. Throws `ConfigurationError` listing every problem. */
export function loadEnvKeys<const K extends EnvKey>(
  keys: readonly K[],
  env: Record<string, string | undefined> = process.env,
  label = keys.join(','),
): EnvOf<K> {
  const out: Record<string, unknown> = {};
  const problems: { key: string; message: string; description: string }[] = [];
  for (const key of keys) {
    const field = ENV_FIELDS[key];
    const raw = env[key];
    const value = raw === '' ? undefined : raw;
    const parsed = (field.schema as z.ZodType).safeParse(value);
    if (parsed.success) {
      out[key] = parsed.data;
    } else {
      const message =
        value === undefined ? 'missing' : (parsed.error.issues[0]?.message ?? 'invalid value');
      problems.push({ key, message, description: field.description });
    }
  }
  if (problems.length > 0) throw new ConfigurationError(label, problems);
  return out as EnvOf<K>;
}

/** Validate the variables a named runtime needs (e.g. `loadEnv('marketing')`). */
export function loadEnv<S extends EnvSubset>(
  subset: S,
  env: Record<string, string | undefined> = process.env,
): EnvFor<S> {
  return loadEnvKeys(ENV_SUBSETS[subset] as readonly EnvKey[], env, subset) as EnvFor<S>;
}

/** True when `DATABASE_URL` points at this machine or an in-process PGlite. */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  if (databaseUrl.startsWith('pglite://')) return true;
  try {
    const host = new URL(databaseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}
