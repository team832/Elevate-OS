/**
 * `npm run docs:data-dictionary` — regenerate apps/business-ops-os/docs/DATA_DICTIONARY.md
 * from the Drizzle schema (types, required, defaults, allowed values, foreign keys) and the
 * JSDoc comments in packages/database/src/schema/ops*.ts (plain-language meanings).
 * "Written by" lists the Business Ops server files that insert into or update the table.
 * `-- --check` exits 1 when the document is stale.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { generateDrizzleJson } from 'drizzle-kit/api';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { findRepoRoot } from '@elevate/configuration/node';
import { MANAGED_SCHEMAS, SCHEMA_MODULES, schema } from '@elevate/database/schema';

const root = findRepoRoot() ?? process.cwd();
const OUT = path.join(root, 'apps/business-ops-os/docs/DATA_DICTIONARY.md');
const SCHEMA_DIR = path.join(root, 'packages/database/src/schema');
const SERVER_DIR = path.join(root, 'apps/business-ops-os/src/server');
const FILES = [
  'ops',
  'ops-demos',
  'ops-meetings',
  'ops-students',
  'ops-fees-intake',
  'ops-applications',
  'ops-onboarding',
  'ops-tasks',
  'ops-eod',
  'ops-task-imports',
  'ops-review-acks',
] as const;

/** Core tables Ops reads or writes (core.ts belongs to the platform; meanings kept here). */
const CORE_TABLES: Record<string, string> = {
  students:
    'One real person who is (or was) a student: the canonical student identity shared by Business Ops and Academic OS. No contact data here.',
  staff_members:
    'One member of staff (teacher, counsellor, manager…), with or without a login. Business Ops is the steward.',
  users: 'One login account. Written only by authentication and platform admin.',
  programmes:
    'One programme Elevate sells (CLAT, IPMAT, Class 12 Commerce, Dropper…). Academic OS is the steward.',
  departments: 'One department of the organisation chart (provisional until the owner confirms).',
};

/** Plain words for common column names the schema does not comment. */
const GLOSSARY: Record<string, string> = {
  code: 'Human reference shown on screens (never reused).',
  starts_at: 'Start (UTC; shown in Asia/Kolkata time).',
  ends_at: 'End (UTC).',
  occurred_at: 'When it happened (UTC).',
  status_changed_at: 'When the status last changed (UTC).',
  outcome_at: 'When the outcome was recorded (UTC).',
  outcome_by: 'User who recorded the outcome.',
  consent_recorded_at: 'When consent was recorded (UTC).',
  last_login_at: 'Last sign-in (UTC).',
  lead_id: 'The lead (enquiring student or family) this belongs to.',
  admission_id: 'The admission case this belongs to.',
  student_id: 'The student (canonical identity, core.students).',
  demo_id: 'The demo this belongs to.',
  session_id: 'The demo class this belongs to.',
  appointment_id: 'The appointment this belongs to.',
  plan_id: 'The fee plan this belongs to.',
  instalment_id: 'The instalment of the plan this pays (optional).',
  programme_id: 'Programme (CLAT, IPMAT, Class 12 Commerce …).',
  staff_id: 'Staff member.',
  guardian_id: 'Guardian (ops.guardians).',
  status: 'Current state (allowed values listed).',
  kind: 'What kind of row this is (allowed values listed).',
  type: 'What kind of appointment this is (allowed values listed).',
  outcome: 'Result, in words or as a listed value.',
  field: 'Which field changed.',
  previous_value: 'Value before the change.',
  new_value: 'Value after the change.',
  subject: 'Subject taught or discussed, e.g. English.',
  currency: 'Always INR.',
  timezone: 'Time zone the instants are shown in (Asia/Kolkata).',
  label: 'Name shown on screens.',
  sort_order: 'Position in lists (smaller first).',
  rejection_code: 'Academic OS rejection code, when rejected.',
  rejection_reason: 'Academic OS rejection reason, when rejected.',
  item_key: 'Which checklist item (allowed values listed or a lower_snake key).',
  source_note: 'Where the record came from.',
  verification_status: 'Whether the owner confirmed this (unverified or confirmed).',
  relationship: 'Relationship to the student.',
  full_name: 'Full name as written by staff.',
  consent_status: 'Contact consent (never assumed: not_recorded until someone records it).',
  preferred_contact: 'How the family prefers to be contacted.',
};

