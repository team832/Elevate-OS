/**
 * Who may see, add or remove files on each kind of record (R6): one rule per owner kind, and
 * each rule asks the owning module's own access function rather than re-implementing it.
 * Used by server/attachments.ts on every list, upload, download and delete.
 */
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { can, scopeFor, type Permission } from '@elevate/authorization';
import {
  type OPS_ATTACHMENT_OWNER_KINDS,
  opsAttendanceCorrections,
  opsEodReports,
  opsLeaveApplications,
  opsStaffTasks,
  opsTaskSubmissions,
  opsTaskUpdates,
  staffMembers,
  type Database,
} from '@elevate/database';
import { isAppError } from '@elevate/shared-contracts';
import { mayApproveLeave } from '../domain/leave';
import { EOD_EDITABLE, type EodStatus } from '../domain/staff-tasks';
import { coverPrincipals } from './approval-cover';
import { accessScope, scopeCovers, staffIdForUser, type Actor } from './context';
import { assessmentFileAccess } from './assessment-file-access';
import { manage } from './attendance-actions';
import { readerOf } from './eod-reports';
import { feedbackEvidenceRule, feedbackImportRule } from './feedback-access';
import { hrRequestFileAccess } from './hr-requests-read';
import { canDecideLeave } from './leave-applications';
import { loadSettings } from './settings';
import { loadTaskFor, mayLogWork } from './task-store';

export type AttachmentOwnerKind = (typeof OPS_ATTACHMENT_OWNER_KINDS)[number];
type Check = (db: Database, user: Actor, ownerId: string) => Promise<boolean>;
/**
 * `canManage` (remove anyone's file) defaults to `canWrite`; `closed` = why no new files.
 * `access`, when given, answers read and write (= manage) in one check, asked once per call.
 */
export interface OwnerRule {
  canRead: Check;
  canWrite: Check;
  canManage?: Check;
  access?: (
    db: Database,
    user: Actor,
    ownerId: string,
  ) => Promise<Record<'canRead' | 'canWrite', boolean>>;
  closed?: (db: Database, ownerId: string) => Promise<string | null>;
}

export const first = async <T>(rows: Promise<T[]>) => (await rows)[0];

/** A module's 403/404 refusal as `null`; any other error still throws. */
const orNull = <T>(p: Promise<T>): Promise<T | null> =>
  p.catch((e: unknown) => {
    if (isAppError(e) && (e.status === 403 || e.status === 404)) return null;
    throw e;
  });

/** The task module's loader (visibility, collaborators, HR scope); null when it refuses. */
const task = (db: Database, user: Actor, id: string | undefined, write: boolean) =>
  id ? orNull(loadTaskFor(db, user, id, write)) : Promise.resolve(null);

/**
 * The status `closed` reads, FOR SHARE: inside the upload's transaction a decision being made (its
 * path locks this row for update) is waited for and then seen, so no file lands after it (M4).
 */
async function statusOf<T extends PgTable & { id: PgColumn; status: PgColumn }>(
  db: Database,
  table: T,
  id: string,
) {
  const [row] = await db
    .select({ status: table.status })
    .from(table as PgTable)
    .where(eq(table.id, id))
    .limit(1)
    .for('share');
  return row?.status as string | undefined;
}

const taskRule = {
  canRead: async (db: Database, user: Actor, id?: string) => !!(await task(db, user, id, false)),
  /** The rule for logging work (task-updates.ts): anyone but a mere reviewer, or the backup. */
  canWrite: async (db: Database, user: Actor, id?: string) => {
    const t = await task(db, user, id, true);
    return !!t && mayLogWork(t);
  },
  /** The owner's manager chain or all scope; never a reviewer or creator by that role alone. */
  canManage: async (db: Database, user: Actor, id?: string) => {
    const t = await task(db, user, id, true);
    return !!t && t.roles.some((r) => r === 'manager' || r === 'admin');
  },
  closed: async (db: Database, id?: string) => {
    const status = id ? await statusOf(db, opsStaffTasks, id) : undefined;
    return status === 'done' || status === 'cancelled'
      ? 'This task is finished or cancelled, so no files can be added. Reopen it first.'
      : null;
  },
};

/** A submission or work update: read with its task; files added only by its author. */
const taskChild = (
  load: (db: Database, id: string) => Promise<{ taskId: string; by: string } | undefined>,
): OwnerRule => ({
  canRead: async (db, user, id) => taskRule.canRead(db, user, (await load(db, id))?.taskId),
  canWrite: async (db, user, id) => {
    const c = await load(db, id);
    return !!c && c.by === user.id && (await taskRule.canWrite(db, user, c.taskId));
  },
  canManage: async (db, user, id) => taskRule.canManage(db, user, (await load(db, id))?.taskId),
  closed: async (db, id) => taskRule.closed(db, (await load(db, id))?.taskId),
});

async function exists<T extends PgTable & { id: PgColumn }>(db: Database, table: T, id: string) {
  const rows = await db
    .select()
    .from(table as PgTable)
    .where(eq(table.id, id))
    .limit(1);
  return rows.length > 0;
}

/** Records only all-scope HR permissions open (raw feedback, staff-private details). */
const byPermission = <T extends PgTable & { id: PgColumn }>(
  table: T,
  read: Permission,
  write: Permission,
): OwnerRule => ({
  canRead: async (db, user, id) => scopeFor(user, read) === 'all' && (await exists(db, table, id)),
  canWrite: async (db, user, id) =>
    scopeFor(user, write) === 'all' && (await exists(db, table, id)),
});

