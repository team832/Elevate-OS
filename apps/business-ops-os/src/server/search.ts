/**
 * One search box for Admissions (GET /ops/search): leads, demo students, applications and students
 * by name or reference; by phone or email only with `ops:student_private:read` (normalised by
 * ./students contactCondition, audited with a masked value like the student contact search).
 * Each group keeps its module's read permission and own scope; a group the caller cannot read
 * is left out.
 */
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { can, type Permission } from '@elevate/authorization';
import {
  opsAdmissions,
  opsApplications,
  opsDemos,
  opsLeads,
  students,
  type Database,
} from '@elevate/database';
import { maskPhone } from '../domain/student-lifecycle';
import { ownAdmissionFilter } from './admissions';
import { accessScope, type AccessScope, type Actor } from './context';
import { ownDemoFilter } from './demos-read';
import { opsAudit } from './ops-common';
import { caseFilter, contactCondition, pastCase, studentViewFilter } from './students';

export const SEARCH_LIMIT = 10;

/** Trimmed query (≤ 100 chars); `contact` when it looks like an email (a@b.c) or a phone (≥ 4 digits). */
export function parseSearch(raw: string | undefined) {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const contact =
    /^\S+@\S+\.\S+$/.test(text) ||
    (/^[\d\s()+.-]+$/.test(text) && text.replace(/\D/g, '').length >= 4);
  return { text, contact };
}

type Hit = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  status: string | null;
  isSample: boolean | null;
  past?: boolean;
};

/** First SEARCH_LIMIT hits of a group, and whether there were more. */
export const toGroup = <K extends string>(key: K, rows: Hit[]) => ({
  key,
  hits: rows.slice(0, SEARCH_LIMIT),
  more: rows.length > SEARCH_LIMIT,
});

const like = (text: string) => `%${text.replace(/[%_\\]/g, '\\$&')}%`;
const phone = opsLeads.studentPhone;

type Match = (cols: AnyPgColumn[]) => SQL;
const GROUPS: [
  key: 'leads' | 'demos' | 'applications' | 'students',
  permission: Permission,
  query: (db: Database, access: AccessScope, match: Match) => Promise<Hit[]>,
][] = [
  [
    'leads',
    'ops:leads:read',
    // One row per lead, with its most recently changed case's status.
    (db, access, match) =>
      db
        .selectDistinctOn([opsLeads.studentName, opsLeads.id], {
          id: opsLeads.id,
          name: opsLeads.studentName,
          code: opsLeads.code,
          phone,
          status: opsAdmissions.status,
          isSample: opsLeads.isSample,
        })
        .from(opsLeads)
        .leftJoin(opsAdmissions, eq(opsAdmissions.leadId, opsLeads.id))
        .where(
          and(
            isNull(opsLeads.mergedIntoLeadId),
            ownAdmissionFilter(access),
            match([opsLeads.studentName, opsLeads.code]),
          ),
        )
        .orderBy(opsLeads.studentName, opsLeads.id, desc(opsAdmissions.updatedAt))
        .limit(SEARCH_LIMIT + 1),
  ],
  [
    'demos',
    'ops:leads:read',
    (db, access, match) =>
      db
        .select({
          id: opsDemos.id,
          name: opsLeads.studentName,
          code: opsAdmissions.code,
          phone,
          status: opsDemos.outcome,
          isSample: opsLeads.isSample,
        })
        .from(opsDemos)
        .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
        .where(
          and(
            ownDemoFilter(access),
            match([opsLeads.studentName, opsAdmissions.code, opsLeads.code]),
          ),
        )
        .orderBy(asc(opsLeads.studentName), desc(opsDemos.createdAt))
        .limit(SEARCH_LIMIT + 1),
  ],
  [
    'applications',
    'ops:admissions:read',
    (db, access, match) =>
      db
        .select({
          id: opsApplications.id,
          name: students.fullName,
          code: opsApplications.reference,
          phone,
          status: opsApplications.status,
          isSample: students.isSample,
        })
        .from(opsApplications)
        .innerJoin(students, eq(students.id, opsApplications.studentId))
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsApplications.admissionId))
        .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
        .where(
          and(ownAdmissionFilter(access), match([students.fullName, opsApplications.reference])),
        )
        .orderBy(asc(students.fullName), desc(opsApplications.updatedAt))
        .limit(SEARCH_LIMIT + 1),
  ],
  [
    'students',
    'ops:students:read',
    (db, access, match) =>
      db
        .select({
          id: opsAdmissions.id,
          name: opsLeads.studentName,
          code: sql<string>`coalesce(${opsAdmissions.admissionNumber}, ${opsAdmissions.code})`,
          phone,
          status: opsAdmissions.status,
          isSample: students.isSample,
          past: sql<boolean>`${pastCase()}`,
        })
        .from(opsAdmissions)
        .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
        .leftJoin(students, eq(students.id, opsAdmissions.studentId))
        .where(
          and(
            studentViewFilter(db, 'directory', undefined, caseFilter(db, {}, access)),
            match([
              opsLeads.studentName,
              opsAdmissions.code,
              opsAdmissions.admissionNumber,
              opsLeads.code,
            ]),
          ),
        )
        .orderBy(asc(opsLeads.studentName), desc(opsAdmissions.updatedAt))
        .limit(SEARCH_LIMIT + 1),
  ],
];

/**
 * Up to SEARCH_LIMIT hits per group the caller may read. A contact-shaped query without
 * `ops:student_private:read` searches names and references only (`contactDenied`).
 * Phones are returned masked, and only to holders of that permission.
 */
export async function globalSearch(db: Database, actor: Actor, raw: string, requestId?: string) {
  const { text, contact: contactShaped } = parseSearch(raw);
  if (text.length < 2) return { text, groups: [], contactDenied: false };
  const privateAccess = can(actor, 'ops:student_private:read');
  const contact = contactShaped && privateAccess ? contactCondition(db, text) : null;
  const pattern = like(text);
  const match: Match = (cols) => or(...cols.map((c) => ilike(c, pattern)), contact?.sql) as SQL;
  const groups = await Promise.all(
    GROUPS.filter(([, permission]) => can(actor, permission)).map(async ([key, permission, q]) => {
      const rows = await q(db, await accessScope(db, actor, permission), match);
      return toGroup(
        key,
        rows.map((r) => ({ ...r, phone: privateAccess ? maskPhone(r.phone) : null })),
      );
    }),
  );
  if (contact)
    await opsAudit('student_search')(
      db,
      actor,
      null,
      'student.contact_search',
      {
        metadata: {
          kind: contact.kind,
          value: contact.masked,
          view: 'global_search',
          results: groups.reduce((n, g) => n + g.hits.length, 0),
        },
      },
      requestId,
    );
  return { text, groups, contactDenied: contactShaped && !privateAccess };
}

/** Whether the caller can read at least one search group (shows the top-bar box). */
export const searchable = (actor: Actor) => GROUPS.some(([, permission]) => can(actor, permission));
