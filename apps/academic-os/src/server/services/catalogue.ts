/**
 * The Curriculum page's lists (owner inspection, 31 Oct 2026). A teacher starts on the courses they
 * teach and can open the whole catalogue when `academic:courses:read` is held at `all`. Filters and
 * counts come from one pass over the same rows, so a count always equals its list. Superseded plan
 * versions stay out until asked for. Nothing here reads more than the existing course and plan lists.
 */
import { asc } from 'drizzle-orm';
import { scopeFor } from '@elevate/authorization';
import { academicSubjects, type Database } from '@elevate/database';
import { PLAN_STATUSES } from '../../domain';
import { staffIdForUser, type Actor } from '../context';
import { listAssignmentsFor } from './assignments';
import { listBatches } from './batches';
import { listCourses, listPlans } from './curriculum';

export const COURSE_STATUSES = ['active', 'draft', 'paused', 'archived'] as const;
export const CATALOGUE_VIEWS = ['mine', 'all'] as const;
type View = (typeof CATALOGUE_VIEWS)[number];

const oneOf = <T extends string>(list: readonly T[], value: string | undefined) => list.find((v) => v === value);

export type CatalogueQuery = { view?: string; q?: string; subject?: string; batchId?: string; status?: string };

export async function curriculumCatalogue(db: Database, actor: Actor, query: CatalogueQuery) {
  const [courses, plans, subjects] = [
    await listCourses(db),
    await listPlans(db),
    await db.select({ courseId: academicSubjects.courseId, code: academicSubjects.code, name: academicSubjects.name }).from(academicSubjects).orderBy(asc(academicSubjects.name)),
  ];
  const batchScope = scopeFor(actor.user, 'academic:batches:read');
  const batches = batchScope ? await listBatches(db, actor) : [];
  const own = batchScope === 'own';
  const staffId = own ? await staffIdForUser(db, actor.user.id) : null;
  const assigned = staffId ? await listAssignmentsFor(db, { staffIds: [staffId] }) : [];
  const myCourses = new Set(assigned.map((a) => a.courseId as string));
  const myBatches = new Set(batches.map((b) => b.id as string));

  const views: readonly View[] = own ? (scopeFor(actor.user, 'academic:courses:read') === 'all' ? ['mine', 'all'] : ['mine']) : ['all'];
  const view = oneOf(views, query.view) ?? views[0]!;

  const subjectOptions = [...new Map(subjects.filter((s) => view === 'all' || assigned.some((a) => a.subjectCode === s.code && a.courseId === s.courseId)).map((s) => [s.code, { value: s.code, label: s.name }])).values()];
  const batchOptions = batches.map((b) => ({ value: b.id as string, label: `${b.name} (${b.code})` }));
  const subject = subjectOptions.find((o) => o.value === query.subject)?.value;
  const batch = batches.find((b) => b.id === query.batchId);
  const courseStatus = oneOf(COURSE_STATUSES, query.status);
  const planStatus = oneOf(PLAN_STATUSES, query.status);
  const needle = query.q?.trim().toLowerCase();
  const matches = (...fields: (string | null)[]) => !needle || fields.some((f) => f?.toLowerCase().includes(needle));

  const pass = (v: View) => {
    const shownCourses = courses.filter(
      (c) =>
        (v === 'all' || myCourses.has(c.id)) &&
        (!subject || subjects.some((s) => s.courseId === c.id && s.code === subject)) &&
        (!batch || c.id === batch.courseId) &&
        (!courseStatus || c.status === courseStatus),
    );
    const shownIds = new Set(shownCourses.map((c) => c.id as string));
    const named = new Set(shownCourses.filter((c) => matches(c.code, c.name, c.familyCode)).map((c) => c.id as string));
    const scoped = plans.filter(
      (p) =>
        shownIds.has(p.courseId) &&
        (v === 'all' || !p.batchId || myBatches.has(p.batchId)) &&
        (!batch || !p.batchId || p.batchId === batch.id) &&
        (named.has(p.courseId) || matches(p.code, p.title)),
    );
    const planRows = planStatus ? scoped.filter((p) => p.status === planStatus) : scoped.filter((p) => p.status !== 'superseded');
    const withPlan = new Set(planRows.map((p) => p.courseId as string));
    return {
      courses: shownCourses.filter((c) => (planStatus ? withPlan.has(c.id) : named.has(c.id) || withPlan.has(c.id))),
      plans: planRows,
      /** Superseded versions these filters would show, left out of this list. */
      supersededHidden: planStatus ? 0 : scoped.length - planRows.length,
    };
  };

  return {
    view,
    views,
    counts: Object.fromEntries(views.map((v) => [v, pass(v).courses.length])) as Partial<Record<View, number>>,
    ...pass(view),
    options: { subjects: subjectOptions, batches: batchOptions },
    selected: { subject, batchId: batch?.id as string | undefined, status: courseStatus ?? planStatus, q: needle ? query.q?.trim() : undefined },
    /** Unfiltered, for the coordinator's forms. */
    allCourses: courses,
    allPlans: plans,
  };
}