/** Plain words for columns the schema does not comment, by name pattern. */
const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^id$/, () => 'Row id (generated).'],
  [/^created_at$/, () => 'When the row was created (UTC).'],
  [/^updated_at$/, () => 'When the row last changed (UTC).'],
  [/^created_by$/, () => 'User who created the row.'],
  [/^updated_by$/, () => 'User who last changed the row.'],
  [/^actor_user_id$/, () => 'User who made the change.'],
  [/^at$/, () => 'When it happened (UTC).'],
  [/^(\w+)_by$/, (m) => `User who ${m[1]!.replace(/_/g, ' ')} it.`],
  [/^(\w+)_staff_id$/, (m) => `Staff member who is the ${m[1]!.replace(/_/g, ' ')}.`],
  [/^(\w+)_at$/, (m) => `When it was ${m[1]!.replace(/_/g, ' ')} (UTC).`],
  [/^(\w+)_(date|on)$/, (m) => `${cap(m[1]!.replace(/_/g, ' '))} day (Asia/Kolkata calendar day).`],
  [/^(\w+)_paise$/, (m) => `${cap(m[1]!.replace(/_/g, ' '))} in integer paise (₹1 = 100).`],
  [/^notes?$/, () => 'Free-text notes.'],
  [/^reason$/, () => 'Why (free text).'],
  [/^(\w+)_reason$/, (m) => `Why it was ${m[1]!.replace(/_/g, ' ')} (free text).`],
  [/^(\w+)_note$/, (m) => `Note about the ${m[1]!.replace(/_/g, ' ')}.`],
  [
    /^(\w+)_(ref|reference)$/,
    (m) => `Reference to the ${m[1]!.replace(/_/g, ' ')} (free text, no link).`,
  ],
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The parts of a drizzle-kit snapshot this script reads. */
interface Table {
  columns: Record<string, { name: string; type: string; notNull: boolean; default?: unknown }>;
  foreignKeys: Record<
    string,
    { columnsFrom: string[]; schemaTo: string; tableTo: string; onDelete?: string }
  >;
  checkConstraints: Record<string, { value: string }>;
}
type Snapshot = { tables: Record<string, Table> };

/** JSDoc of each exported table and of each column property, from the TS source. */
function jsdocOf(file: string) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const tables = new Map<string, { doc: string; columns: Map<string, string> }>();
  const docOf = (node: ts.Node) =>
    ts
      .getJSDocCommentsAndTags(node)
      .map((d) => ts.getTextOfJSDocComment((d as ts.JSDoc).comment) ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  src.forEachChild((stmt) => {
    if (!ts.isVariableStatement(stmt)) return;
    const decl = stmt.declarationList.declarations[0];
    const call = decl?.initializer;
    if (!decl || !call || !ts.isCallExpression(call) || !/\.table$/.test(call.expression.getText()))
      return;
    const [nameArg, colsArg] = call.arguments;
    if (
      !nameArg ||
      !ts.isStringLiteral(nameArg) ||
      !colsArg ||
      !ts.isObjectLiteralExpression(colsArg)
    )
      return;
    const columns = new Map<string, string>();
    for (const p of colsArg.properties) {
      const init = ts.isPropertyAssignment(p) ? p.initializer.getText() : '';
      const dbName = /^\w+\('(\w+)'/.exec(init)?.[1] ?? /\(\s*'(\w+)'/.exec(init)?.[1];
      const doc = docOf(p);
      if (dbName && doc) columns.set(dbName, doc);
    }
    tables.set(nameArg.text, { doc: docOf(stmt), columns });
  });
  return tables;
}

/** Server files that insert into / update each schema export (aliases followed). */
function writersOf() {
  const writers = new Map<string, Set<string>>();
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : e.name.endsWith('.ts')
          ? [path.join(dir, e.name)]
          : [],
    );
  for (const file of walk(SERVER_DIR)) {
    const text = readFileSync(file, 'utf8');
    const alias = new Map(
      [...text.matchAll(/\b((?:ops|core)?\w+) as (\w+)\b/g)].map((m) => [m[2]!, m[1]!]),
    );
    for (const m of text.matchAll(/\.(?:insert|update)\((\w+)\)/g)) {
      const name = alias.get(m[1]!) ?? m[1]!;
      if (!writers.has(name)) writers.set(name, new Set());
      writers
        .get(name)!
        .add(path.relative(path.join(root, 'apps/business-ops-os'), file).replace(/\\/g, '/'));
    }
  }
  return writers;
}

/** Allowed values and formats per column, read from IN (...) and ~ '...' CHECK constraints. */
function rulesOf(table: Table) {
  const allowed = new Map<string, string[]>();
  const format = new Map<string, string>();
  for (const c of Object.values(table.checkConstraints)) {
    for (const m of c.value.matchAll(/"(\w+)" IN \(([^)]*)\)/g))
      if (!allowed.has(m[1]!))
        allowed.set(
          m[1]!,
          [...m[2]!.matchAll(/'([^']*)'/g)].map((v) => v[1]!),
        );
    const f = /^"[^"]+"\."[^"]+"\."(\w+)" ~ '([^']+)'$/.exec(c.value);
    if (f) format.set(f[1]!, f[2]!);
  }
  return { allowed, format };
}

