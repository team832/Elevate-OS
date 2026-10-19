#!/usr/bin/env node
/**
 * Generates docs/code-map.html — a self-contained visual map of the repository:
 * the folder tree (with module ownership), every database table parsed from
 * packages/database/src/schema/*.ts, its foreign keys, and the source files that
 * import it. Every file and table links to its location on disk (file:// URLs).
 *
 * Usage: node scripts/development/code-map.mjs [--out docs/code-map.html]
 * Read-only except for the output file. Safe to re-run at any time.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outArg = process.argv.indexOf('--out');
const OUT = join(ROOT, outArg > -1 ? process.argv[outArg + 1] : 'docs/code-map.html');

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.data',
  'coverage',
  '.turbo',
  '__pycache__',
]);
const SKIP_FILES = [/\.tsbuildinfo$/, /^code-map\.html$/];
const TEXT_EXT =
  /\.(ts|tsx|mts|mjs|cjs|js|jsx|json|md|css|sql|py|csv|yml|yaml|txt|example|gitignore|prettierrc|prettierignore)$/i;
const SCHEMA_DIR = 'packages/database/src/schema';
const SCHEMAS = ['core', 'marketing', 'academic', 'ops'];

const rel = (p) => relative(ROOT, p).split(sep).join('/');

function ownerOf(path) {
  const rules = [
    [
      /^apps\/marketing-os\/|schema\/marketing\.ts$|modules\/marketing\.ts$|permissions\/marketing\.ts$/,
      'marketing',
    ],
    [
      /^apps\/academic-os\/|schema\/academic\.ts$|modules\/academic\.ts$|permissions\/academic\.ts$/,
      'academic',
    ],
    [/^apps\/business-ops-os\/|schema\/ops\.ts$|modules\/ops\.ts$|permissions\/ops\.ts$/, 'ops'],
    [/^apps\/platform\//, 'platform'],
    [/^packages\//, 'shared'],
    [/^data\//, 'legacy'],
    [/^(infrastructure|scripts)\//, 'infra'],
  ];
  for (const [re, owner] of rules) if (re.test(path)) return owner;
  return 'docs';
}

// ---------- folder tree ----------
const allFiles = [];
function walk(dir) {
  const node = {
    name: dir === ROOT ? 'elevate-os' : dir.split(sep).pop(),
    path: rel(dir),
    type: 'dir',
    children: [],
  };
  let entries = readdirSync(dir, { withFileTypes: true });
  entries = entries.sort((a, b) =>
    a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
  );
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      node.children.push(walk(full));
    } else if (e.isFile()) {
      if (e.name === '.env' || SKIP_FILES.some((re) => re.test(e.name))) continue;
      const path = rel(full);
      const size = statSync(full).size;
      let lines = null;
      let text = null;
      if (TEXT_EXT.test(e.name) && size < 2_000_000) {
        text = readFileSync(full, 'utf8');
        lines = text.split('\n').length;
      }
      const file = { name: e.name, path, type: 'file', size, lines, owner: ownerOf(path) };
      node.children.push(file);
      allFiles.push({ ...file, text });
    }
  }
  node.owner = ownerOf(node.path + '/');
  return node;
}
const tree = walk(ROOT);

// ---------- schema parsing ----------
const exportToTable = new Map(); // export name -> "schema.table"
const schemas = [];
for (const schema of SCHEMAS) {
  const file = `${SCHEMA_DIR}/${schema}.ts`;
  let src;
  try {
    src = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    continue;
  }
  const lines = src.split('\n');
  // helper column builders that embed a foreign key, e.g. const staffRef = (n) => uuid(n).references(() => staffMembers.id)
  const helpers = new Map();
  const helperRe =
    /(?:const|function)\s+(\w+)\s*(?:=\s*)?(?:<[^>]*>)?\(([^)]*)\)[^{=]*(?:=>|\{)([\s\S]*?)(?=\n(?:export |const |function |\/\*\*|\/\/ ---))/g;
  for (const m of src.matchAll(helperRe)) {
    const ref = /references\(\s*\(\)[^=]*=>\s*(\w+)\.id/.exec(m[3]);
    if (ref && !/\.table\(/.test(m[3])) helpers.set(m[1], ref[1]);
  }
  const tableRe = /export const (\w+)\s*=\s*(\w+)\.table\(\s*['"]([\w]+)['"]/g;
  const starts = [...src.matchAll(tableRe)];
  const tables = starts.map((m, i) => {
    const startIdx = m.index;
    const endIdx = i + 1 < starts.length ? starts[i + 1].index : src.length;
    const block = src.slice(startIdx, endIdx);
    const line = src.slice(0, startIdx).split('\n').length;
    const columns = [];
    const refs = [];
    let current = null;
    for (const l of block.split('\n')) {
      const col = /^\s*(\w+):\s*(\w+)(?:<[^>]*>)?\(\s*['"](\w+)['"]/.exec(l);
      if (col) {
        current = { key: col[1], name: col[3], type: helpers.has(col[2]) ? 'uuid' : col[2] };
        columns.push(current);
        if (helpers.has(col[2])) refs.push({ column: col[3], target: helpers.get(col[2]) });
      }
      const ref = /references\(\s*\(\)(?::\s*\w+)?\s*=>\s*(\w+)\.id/.exec(l);
      if (ref && current) refs.push({ column: current.name, target: ref[1] });
      if (/\.primaryKey\(\)/.test(l) && current) current.pk = true;
      if (/\.notNull\(\)/.test(l) && current) current.notNull = true;
      if (/\.unique\(\)/.test(l) && current) current.unique = true;
    }
    const indexes = (block.match(/(?:uniqueIndex|index)\(\s*['"][\w]+['"]\s*\)/g) || []).length;
    const checks = (block.match(/check\(\s*['"]/g) || []).length;
    exportToTable.set(m[1], `${schema}.${m[3]}`);
    return { export: m[1], name: m[3], schema, line, columns, refs, indexes, checks, usedBy: [] };
  });
  schemas.push({ name: schema, file, lines: lines.length, tables });
}
for (const s of schemas)
  for (const t of s.tables)
    for (const r of t.refs) r.targetTable = exportToTable.get(r.target) ?? null;

// ---------- who imports which table ----------
const byExport = new Map();
for (const s of schemas) for (const t of s.tables) byExport.set(t.export, t);
const codeFiles = allFiles.filter(
  (f) => f.text && /\.(ts|tsx|mts)$/.test(f.name) && !f.path.startsWith(SCHEMA_DIR),
);
for (const f of codeFiles) {
  const used = new Set();
  for (const m of f.text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!/database|schema/.test(m[2])) continue;
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name && byExport.has(name)) used.add(name);
    }
  }
  for (const m of f.text.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (!/database|schema/.test(m[2])) continue;
    for (const u of f.text.matchAll(new RegExp(`\\b${m[1]}\\.(\\w+)`, 'g')))
      if (byExport.has(u[1])) used.add(u[1]);
  }
  for (const name of used) byExport.get(name).usedBy.push(f.path);
}

// ---------- stats ----------
const countBy = (pred) => allFiles.filter(pred).length;
const sumLines = (pred) => allFiles.filter(pred).reduce((a, f) => a + (f.lines ?? 0), 0);
const isCode = (f) => /\.(ts|tsx|mts|mjs)$/.test(f.name);
const isTest = (f) => /\.test\.tsx?$/.test(f.name);
const modules = ['platform', 'shared', 'marketing', 'academic', 'ops'].map((o) => ({
  owner: o,
  files: countBy((f) => f.owner === o),
  codeLines: sumLines((f) => f.owner === o && isCode(f) && !isTest(f)),
  testFiles: countBy((f) => f.owner === o && isTest(f)),
  tables: schemas.find((s) => s.name === (o === 'shared' ? 'core' : o))?.tables.length ?? 0,
}));
const stats = {
  files: allFiles.length,
  codeLines: sumLines((f) => isCode(f) && !isTest(f)),
  testFiles: countBy(isTest),
  tables: schemas.reduce((a, s) => a + s.tables.length, 0),
  foreignKeys: schemas.reduce((a, s) => a + s.tables.reduce((b, t) => b + t.refs.length, 0), 0),
  modules,
};

const data = {
  generatedAt: new Date().toISOString(),
  rootUrl: 'file:///' + ROOT.split(sep).join('/').replace(/^\/+/, ''),
  rootPath: ROOT,
  tree,
  schemas,
  stats,
};

const template = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'code-map.template.html'),
  'utf8',
);
const json = JSON.stringify(data).replace(/</g, '\\u003c');
// Prettier may reformat the placeholder, so match it loosely and fail loudly if it is gone.
const PLACEHOLDER = /\/\*__DATA__\*\/\s*null/;
if (!PLACEHOLDER.test(template))
  throw new Error('code-map.template.html is missing the /*__DATA__*/ null placeholder');
// Function replacer: JSON can contain "$&"-style sequences that a string replacement would expand.
writeFileSync(
  OUT,
  template.replace(PLACEHOLDER, () => json),
);
console.log(
  `code-map — wrote ${rel(OUT)}: ${stats.files} files, ${stats.tables} tables, ${stats.foreignKeys} foreign keys, ${stats.testFiles} test files.`,
);
