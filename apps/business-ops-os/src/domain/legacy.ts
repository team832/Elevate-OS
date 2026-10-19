/**
 * Legacy importers (PLT-011, OPS-019, OPS-021): pure mappers from the extracts
 * in data/legacy/ops/*.json to Ops records. Rules (AUDIT DI-21, D-016):
 * - legacy IDs are NAMESPACED (`LEGACY-OPSWB-D-003`) so they never collide with
 *   Elevate OS codes (`DEC-0001`, `SOP-0001`) or requirement IDs (`OPS-001`);
 * - legacy status words are kept verbatim next to the mapped state;
 * - nothing is ever imported as approved/effective unless the source says so,
 *   and no SOP is approved (none is, per data/legacy/ops/sops.json notes);
 * - owner/backup names are never filled (they are blank in the source, OD-009).
 * Algorithm documentation: docs/ALGORITHMS.md → A-13.
 */
import { z } from 'zod';
import type { DecisionLogState } from './registers';

export const LEGACY_NAMESPACES = {
  operationsWorkbook: 'OPSWB',
  onlineWorkbook: 'ONLINE',
  marketingWorkbook: 'MKTEASY',
} as const;

/** `LEGACY-<NS>-<ID>` in upper case with only A–Z, 0–9 and dashes. */
export function legacyCode(namespace: string, id: string): string {
  const clean = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `LEGACY-${clean(namespace)}-${clean(id)}`;
}

export function isLegacyCode(code: string): boolean {
  return code.startsWith('LEGACY-');
}

const sourceSchema = z.object({ path: z.string(), locator: z.string() });

// --- decisions -----------------------------------------------------------------------------------

const decisionsSheetSchema = z.object({
  sheet: z.literal('Decisions'),
  source: sourceSchema,
  rows: z.array(
    z.object({
      ID: z.string(),
      Area: z.string(),
      'Decision or question': z.string(),
      Status: z.string(),
      _row: z.number(),
    }),
  ),
});

const DECISION_STATE_MAP: Record<string, DecisionLogState> = {
  confirmed: 'confirmed',
  open: 'open',
  provisional: 'provisional',
  proposed: 'proposed',
  superseded: 'superseded',
};

export interface LegacyDecision {
  code: string;
  area: string;
  statement: string;
  state: DecisionLogState;
  legacyStatus: string;
  legacyRef: string;
  source: string;
}

function workbookSheet(workbook: unknown, sheet: string): unknown {
  const parsed = z
    .object({ records: z.array(z.object({ sheet: z.string() }).loose()) })
    .parse(workbook);
  const found = parsed.records.find((r) => r.sheet === sheet);
  if (!found) throw new Error(`Legacy workbook has no "${sheet}" sheet`);
  return found;
}

/** Decisions sheet of Elevate-Operations.xlsx → decision log rows (24 in the source). */
export function mapLegacyDecisions(operationsWorkbook: unknown): LegacyDecision[] {
  const sheet = decisionsSheetSchema.parse(workbookSheet(operationsWorkbook, 'Decisions'));
  return sheet.rows.map((row) => {
    const state = DECISION_STATE_MAP[row.Status.trim().toLowerCase()];
    if (!state)
      throw new Error(`Unknown legacy decision status "${row.Status}" on row ${row._row}`);
    return {
      code: legacyCode(LEGACY_NAMESPACES.operationsWorkbook, row.ID),
      area: row.Area,
      statement: row['Decision or question'],
      state,
      legacyStatus: row.Status,
      legacyRef: `${sheet.source.path} — sheet 'Decisions'!A${row._row}:D${row._row}`,
      source: 'Elevate-Operations.xlsx, Decisions sheet (legacy handover, 2026-10-15)',
    };
  });
}

// --- work inventory ------------------------------------------------------------------------------

const workInventorySchema = z.object({
  sheet: z.literal('Work Inventory'),
  source: sourceSchema,
  rows: z.array(
    z.object({
      ID: z.string(),
      Function: z.string(),
      Process: z.string(),
      Scope: z.string().optional(),
      'Proposed role': z.string().optional(),
      'Decision status': z.string(),
      status_normalised: z.enum(['approved', 'documented', 'planned', 'proposed', 'open']),
      _row: z.number(),
    }),
  ),
});

export interface LegacyWorkItem {
  code: string;
  function: string;
  process: string;
  scope: string | null;
  proposedRole: string | null;
  status: 'approved' | 'documented' | 'planned' | 'proposed' | 'open';
  legacyStatus: string;
  legacyRef: string;
}