const correction = (db: Database, id: string) =>
  first(
    db
      .select({
        staffId: opsAttendanceCorrections.staffId,
        status: opsAttendanceCorrections.status,
      })
      .from(opsAttendanceCorrections)
      .where(eq(opsAttendanceCorrections.id, id))
      .limit(1),
  );
/** The attendance services' rule (attendance-corrections.ts): all, or own = your staff record. */
async function coversCorrection(db: Database, user: Actor, id: string, permission: Permission) {
  const c = await correction(db, id);
  const access = c ? await orNull(accessScope(db, user, permission)) : null;
  return !!c && !!access && scopeCovers(access, [c.staffId]);
}

type AccessFn = NonNullable<OwnerRule['access']>;
/** A rule decided by one access function (the owning record's own). */
const byAccess = (access: AccessFn): OwnerRule => ({
  access,
  canRead: async (db, user, id) => (await access(db, user, id)).canRead,
  canWrite: async (db, user, id) => (await access(db, user, id)).canWrite,
});

const report = (db: Database, id: string) =>
  first(
    db
      .select()
      .from(opsEodReports)
      .where(eq(opsEodReports.id, id as never))
      .limit(1),
  );

const leave = (db: Database, id: string) =>
  first(
    db
      .select({ staffId: opsLeaveApplications.staffId })
      .from(opsLeaveApplications)
      .where(eq(opsLeaveApplications.id, id))
      .limit(1),
  );
/**
 * A leave letter or certificate is as private as the leave reason (domain/leave.ts): the applicant
 * adds and reads it; whoever may decide the application reads it, by the deciding rule: a leave
 * approver (hr.leave_approver) inside HR's staff scope, or their cover today (F4-10) with the
 * approver's reach, never on the approver's own application.
 */
const leaveFiles: AccessFn = async (db, user, id) => {
  const a = await leave(db, id);
  const mine = !!a && a.staffId === (await staffIdForUser(db, user.id));
  if (!a || mine || !(await canDecideLeave(db, user))) return { canRead: mine, canWrite: mine };
  // manage refuses outside the person's reach (404) and their own record (403).
  const reaches = async (p: Actor) =>
    (await orNull(manage(db, p, a.staffId).then(() => true))) === true;
  const who = (await loadSettings(db))['hr.leave_approver'].value.who;
  let approver = mayApproveLeave(user.roles, who) && (await reaches(user));
  for (const p of approver ? [] : await coverPrincipals(db, user.id, 'leave'))
    approver ||= await reaches(p);
  return { canRead: approver, canWrite: false };
};

export const ATTACHMENT_ACCESS: Record<AttachmentOwnerKind, OwnerRule> = {
  task: taskRule,
  task_submission: {
    ...taskChild((db, id) =>
      first(
        db
          .select({ taskId: opsTaskSubmissions.taskId, by: opsTaskSubmissions.submittedByUserId })
          .from(opsTaskSubmissions)
          .where(eq(opsTaskSubmissions.id, id as never))
          .limit(1),
      ),
    ),
    // N1: a submitted version is frozen; its files arrive only by submitting (task-submissions).
    canWrite: async () => false,
  },
  task_update: taskChild((db, id) =>
    first(
      db
        .select({ taskId: opsTaskUpdates.taskId, by: opsTaskUpdates.authorUserId })
        .from(opsTaskUpdates)
        .where(eq(opsTaskUpdates.id, id as never))
        .limit(1),
    ),
  ),
  attendance_correction: {
    canRead: (db, user, id) => coversCorrection(db, user, id, 'ops:attendance:read'),
    canWrite: (db, user, id) => coversCorrection(db, user, id, 'ops:attendance:request'),
    canManage: async (db, user, id) =>
      can(user, 'ops:attendance:manage') && !!(await correction(db, id)),
    closed: async (db, id) =>
      (await statusOf(db, opsAttendanceCorrections, id)) === 'pending'
        ? null
        : 'This correction request has been decided, so no files can be added.',
  },
  feedback_import: feedbackImportRule, // FB: also refused to anyone the import is about (M2)
  feedback_evidence: feedbackEvidenceRule, // FB: never about the reader (M2)
  work_report: {
    canRead: async (db, user, id) => {
      const r = await report(db, id);
      return !!r && (await orNull(readerOf(db, user, r).then(() => true))) === true;
    },
    canWrite: async (db, user, id) => {
      const r = await report(db, id);
      return !!r && r.staffId === (await staffIdForUser(db, user.id));
    },
    closed: async (db, id) =>
      EOD_EDITABLE.includes((await statusOf(db, opsEodReports, id)) as EodStatus)
        ? null
        : 'This report has been submitted. Files can be added while it is a draft or when changes are requested.',
  },
  staff_private: byPermission(staffMembers, 'ops:staff_private:read', 'ops:staff_private:manage'),
  hr_request: byAccess(hrRequestFileAccess), // HR-REQ: sender, HR scope; recipient only HR's shared files
  assessment_paper: byAccess(assessmentFileAccess('assessment_paper')),
  assessment_key: byAccess(assessmentFileAccess('assessment_key')),
  score_import: byAccess(assessmentFileAccess('score_import')),
  leave_application: {
    ...byAccess(leaveFiles),
    closed: async (db, id) =>
      (await statusOf(db, opsLeaveApplications, id)) === 'pending'
        ? null
        : 'This leave application has been decided or cancelled, so no files can be added.',
  },
};
