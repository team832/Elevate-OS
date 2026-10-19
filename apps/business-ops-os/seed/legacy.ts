/**
 * Legacy imports for Business Ops (PLT-011): decisions, work inventory, SOP
 * registers + the online coordinator SOP draft, and the online role list as
 * responsibilities. Idempotent upserts on the namespaced legacy code. Nothing is
 * imported as approved; owners/backups stay empty (names are blank, OD-009).
 */
import { eq } from 'drizzle-orm';
import operationsWorkbook from '../../../data/legacy/ops/operations-workbook.json';
import rolesFile from '../../../data/legacy/ops/roles.json';
import sopsFile from '../../../data/legacy/ops/sops.json';
import {
  departments,
  opsDecisions,
  opsResponsibilities,
  opsSopChecklistItems,
  opsSops,
  opsSopVersions,
  opsWorkItems,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import {
  mapLegacyDecisions,
  mapLegacyRoles,
  mapLegacyWorkInventory,
  mapOperationsSopRegister,
  mapSopsFile,
  type LegacySop,
} from '../src/domain';

async function departmentIds(db: Database) {
  const rows = await db.select({ id: departments.id, code: departments.code }).from(departments);
  return new Map(rows.map((r) => [r.code, r.id]));
}

export async function importLegacyDecisions(db: Database) {
  for (const d of mapLegacyDecisions(operationsWorkbook)) {
    const values = { ...d, ownerDecisionRef: d.code === 'LEGACY-OPSWB-D-005' ? 'OD-012' : null };
    await db
      .insert(opsDecisions)
      .values(values)
      .onConflictDoUpdate({ target: opsDecisions.code, set: values });
  }
}

export async function importWorkInventory(db: Database) {
  for (const w of mapLegacyWorkInventory(operationsWorkbook)) {
    await db
      .insert(opsWorkItems)
      .values(w)
      .onConflictDoUpdate({ target: opsWorkItems.code, set: w });
  }
}

async function upsertSop(db: Database, sop: LegacySop, deptIds: Map<string, string>) {
  const values = {
    code: sop.code,
    title: sop.title,
    process: sop.process,
    departmentId: (sop.departmentCode ? deptIds.get(sop.departmentCode) : undefined) as never,
    ownerRole: sop.ownerRole,
    status: sop.status,
    legacySource: sop.legacySource,
    legacyStatus: sop.legacyStatus,
    legacyRef: sop.legacyRef,
  };
  const [existing] = await db.select().from(opsSops).where(eq(opsSops.code, sop.code));
  if (existing) {
    // Never downgrade work done in Elevate OS: only refresh descriptive legacy fields.
    await db
      .update(opsSops)
      .set({
        legacySource: values.legacySource,
        legacyStatus: values.legacyStatus,
        legacyRef: values.legacyRef,
      })
      .where(eq(opsSops.id, existing.id));
    return;
  }
  const [row] = await db
    .insert(opsSops)
    .values({ ...values, departmentId: values.departmentId ?? null })
    .returning();
  if (!row || !sop.version) return;
  const [version] = await db
    .insert(opsSopVersions)
    .values({
      sopId: row.id,
      versionNumber: 1,
      versionLabel: sop.version.label,
      status: 'draft',
      content: sop.version.content,
      changeNote: sop.version.changeNote,
      documentRef: sop.version.documentRef,
      sourceDate: sop.version.sourceDate,
    })
    .returning();
  if (!version) return;
  let seq = 0;
  for (const item of sop.version.checklist) {
    seq += 1;
    await db
      .insert(opsSopChecklistItems)
      .values({ versionId: version.id, seq, section: item.section, text: item.text });
  }
  await db.update(opsSops).set({ currentVersionId: version.id }).where(eq(opsSops.id, row.id));
}

export async function importLegacySops(db: Database) {
  const deptIds = await departmentIds(db);
  for (const sop of [...mapOperationsSopRegister(operationsWorkbook), ...mapSopsFile(sopsFile)]) {
    await upsertSop(db, sop, deptIds);
  }
}

export async function importLegacyResponsibilities(db: Database) {
  for (const r of mapLegacyRoles(rolesFile)) {
    const values = {
      code: r.code,
      title: r.title,
      description: r.description,
      accountableRole: r.accountableRole,
      handOverToRole: r.handOverToRole,
      source: 'Elevate-Online-Easy.xlsx Roles (role labels; names and backups blank in the source)',
      legacyRef: r.legacyRef,
    };
    await db
      .insert(opsResponsibilities)
      .values(values)
      .onConflictDoUpdate({
        target: opsResponsibilities.code,
        set: { title: values.title, description: values.description, legacyRef: values.legacyRef },
      });
  }
}

export const legacySeeds = [
  defineSeed({
    name: 'ops.legacy-decisions',
    module: 'ops',
    description:
      '24 legacy decisions (Elevate-Operations.xlsx) with namespaced IDs and original status',
    run: ({ db }) => importLegacyDecisions(db),
  }),
  defineSeed({
    name: 'ops.legacy-work-inventory',
    module: 'ops',
    description: '25 legacy work-inventory processes with their decision status',
    run: ({ db }) => importWorkInventory(db),
  }),
  defineSeed({
    name: 'ops.legacy-sops',
    module: 'ops',
    dependsOn: ['core.departments'],
    description:
      'SOP registers (operations, online, marketing) + online coordinator SOP as DRAFT (OD-028)',
    run: ({ db }) => importLegacySops(db),
  }),
  defineSeed({
    name: 'ops.legacy-responsibilities',
    module: 'ops',
    description: '12 online role labels as responsibilities with no holder/backup (OD-009)',
    run: ({ db }) => importLegacyResponsibilities(db),
  }),
];