export function mapLegacyWorkInventory(operationsWorkbook: unknown): LegacyWorkItem[] {
  const sheet = workInventorySchema.parse(workbookSheet(operationsWorkbook, 'Work Inventory'));
  return sheet.rows.map((row) => ({
    code: legacyCode(LEGACY_NAMESPACES.operationsWorkbook, row.ID),
    function: row.Function,
    process: row.Process,
    scope: row.Scope ?? null,
    proposedRole: row['Proposed role'] ?? null,
    status: row.status_normalised,
    legacyStatus: row['Decision status'],
    legacyRef: `${sheet.source.path} — sheet 'Work Inventory'!A${row._row}:F${row._row}`,
  }));
}

// --- SOPs ----------------------------------------------------------------------------------------

/** Proposed mapping from legacy "Function" words to the 13 provisional department codes. */
export const LEGACY_FUNCTION_DEPARTMENT: Record<string, string> = {
  Marketing: 'MARKETING_GROWTH',
  Admissions: 'ADMISSIONS_COUNSELLING',
  Fees: 'FINANCE',
  Coordination: 'STUDENT_SUCCESS',
  'Student support': 'STUDENT_SUCCESS',
  Attendance: 'STUDENT_SUCCESS',
  Academics: 'ACADEMICS',
  Materials: 'CURRICULUM_CONTENT',
  Examinations: 'EXAMINATIONS',
  'Centre support': 'ADMINISTRATION_FACILITIES',
  People: 'LEADERSHIP_OPERATIONS',
};

export interface LegacySop {
  code: string;
  title: string;
  process: string | null;
  departmentCode: string | null;
  ownerRole: string | null;
  /** Mapped register status. Only `not_drafted` or `draft` — never approved. */
  status: 'not_drafted' | 'draft';
  legacySource: string;
  legacyStatus: string;
  legacyRef: string;
  /** A first version when the source holds content (marketing summaries, coordinator SOP). */
  version: {
    label: string;
    content: string;
    sourceDate: string | null;
    changeNote: string;
    documentRef: string | null;
    checklist: { section: string; text: string }[];
  } | null;
}

const opsSopSheetSchema = z.object({
  sheet: z.literal('SOP Register'),
  source: sourceSchema,
  rows: z.array(
    z.object({
      'SOP ID': z.string(),
      Function: z.string(),
      Process: z.string(),
      Status: z.string(),
      'Owner role': z.string().optional(),
      _row: z.number(),
    }),
  ),
});

/** Operations workbook SOP Register (25 rows, "Register only: these are not approved SOPs"). */
export function mapOperationsSopRegister(operationsWorkbook: unknown): LegacySop[] {
  const sheet = opsSopSheetSchema.parse(workbookSheet(operationsWorkbook, 'SOP Register'));
  return sheet.rows.map((row) => ({
    code: legacyCode(LEGACY_NAMESPACES.operationsWorkbook, row['SOP ID']),
    title: row.Process,
    process: `${row.Function}: ${row.Process}`,
    departmentCode: LEGACY_FUNCTION_DEPARTMENT[row.Function] ?? null,
    ownerRole: row['Owner role'] ?? null,
    status: 'not_drafted',
    legacySource: 'Elevate-Operations.xlsx SOP Register',
    legacyStatus: row.Status,
    legacyRef: `${sheet.source.path} — sheet 'SOP Register'!A${row._row}:H${row._row}`,
    version: null,
  }));
}

const sopsFileSchema = z.object({
  registers: z.array(
    z.object({
      id: z.string(),
      source: sourceSchema,
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    }),
  ),
  records: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      dated: z.string().nullable(),
      status: z.string(),
      status_note: z.string().optional(),
      owner: z.unknown(),
      backup: z.unknown(),
      sections: z.array(
        z.object({ seq: z.number(), section: z.string(), steps: z.array(z.string()) }),
      ),
      source: z.array(sourceSchema),
    }),
  ),
});

const str = (v: string | number | undefined) => (v === undefined ? null : String(v));

/** A blank form line in the source ("Assigned staff: ____") — a field to fill, not a step. */
function isBlankFormLine(step: string): boolean {
  return /_{4,}/.test(step);
}

/**
 * Online register (ON-01…16, "To draft"), marketing register (MKT-01…09,
 * agreed summaries v1.0 with no approver → `draft`, OD-028) and the online
 * coordinator SOP (`draft`, dated 18 Sep 2026, unsigned → `draft`, OD-028).
 */
