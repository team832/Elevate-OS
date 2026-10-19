/** Picker options for forms (staff, programmes, lead sources, departments). Reference data only. */
import { asc, eq, ne } from 'drizzle-orm';
import {
  departments,
  opsLeadSources,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';

export async function formOptions(db: Database) {
  const [staff, progs, sources, depts] = await Promise.all([
    db
      .select({ id: staffMembers.id, fullName: staffMembers.fullName })
      .from(staffMembers)
      .where(eq(staffMembers.status, 'active'))
      .orderBy(asc(staffMembers.fullName)),
    db
      .select({ code: programmes.code, name: programmes.name, status: programmes.status })
      .from(programmes)
      .where(ne(programmes.status, 'retired'))
      .orderBy(asc(programmes.code)),
    db
      .select({ code: opsLeadSources.code, label: opsLeadSources.label })
      .from(opsLeadSources)
      .where(eq(opsLeadSources.status, 'active'))
      .orderBy(asc(opsLeadSources.sortOrder)),
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(ne(departments.status, 'archived'))
      .orderBy(asc(departments.name)),
  ]);
  return {
    staff: staff.map((s) => ({ value: s.id as string, label: s.fullName })),
    programmes: progs.map((p) => ({
      value: p.code,
      label: `${p.code} — ${p.name}${p.status !== 'active' ? ` (${p.status})` : ''}`,
    })),
    sources: sources.map((s) => ({ value: s.code, label: s.label })),
    departments: depts.map((d) => ({ value: d.id as string, label: d.name })),
  };
}