function example(type: string, column: string, values?: string[], fmt?: string): string {
  if (values?.length) return values[0]!;
  if (fmt && !/[|(]/.test(fmt))
    return fmt
      .replace(/^\^|\$$/g, '')
      .replace(/\[0-9\]\{(\d+)\}/g, (_, n) => '0'.repeat(+n - 1) + '1')
      .replace(/\[[^\]]*\](\{[^}]*\}|[+*]?)?/g, 'A')
      .replace(/\\/g, '');
  if (type === 'uuid') return '(id)';
  if (type.startsWith('timestamp')) return '2026-10-21T10:30:00Z';
  if (type === 'date') return '2026-10-21';
  if (type === 'boolean') return 'false';
  if (column.endsWith('_paise')) return '4000000 (₹40,000)';
  if (/int/.test(type)) return '1';
  return '';
}

function render(snapshot: Snapshot) {
  const doc = new Map(FILES.flatMap((f) => [...jsdocOf(path.join(SCHEMA_DIR, `${f}.ts`))]));
  const writers = writersOf();
  const tablesOf = (file: keyof typeof SCHEMA_MODULES) =>
    Object.entries(SCHEMA_MODULES[file])
      .filter(([, v]) => is(v, PgTable))
      .map(([exportName, t]) => {
        const c = getTableConfig(t as PgTable);
        return { key: `${c.schema}.${c.name}`, exportName };
      });
  const order = [...doc.keys()];
  const entries = [
    ...tablesOf('core').filter((t) => t.key.slice(5) in CORE_TABLES),
    ...FILES.flatMap(tablesOf).sort(
      (a, b) => order.indexOf(a.key.slice(4)) - order.indexOf(b.key.slice(4)),
    ),
  ];
  const out: string[] = [];
  for (const { key, exportName } of entries) {
    const table = snapshot.tables[key]!;
    const [schemaName, name] = key.split('.') as [string, string];
    const meta =
      schemaName === 'core'
        ? { doc: CORE_TABLES[name]!, columns: new Map<string, string>() }
        : doc.get(name);
    const { allowed, format } = rulesOf(table);
    const fks = Object.values(table.foreignKeys);
    const cols = Object.values(table.columns);
    const sample = cols.some((c) => c.name === 'is_sample')
      ? 'Own flag: `is_sample = true` marks a sample row.'
      : fks.some((f) =>
            [
              'leads',
              'admissions',
              'students',
              'demos',
              'appointments',
              'fee_plans',
              'demo_sessions',
            ].includes(f.tableTo),
          )
        ? 'Follows its parent: sample when the lead / student it belongs to is sample.'
        : 'Reference or configuration data (not person data).';
    const by = writers.get(exportName);
    out.push(
      `### \`${key}\``,
      '',
      meta?.doc || '(No description yet.)',
      '',
      `- **Written by:** ${
        by
          ? [...by]
              .sort()
              .map((f) => `\`${f}\``)
              .join(', ')
          : schemaName === 'core'
            ? 'see `packages/database/src/schema/core.ts` (write rules at the top)'
            : 'seeds / migrations only'
      }`,
      `- **Sample or real:** ${sample}`,
      ...(fks.length
        ? [
            `- **Links to:** ${fks.map((f) => `\`${f.columnsFrom.join(', ')}\` → \`${f.schemaTo}.${f.tableTo}\` (on delete ${f.onDelete})`).join('; ')}`,
          ]
        : []),
      '',
      '| Column | Type | Required | Allowed values / format | Example | Meaning |',
      '|---|---|---|---|---|---|',
      ...cols.map((c) => {
        const values = allowed.get(c.name);
        const fmt = format.get(c.name);
        const fk = fks.find((f) => f.columnsFrom.length === 1 && f.columnsFrom[0] === c.name);
        const meaning =
          meta?.columns.get(c.name) ??
          GLOSSARY[c.name] ??
          PATTERNS.map(([re, f]) => {
            const m = c.name.match(re);
            return m ? f(m) : null;
          }).find(Boolean) ??
          `${cap(c.name.replace(/_/g, ' '))}.`;
        const def =
          c.default !== undefined ? ` (default ${String(c.default).replace(/'/g, '')})` : '';
        const cells = [
          `\`${c.name}\``,
          c.type,
          `${c.notNull ? 'yes' : 'no'}${def}`,
          values ? values.map((v) => `\`${v}\``).join(', ') : fmt ? `\`${fmt}\`` : '',
          example(c.type, c.name, values, fmt),
          `${meaning}${fk ? ` → \`${fk.schemaTo}.${fk.tableTo}\`` : ''}`,
        ];
        return `| ${cells.map((x) => x.replace(/\|/g, '\\|')).join(' | ')} |`;
      }),
      '',
    );
  }
  return out.join('\n');
}

const HEADER = `# Business Ops data dictionary

Generated by \`npm run docs:data-dictionary\` from the Drizzle schema and its comments
(\`packages/database/src/schema/ops*.ts\`). **Do not edit by hand** — change the schema
comment and regenerate. Pictures of how the tables connect: [DATA_MODEL.md](DATA_MODEL.md).

## How to read it

- **One section per table.** The first line says what one row means.
- **Required** = the database refuses a row without it. Allowed values come from the
  database's own CHECK rules, so they are always current.
- **Names** (D-036): \`<x>_staff_id\` = a staff member; \`student_id\` = the canonical
  student (\`core.students\`); \`academic_student_id\` = Academic OS's own record;
  \`<x>_by\` / \`actor_user_id\` = a login user; \`<x>_at\` = an instant in UTC (shown in IST);
  \`<x>_date\` / \`<x>_on\` = an Asia/Kolkata calendar day; \`<x>_paise\` = money in integer
  paise; \`code\` = a human reference such as \`LEAD-000001\`.
- **Never deleted:** students, leads, admissions, demos and every history table
  (\`*_changes\`, \`*_transitions\`, checklist entries) keep their rows; mistakes are
  corrected by a new row or a status, not by deleting.

## Sample data vs real data

Development data is **sample data** (D-036): leads, students and staff carry
\`is_sample = true\`, read "<First> Sample Student" or "Sample <role>", use \`@example.test\`
emails and have no phone numbers. The screens show a SAMPLE DATA badge. Rows that belong
to a sample lead or student (admissions, demos, sessions, fees, meetings) are sample too.
Before real use run \`npm run db:clear-samples\` — it deletes every sample row and keeps real
ones. The seven owner-supplied teachers are real directory records and never get sample
classes or meetings.

## Tables
`;

const snapshot = generateDrizzleJson(schema as never, undefined, [
  ...MANAGED_SCHEMAS,
]) as unknown as Snapshot;
const text = `${HEADER}\n${render(snapshot)}`;
if (process.argv.includes('--check')) {
  if (readFileSync(OUT, 'utf8') !== text) {
    console.error(
      'docs:data-dictionary — DATA_DICTIONARY.md is out of date; run npm run docs:data-dictionary',
    );
    process.exit(1);
  }
  console.log('docs:data-dictionary — up to date.');
} else {
  writeFileSync(OUT, text);
  console.log(
    `docs:data-dictionary — wrote ${path.relative(root, OUT)} (${Object.keys(snapshot.tables).length} tables in schema).`,
  );
}