export function mapSopsFile(sopsFile: unknown): LegacySop[] {
  const file = sopsFileSchema.parse(sopsFile);
  const out: LegacySop[] = [];
  for (const register of file.registers) {
    if (register.id === 'online') {
      for (const row of register.rows) {
        const id = str(row['SOP ID']);
        if (!id) continue;
        out.push({
          code: legacyCode(LEGACY_NAMESPACES.onlineWorkbook, id),
          title: str(row.Process) ?? id,
          process: str(row.Scope),
          departmentCode: null,
          ownerRole: str(row['Role owner']),
          status: 'not_drafted',
          legacySource: 'Elevate-Online-Easy.xlsx SOP Register',
          legacyStatus: str(row['Document status']) ?? 'unknown',
          legacyRef: `${register.source.path} — sheet 'SOP Register' row ${str(row._row) ?? '?'}`,
          version: null,
        });
      }
    }
    if (register.id === 'marketing') {
      for (const row of register.rows) {
        const id = str(row['SOP ID']);
        if (!id) continue;
        const content = [
          `Trigger / input: ${str(row['Trigger / input']) ?? '—'}`,
          `Steps: ${str(row.Steps) ?? '—'}`,
          `Turnaround / rhythm: ${str(row['Turnaround / rhythm']) ?? '—'}`,
          `Checks / escalation: ${str(row['Checks / escalation']) ?? '—'}`,
          `Completion evidence: ${str(row['Completion evidence']) ?? '—'}`,
        ].join('\n');
        out.push({
          code: legacyCode(LEGACY_NAMESPACES.marketingWorkbook, id),
          title: str(row.Procedure) ?? id,
          process: str(row.Procedure),
          departmentCode: 'MARKETING_GROWTH',
          ownerRole: str(row.Owner),
          status: 'draft',
          legacySource: 'Elevate-Marketing-Easy.xlsx SOP Register',
          legacyStatus: `Agreed operating summary, version ${str(row.Version) ?? '?'}, "Approved by" blank`,
          legacyRef: `${register.source.path} — sheet 'SOP Register' row ${str(row._row) ?? '?'}`,
          version: {
            label: '0.1',
            content,
            sourceDate: null,
            changeNote: `Imported from the legacy register (source version ${str(row.Version) ?? '?'}; no approver recorded, OD-028).`,
            documentRef: null,
            checklist: [],
          },
        });
      }
    }
  }
  for (const record of file.records) {
    const checklist: { section: string; text: string }[] = [];
    const contentLines: string[] = [];
    for (const section of [...record.sections].sort((a, b) => a.seq - b.seq)) {
      contentLines.push(`## ${section.seq}. ${section.section}`);
      for (const step of section.steps) {
        if (isBlankFormLine(step)) {
          contentLines.push('- [blank in source — to be completed by the manager]');
          continue;
        }
        contentLines.push(`- ${step}`);
        checklist.push({ section: section.section, text: step });
      }
      contentLines.push('');
    }
    out.push({
      code: legacyCode(LEGACY_NAMESPACES.onlineWorkbook, 'SOP-COORDINATOR'),
      title: record.title,
      process: 'Online class coordination',
      departmentCode: 'STUDENT_SUCCESS',
      ownerRole: 'Online Class Coordinator',
      status: 'draft',
      legacySource: 'Elevate-Online-Coordinator-SOP.docx',
      legacyStatus: `${record.status}${record.status_note ? ` — ${record.status_note}` : ''}`,
      legacyRef: record.source.map((s) => `${s.path} (${s.locator})`).join('; '),
      version: {
        label: '0.1',
        content: contentLines.join('\n').trim(),
        sourceDate: record.dated,
        changeNote:
          'Imported draft (unsigned; owner, backup, manager and approval blank in the source). Awaiting OD-028.',
        documentRef: 'handover/outputs/online-operations/Elevate-Online-Coordinator-SOP.docx',
        checklist,
      },
    });
  }
  return out;
}

// --- responsibilities from the online role list ---------------------------------------------------

const rolesFileSchema = z.object({
  records: z.array(
    z.object({
      role: z.string(),
      function: z.string(),
      main_work: z.string(),
      hand_over_to: z.string().nullable(),
      source: sourceSchema,
    }),
  ),
});

export interface LegacyResponsibility {
  code: string;
  title: string;
  description: string;
  accountableRole: string;
  handOverToRole: string | null;
  legacyRef: string;
}

/** Online `Roles` sheet → responsibilities with NO holder or backup (names are blank, OD-009). */
export function mapLegacyRoles(rolesFile: unknown): LegacyResponsibility[] {
  const file = rolesFileSchema.parse(rolesFile);
  return file.records.map((r, i) => ({
    code: legacyCode(LEGACY_NAMESPACES.onlineWorkbook, `ROLE-${String(i + 1).padStart(2, '0')}`),
    title: `${r.function}: ${r.role}`,
    description: r.main_work,
    accountableRole: r.role,
    handOverToRole: r.hand_over_to,
    legacyRef: `${r.source.path} (${r.source.locator})`,
  }));
}
