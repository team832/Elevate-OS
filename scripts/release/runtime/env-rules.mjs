/**
 * Every setting the package reads (release-spec §2): the source of .env.production.example and of
 * preflight's checks. A check returns a plain problem, or null when the value is fine.
 */
const PLACEHOLDER = /replace|change.?me|placeholder|example|^(.)\1+$/i;
const MODULES = ['ops', 'academic', 'marketing', 'platform'];

const secret = (value) =>
  value.length < 32
    ? 'must be at least 32 characters'
    : PLACEHOLDER.test(value)
      ? 'still looks like a placeholder'
      : null;
const database = (value) =>
  /^postgres(ql)?:\/\//.test(value) ? null : 'must start with postgres://';
const moduleTokens = (value) =>
  value.split(',').every((entry) => {
    const at = entry.indexOf(':');
    return MODULES.includes(entry.slice(0, at).trim()) && !secret(entry.slice(at + 1).trim());
  })
    ? null
    : `must be <module>:<token> pairs (${MODULES.join(', ')}), each token 32 characters or more`;
const ownerEmails = (value) =>
  value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .every((email) => /^[^@\s]+@elevateeducation\.in$/.test(email))
    ? null
    : 'may list only @elevateeducation.in addresses; anything else stops sign-in from working';
const oneOf = (...allowed) => (value) =>
  allowed.includes(value) ? null : `must be one of: ${allowed.join(', ')}`;
const googlePair = (other) => (_value, env) =>
  env[other] ? null : `needs ${other} as well; Google sign-in stays off with only one of the two`;
const builtUrl = (name) => (value, _env, urls) =>
  value.replace(/\/+$/, '') === urls[name]
    ? null
    : `must be ${urls[name]}, the address this package was built for. A different address needs a new build`;

export const ENV_RULES = [
  { name: 'DATABASE_URL', required: true, check: database, note: 'Address of the PostgreSQL database, with its user and password. All four apps use it, up to 10 connections each.' },
  { name: 'SESSION_SECRET', required: true, check: secret, note: 'At least 32 random characters. Changing it signs everyone out.' },
  { name: 'INTERNAL_SERVICE_TOKEN', required: true, check: secret, note: 'At least 32 random characters. The apps use it to call each other. Required even when INTERNAL_SERVICE_TOKENS is set.' },
  { name: 'INTERNAL_SERVICE_TOKENS', check: moduleTokens, note: 'Optional, recommended: one token per app, as ops:<token>,academic:<token>,marketing:<token>,platform:<token>.' },
  ...[
    ['PLATFORM_URL', 'Platform (Users & roles, Google sign-in).'],
    ['BUSINESS_OPS_OS_URL', 'Business Operations.'],
    ['ACADEMIC_OS_URL', 'Academic.'],
    ['MARKETING_OS_URL', 'Marketing.'],
  ].map(([name, what]) => ({ name, required: true, check: builtUrl(name), builtUrl: true, note: `Address of ${what}` })),
  { name: 'GOOGLE_CLIENT_ID', check: googlePair('GOOGLE_CLIENT_SECRET'), note: 'Needed for real staff to sign in. From the Google Cloud console. Allowed redirect address: PLATFORM_URL + /api/v1/auth/google/callback' },
  { name: 'GOOGLE_CLIENT_SECRET', check: googlePair('GOOGLE_CLIENT_ID'), note: 'Pair of GOOGLE_CLIENT_ID.' },
  { name: 'BOOTSTRAP_OWNER_EMAILS', check: ownerEmails, note: 'Optional. Comma-separated @elevateeducation.in addresses that get the platform_admin and director roles at each sign-in. This is how the first administrator gets in.' },
  { name: 'GROQ_API_KEY', note: 'Optional AI drafting. A provider needs both its key and its model; with none set the AI buttons say AI drafting is not set up.' },
  { name: 'GROQ_MODEL' },
  { name: 'GEMINI_API_KEY' },
  { name: 'GEMINI_MODEL' },
  { name: 'OPENROUTER_API_KEY' },
  { name: 'OPENROUTER_MODEL' },
  { name: 'AI_TIMEOUT_MS', note: 'Optional. Milliseconds to wait for one AI provider. Default 20000.' },
  { name: 'MARKETING_PUBLISHING_ADAPTER', check: oneOf('mock', 'disabled'), note: 'Optional, default mock. No live adapter exists: nothing is published.' },
  { name: 'MARKETING_METRICS_ADAPTER', check: oneOf('mock', 'disabled'), note: 'Optional, default mock. No live adapter exists: no metrics are fetched.' },
  { name: 'NOTIFICATIONS_EMAIL_ADAPTER', check: oneOf('mock', 'disabled'), note: 'Optional, default mock. No live adapter exists: no email is sent.' },
  { name: 'LOG_LEVEL', check: oneOf('debug', 'info', 'warn', 'error'), note: 'Optional, default info.' },
  { name: 'PG_BIN_DIR', note: 'Optional. Folder that holds pg_dump, when it is not on the PATH. Used only by the backup script.' },
];

/** Development settings the apps ignore or misuse in production. */
export const NEVER_IN_PRODUCTION = ['SEED_USER_PASSWORD', 'LOCAL_DEMO_PASSWORD', 'SAMPLE_ANCHOR_DATE', 'ATTACHMENTS_DIR', 'OFFICE_HOST'];

export function envProblems(env, urls) {
  return ENV_RULES.flatMap((rule) => {
    const value = env[rule.name];
    if (!value) return rule.required ? [`${rule.name} is missing. ${rule.note}`] : [];
    const problem = rule.check?.(value, env, urls);
    return problem ? [`${rule.name} ${problem}.`] : [];
  });
}

export function exampleFile(urls) {
  const lines = [
    '# Elevate OS settings. Copy this file to .env.production in this folder and fill it in.',
    '# Keep .env.production private and never send it to anyone. Values already in the environment win.',
    '',
  ];
  for (const rule of ENV_RULES) {
    if (rule.note) lines.push(`# ${rule.required ? 'Required. ' : ''}${rule.note}`);
    if (rule.builtUrl) lines.push(`# This package was built for: ${urls[rule.name]}`);
    lines.push(`${rule.name}=`, '');
  }
  return lines.join('\n');
}
