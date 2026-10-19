import { describe, expect, it } from 'vitest';
import operationsWorkbook from '../../../../data/legacy/ops/operations-workbook.json';
import rolesFile from '../../../../data/legacy/ops/roles.json';
import sopsFile from '../../../../data/legacy/ops/sops.json';
import {
  isLegacyCode,
  legacyCode,
  mapLegacyDecisions,
  mapLegacyRoles,
  mapLegacyWorkInventory,
  mapOperationsSopRegister,
  mapSopsFile,
} from '../../src/domain';

describe('legacy importers (A-13)', () => {
  it('namespaces codes so they never collide with Elevate OS codes or requirement IDs', () => {
    expect(legacyCode('OPSWB', 'D-003')).toBe('LEGACY-OPSWB-D-003');
    expect(legacyCode('online', 'on 01')).toBe('LEGACY-ONLINE-ON-01');
    expect(isLegacyCode('LEGACY-OPSWB-OP-001')).toBe(true);
    expect(isLegacyCode('OPS-001')).toBe(false);
  });

  it('imports all 24 decisions with their original status (8 open, 3 provisional)', () => {
    const decisions = mapLegacyDecisions(operationsWorkbook);
    expect(decisions).toHaveLength(24);
    expect(decisions.filter((d) => d.state === 'open')).toHaveLength(8);
    expect(decisions.filter((d) => d.state === 'provisional')).toHaveLength(3);
    const d003 = decisions.find((d) => d.code === 'LEGACY-OPSWB-D-003');
    expect(d003).toMatchObject({ state: 'confirmed', legacyStatus: 'Confirmed', area: 'Demo' });
    expect(decisions.find((d) => d.code === 'LEGACY-OPSWB-D-005')).toMatchObject({ state: 'open' });
    expect(new Set(decisions.map((d) => d.code)).size).toBe(24);
  });

  it('rejects an unknown legacy status instead of guessing', () => {
    const broken = JSON.parse(JSON.stringify(operationsWorkbook)) as {
      records: { sheet: string; rows: { Status: string }[] }[];
    };
    const sheet = broken.records.find((r) => r.sheet === 'Decisions');
    if (sheet?.rows[0]) sheet.rows[0].Status = 'Maybe';
    expect(() => mapLegacyDecisions(broken)).toThrow(/Unknown legacy decision status/);
  });

  it('imports the 25-row work inventory with mapped and verbatim status', () => {
    const items = mapLegacyWorkInventory(operationsWorkbook);
    expect(items).toHaveLength(25);
    expect(items[0]).toMatchObject({
      code: 'LEGACY-OPSWB-OP-001',
      status: 'documented',
      legacyStatus: 'Discussed',
    });
    expect(items.find((i) => i.code === 'LEGACY-OPSWB-OP-003')).toMatchObject({
      status: 'planned',
    });
  });

  it('SOP registers: 25 operations + 16 online + 9 marketing + the coordinator SOP; none approved', () => {
    const ops = mapOperationsSopRegister(operationsWorkbook);
    const others = mapSopsFile(sopsFile);
    expect(ops).toHaveLength(25);
    expect(others.filter((s) => s.code.startsWith('LEGACY-ONLINE-ON-'))).toHaveLength(16);
    expect(others.filter((s) => s.code.startsWith('LEGACY-MKTEASY-'))).toHaveLength(9);
    const all = [...ops, ...others];
    expect(new Set(all.map((s) => s.code)).size).toBe(all.length);
    expect(all.every((s) => s.status === 'not_drafted' || s.status === 'draft')).toBe(true);
    // DI-21: SOP-001 means different things in different registers — namespacing keeps both.
    expect(ops[0]).toMatchObject({
      code: 'LEGACY-OPSWB-SOP-001',
      title: 'Lead generation',
      status: 'not_drafted',
    });
  });

  it('the online coordinator SOP enters as a DRAFT version 0.1 dated 2026-09-18 (OD-028)', () => {
    const coord = mapSopsFile(sopsFile).find((s) => s.code === 'LEGACY-ONLINE-SOP-COORDINATOR');
    expect(coord).toMatchObject({ status: 'draft', departmentCode: 'STUDENT_SUCCESS' });
    expect(coord?.version).toMatchObject({ label: '0.1', sourceDate: '2026-09-18' });
    // Blank form lines ("Assigned staff: ____") are not steps and no names are filled in.
    expect(coord?.version?.checklist.some((c) => /_{4,}/.test(c.text))).toBe(false);
    expect(coord?.version?.content).toContain('[blank in source');
    expect(coord?.version?.checklist.length).toBeGreaterThan(30);
  });

  it('online roles become responsibilities with no holder or backup (names blank, OD-009)', () => {
    const r = mapLegacyRoles(rolesFile);
    expect(r).toHaveLength(12);
    expect(r[0]).toMatchObject({
      code: 'LEGACY-ONLINE-ROLE-01',
      accountableRole: 'Marketing Lead',
    });
  });
});
