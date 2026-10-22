// ESLint flat config for the whole monorepo (`npm run lint`).
// Besides code quality it ENFORCES the module boundaries of D-005/D-011:
//   - a module app never imports another module app;
//   - shared packages never import apps;
//   - a module's src/domain stays pure (no I/O, no framework);
//   - application code never imports test helpers.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const MODULE_APPS = {
  'marketing-os': '@elevate/marketing-os',
  'academic-os': '@elevate/academic-os',
  'business-ops-os': '@elevate/business-ops-os',
};

/**
 * D-073: the shared task/EOD and lead services stay in Business Ops' code; these workspaces
 * may import exactly these entry points of it (a regex, since a gitignore-style "!" cannot
 * re-include a path whose parent is excluded).
 */
const SHARED_ENTRIES = {
  'academic-os': ['work'],
  'marketing-os': ['work', 'leads'],
};

const crossModule = (selfDir) =>
  Object.entries(MODULE_APPS)
    .filter(([dir]) => dir !== selfDir && !(SHARED_ENTRIES[selfDir] && dir === 'business-ops-os'))
    .flatMap(([dir, pkg]) => [pkg, `${pkg}/*`, `**/${dir}/**`, `**/${dir}`]);

/** Everything that names business-ops-os except the allowed entry points. */
const sharedEntryPattern = (selfDir) =>
  SHARED_ENTRIES[selfDir]
    ? [
        {
          regex: `^(?!@elevate/business-ops-os/(${SHARED_ENTRIES[selfDir].join('|')})$).*business-ops-os(/|$)`,
          message: `Module boundary (D-011.3, D-073): only @elevate/business-ops-os/{${SHARED_ENTRIES[selfDir].join(',')}} may be imported here.`,
        },
      ]
    : [];

const BOUNDARY_MESSAGE =
  'Module boundary (D-011.3): never import another module. Use @elevate/shared-contracts (events, summaries) or an API.';
const TEST_ONLY = ['@elevate/testing', '@elevate/database/testing', 'vitest'];
const DOMAIN_FORBIDDEN = [
  'next',
  'next/*',
  'react',
  'react-dom',
  'react/*',
  '@elevate/database',
  '@elevate/database/*',
  '@elevate/server-kit',
  '@elevate/server-kit/*',
  '@elevate/authentication',
  '@elevate/authentication/*',
  '@elevate/notifications',
  'drizzle-orm',
  'drizzle-orm/*',
  'pg',
  'node:fs',
  'node:fs/*',
  'fs',
  'node:child_process',
  'node:net',
  'node:http',
  'node:https',
];

const moduleConfigs = Object.keys(MODULE_APPS).flatMap((dir) => [
  {
    name: `boundaries/${dir}`,
    files: [`apps/${dir}/src/**/*.{ts,tsx}`, `apps/${dir}/seed/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...crossModule(dir),
                '@elevate/platform',
                '@elevate/platform/*',
                '**/apps/platform/**',
              ],
              message: BOUNDARY_MESSAGE,
            },
            ...sharedEntryPattern(dir),
            { group: TEST_ONLY, message: 'Test helpers belong in tests/ only.' },
          ],
        },
      ],
    },
  },
  {
    name: `boundaries/${dir}/domain-purity`,
    files: [`apps/${dir}/src/domain/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...crossModule(dir), '@elevate/platform', '@elevate/platform/*'],
              message: BOUNDARY_MESSAGE,
            },
            { group: TEST_ONLY, message: 'Test helpers belong in tests/ only.' },
            {
              group: DOMAIN_FORBIDDEN,
              message: 'src/domain must be pure: no I/O, database, framework or React imports.',
            },
          ],
        },
      ],
    },
  },
  {
    name: `boundaries/${dir}/tests`,
    files: [`apps/${dir}/tests/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: crossModule(dir), message: BOUNDARY_MESSAGE }] },
      ],
    },
  },
]);

export default tseslint.config(
  {
    name: 'ignores',
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.data/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/database/migrations/**',
      'data/legacy/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'globals',
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    name: 'typescript',
    files: ['**/*.{ts,tsx,mts}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    name: 'next-apps',
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // Links between zones must be plain <a> (multi-zone docs), and Elevate pages are server-rendered.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    name: 'react-hooks/shared-ui',
    files: ['packages/shared-ui/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    name: 'boundaries/packages',
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@elevate/platform',
                '@elevate/platform/*',
                ...Object.values(MODULE_APPS).flatMap((p) => [p, `${p}/*`]),
                '**/apps/**',
              ],
              message: 'Shared packages must not depend on apps.',
            },
          ],
        },
      ],
    },
  },
  ...moduleConfigs,
  {
    name: 'scripts',
    files: ['scripts/**/*.{js,mjs,ts}', '*.config.{js,mjs,ts}', 'packages/*/drizzle.config.ts'],
    rules: { 'no-console': 'off' },
  },
);
