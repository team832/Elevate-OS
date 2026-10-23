/**
 * Conflict-of-interest rule for raw feedback (ruling M2): nobody reads raw feedback about
 * themselves. An import's rows about the reader are redacted, its source file is refused to
 * anyone the import may be about, and evidence on a row about the reader is refused to them.
 * "About" is what was stored, never names matched again on read: every candidate saved at preview,
 * remap or commit (a shared name is about every person who has it; the set only grows) plus the
 * committed row's teacher. Kept apart from feedback-import.ts so the attachment access table can
 * use it without an import cycle.
 */
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { scopeFor, type Permission } from '@elevate/authorization';
import {
  opsStaffSubjectCapabilities as capabilities,
  opsStudentTeacherFeedback as feedback,
  opsTeacherFeedbackImportRows as importRows,
  opsTeacherFeedbackImports as imports,
  type Database,
  type OpsStudentTeacherFeedbackId,
  type OpsTeacherFeedbackImportId,
} from '@elevate/database';
import { ABOUT_KEY, aboutOf } from '../domain/feedback-import';
import { ForbiddenError } from '@elevate/shared-contracts';
import { accessScope, staffIdForUser, type Actor } from './context';

export const ABOUT_YOU = 'Row about you — hidden.';
export const CONFLICTED = "Feedback about teachers is handled by HR staff who don't teach.";

/** Round 7: anyone who teaches (teacher role, or any subject capability) is conflicted. */
export async function isConflicted(db: Database, user: Actor) {
  if (user.roles.includes('teacher')) return true;
  const me = await staffIdForUser(db, user.id);
  if (!me) return false;
  const [cap] = await db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(eq(capabilities.staffId, me))
    .limit(1);
  return !!cap;
}

/** Every entry point to raw feedback about teachers: the permission, then the conflict rule. */
export async function feedbackScope(db: Database, user: Actor, permission: Permission) {
  const scope = await accessScope(db, user, permission);
  if (await isConflicted(db, user)) throw new ForbiddenError(CONFLICTED);
  return scope;
}

/** An import's rows (file order) with the staff ids each may be about; null = no such import. */
export async function rowsAbout(db: Database, importId: string) {
  const id = importId as OpsTeacherFeedbackImportId;
  const [imp] = await db.select({ id: imports.id }).from(imports).where(eq(imports.id, id));
  if (!imp) return null;
  const rows = await db
    .select({ r: importRows, teacher: feedback.teacherStaffId })
    .from(importRows)
    .leftJoin(feedback, eq(feedback.id, importRows.feedbackId))
    .where(eq(importRows.importId, id))
    .orderBy(asc(importRows.rowNumber));
  return rows.map(({ r, teacher }) => {
    const { [ABOUT_KEY]: _stored, ...raw } = r.raw;
    return { ...r, raw, about: [...aboutOf(r.raw), ...(teacher ? [teacher as string] : [])] };
  });
}

/** Rows as a reader may see them: rows that may be about the reader keep only number and outcome. */
export const redactFor = <R extends { raw: unknown; messages: string[]; about: string[] }>(
  rows: readonly R[],
  me: string | null,
) =>
  rows.map(({ about, ...r }) =>
    me && about.includes(me) ? { ...r, raw: {}, messages: [ABOUT_YOU] } : r,
  );

/**
 * Raw feedback rows a reader may see (round 8): none about them, whether they are the row's teacher
 * or an imported row's stored about-set names them. Used by every raw read.
 */
export const notAboutViewer = (me: string | null) =>
  me
    ? and(
        ne(feedback.teacherStaffId, me as never),
        sql`not exists (select 1 from ${importRows} where ${importRows.feedbackId} = ${feedback.id} and ${importRows.raw} -> ${ABOUT_KEY} @> jsonb_build_array(${me}::text))`,
      )
    : undefined;

/** True when any row may be about `me` (each entry: the staff ids one row may be about). */
export const isAbout = (me: string | null, about: readonly (readonly string[])[]) =>
  !!me && about.some((ids) => ids.includes(me));

/**
 * Source-file access for an import (owner kind `feedback_import`), asked once per check: the
 * attachment table picks the field it needs. No Promise.all: `db` may be a transaction.
 */
async function feedbackImportAccess(db: Database, user: Actor, importId: string) {
  const rows = await rowsAbout(db, importId);
  const aboutMe = isAbout(await staffIdForUser(db, user.id), rows?.map((r) => r.about) ?? []);
  return {
    canRead: rows !== null && !aboutMe && scopeFor(user, 'ops:teacher_feedback:read') === 'all',
    // Another HR person handles an import about you, its files included (round 6).
    canWrite: rows !== null && !aboutMe && scopeFor(user, 'ops:teacher_feedback:import') === 'all',
  };
}

/** Evidence access for one feedback row (owner kind `feedback_evidence`). */
async function feedbackEvidenceAccess(db: Database, user: Actor, feedbackId: string) {
  const [row] = await db
    .select({ teacher: feedback.teacherStaffId })
    .from(feedback)
    .where(eq(feedback.id, feedbackId as OpsStudentTeacherFeedbackId));
  const clear = !!row && row.teacher !== (await staffIdForUser(db, user.id));
  const manage = scopeFor(user, 'ops:teacher_feedback:manage') === 'all';
  return {
    canRead: clear && (manage || scopeFor(user, 'ops:teacher_feedback:read') === 'all'),
    canWrite: clear && manage,
  };
}

/**
 * The rules in the shape of the attachment access table (`access` answers every mode at once);
 * conflicted people get nothing.
 */
const rule = (check: typeof feedbackImportAccess) => {
  const access = async (db: Database, user: Actor, id: string) =>
    (await isConflicted(db, user)) ? { canRead: false, canWrite: false } : check(db, user, id);
  return {
    access,
    canRead: async (db: Database, user: Actor, id: string) => (await access(db, user, id)).canRead,
    canWrite: async (db: Database, user: Actor, id: string) =>
      (await access(db, user, id)).canWrite,
  };
};
export const feedbackImportRule = rule(feedbackImportAccess);
export const feedbackEvidenceRule = rule(feedbackEvidenceAccess);
