#!/usr/bin/env node
/**
 * Secret scan — `npm run secret-scan` (also part of `npm run validate`).
 *
 * Scans every file git would commit (tracked + untracked-but-not-ignored) and
 * FAILS when it finds:
 *   - an `.env` / `.env.*` file other than `.env.example` that is not ignored;
 *   - text that looks like a credential (private keys, cloud/API tokens, JWTs,
 *     database URLs with real passwords, long secret-looking assignments).
 * Findings print file:line and the rule name — never the matched value.
 *
 * False positive? Prefer fixing the text (use a placeholder such as
 * `replace-with-…`). As a last resort add `secret-scan:allow` in a comment on
 * that line and explain why in the same comment.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PLACEHOLDER =
  /(replace[-_]with|test[-_]only|example|fictional|placeholder|dummy|changeme|change-me|\*\*\*|<[^>]*>|\$\{|xxxx)/i;

const RULES = [
  {
    name: 'private-key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'stripe-live-key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/ },
  { name: 'llm-api-key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'database-url-with-password',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/'"`]+:([^@\s'"`]+)@/,
    check: (m) => m[1].length >= 8 && !PLACEHOLDER.test(m[1]) && !/^[A-Z_]+$/.test(m[1]),
  },
  {
    name: 'secret-assignment',
    re: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*['"]?([^\s'"`,;]{16,})/i,
    // Code expressions (calls, property access) are not literals.
    check: (m) =>
      !PLACEHOLDER.test(m[2]) && !/[().]/.test(m[2]) && /[0-9]/.test(m[2]) && /[A-Za-z]/.test(m[2]),
  },
];

const SKIP_FILES = new Set(['package-lock.json']);
const SKIP_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.xlsx',
  '.docx',
  '.woff',
  '.woff2',
  '.mp4',
]);
const MAX_BYTES = 2 * 1024 * 1024;

function listFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root },
  );
  return out.toString('utf8').split('\0').filter(Boolean);
}

const findings = [];
for (const rel of listFiles()) {
  const base = path.basename(rel);
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
    findings.push({ file: rel, line: 0, rule: 'env-file-not-ignored' });
    continue;
  }
  if (SKIP_FILES.has(base) || SKIP_EXT.has(path.extname(base).toLowerCase())) continue;
  const full = path.join(root, rel);
  let text;
  try {
    if (statSync(full).size > MAX_BYTES) continue;
    text = readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes('secret-scan:allow')) return;
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (m && (!rule.check || rule.check(m)))
        findings.push({ file: rel, line: i + 1, rule: rule.name });
    }
  });
}

if (findings.length > 0) {
  console.error(`secret-scan — ${findings.length} possible secret(s) found:`);
  for (const f of findings) console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.rule}]`);
  console.error(
    'Remove the value (use a placeholder) or, for a proven false positive, add a "secret-scan:allow" comment with the reason.',
  );
  process.exit(1);
}
console.log(
  `secret-scan — OK (${listFiles().length} files checked, no secrets or .env files found).`,
);
