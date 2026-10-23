/**
 * Lookups shared by feedback entry and import (brief 23 Oct 2026 §15): the feedback settings,
 * teachers by staff code or exact name, and each teacher's batches from Academic OS
 * (teacher_activity contract; "Source unavailable" when it cannot be read — never guessed).
 */
import { eq, inArray } from 'drizzle-orm';
import { opsAdmissions, opsStaffProfiles, staffMembers, type Database } from '@elevate/database';
import { addDays, istToday } from '../domain/dates';
import type { BatchMatch } from '../domain/feedback-import';
import { fetchTeacherActivity } from './academic-summary';
import { loadSettings } from './settings';

export async function feedbackPolicy(db: Database) {
  const s = await loadSettings(db);
  return {
    scaleMax: s['feedback.rating_scale'].value.max,
    categories: s['feedback.categories'].value.categories,
    minGroupSize: s['feedback.min_group_size'].value.size,
    teacherVisibility: s['feedback.teacher_visibility'].value.show,
  };
}
export type FeedbackPolicy = Awaited<ReturnType<typeof feedbackPolicy>>;

const key = (s: string) => s.trim().toLowerCase();
/** Text as space-separated lower-case words, padded, for whole-word matching. */
const words = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

/**
 * Resolver for "staff code or exact full name" (case-insensitive): `candidates(ref)` lists every
 * staff member the reference could mean (a code matches one; a shared name matches several);
 * `resolve(ref)` is the one match, 'ambiguous' or null; `mentions(text)` lists everyone whose full
 * name or staff code appears in the text as whole words. shortcut: loads every staff row (tens of
 * people); page it if staff grows large.
 */
export async function teacherResolver(db: Database) {
  const rows = await db
    .select({ id: staffMembers.id, name: staffMembers.fullName, code: opsStaffProfiles.staffCode })
    .from(staffMembers)
    .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id));
  const candidates = (ref: string): string[] => {
    const byCode = rows.find((r) => r.code && key(r.code) === key(ref));
    return byCode ? [byCode.id] : rows.filter((r) => key(r.name) === key(ref)).map((r) => r.id);
  };
  const resolve = (ref: string): string | 'ambiguous' | null => {
    const ids = candidates(ref);
    return ids.length === 1 ? ids[0]! : ids.length ? 'ambiguous' : null;
  };
  const mentions = (text: string): string[] => {
    const t = words(text);
    return rows
      .filter((r) => [r.name, r.code].some((v) => v && words(v).trim() && t.includes(words(v))))
      .map((r) => r.id);
  };
  return { candidates, resolve, mentions };
}

/** Core student id per admission number (exact). */
export async function studentsByAdmissionNumber(db: Database, numbers: readonly string[]) {
  const unique = [...new Set(numbers.filter(Boolean))];
  const rows = unique.length
    ? await db
        .select({ n: opsAdmissions.admissionNumber, studentId: opsAdmissions.studentId })
        .from(opsAdmissions)
        .where(inArray(opsAdmissions.admissionNumber, unique))
    : [];
  return new Map(rows.map((r) => [r.n!, r.studentId as string | null]));
}

type Assignment = { batchCode: string; subjectName: string; batchId?: string; subjectId?: string };
export type TeacherBatches =
  { status: 'available'; assignments: Assignment[] } | { status: 'unavailable'; reason: string };

/** Each teacher's Academic assignments (all of them; one internal call per teacher). */
export async function teacherBatches(staffIds: readonly string[], now = new Date()) {
  const to = istToday(now);
  const window = { from: addDays(to, -29), to };
  const unique = [...new Set(staffIds)];
  const results = await Promise.all(unique.map((id) => fetchTeacherActivity(id, window)));
  return new Map<string, TeacherBatches>(
    unique.map((id, i) => {
      const r = results[i]!;
      return [
        id,
        r.status === 'available'
          ? // shortcut: batchId/subjectId are read when Academic adds them to the contract (IR to ACAD); until then only codes and names are stored.
            { status: 'available', assignments: r.data.assignments as Assignment[] }
          : { status: 'unavailable', reason: r.reason },
      ];
    }),
  );
}

/** Match a batch code (and subject, when given) against a teacher's assignments. */
export function matchBatch(
  batches: TeacherBatches | undefined,
  batchCode: string,
  subject: string | null,
): BatchMatch {
  if (!batches || batches.status === 'unavailable')
    return {
      ok: false,
      message: `Batch could not be checked: Academic OS is unavailable${batches ? ` (${batches.reason})` : ''}.`,
    };
  const inBatch = batches.assignments.filter((a) => key(a.batchCode) === key(batchCode));
  if (!inBatch.length)
    return {
      ok: false,
      message: `This teacher has no assignment in batch “${batchCode}” in Academic OS.`,
    };
  const pick = subject
    ? inBatch.find((a) => key(a.subjectName) === key(subject))
    : new Set(inBatch.map((a) => a.subjectName)).size === 1
      ? inBatch[0]
      : undefined;
  if (subject && !pick)
    return {
      ok: false,
      message: `This teacher does not teach “${subject}” in batch “${inBatch[0]!.batchCode}”.`,
    };
  return {
    ok: true,
    batchCode: inBatch[0]!.batchCode,
    subjectName: pick?.subjectName ?? null,
    batchId: pick?.batchId ?? inBatch[0]!.batchId ?? null,
    subjectId: pick?.subjectId ?? null,
  };
}

/** Options for the entry form's batch select ("CODE|Subject"); null = Academic unavailable. */
export async function batchOptions(staffId: string) {
  const b = (await teacherBatches([staffId])).get(staffId)!;
  return b.status === 'unavailable'
    ? null
    : b.assignments.map((a) => ({
        value: `${a.batchCode}|${a.subjectName}`,
        label: `${a.batchCode} · ${a.subjectName}`,
      }));
}
