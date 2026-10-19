/**
 * IPMAT curriculum from the legacy extracts (D-016: status labels preserved,
 * nothing seeded as delivered):
 * - IPMAT-BASE: the locked 253-class teaching baseline (approved 2026-09-10).
 * - IPMAT-C12-2027: the Class 12 accelerated override. Lineage: 313 classes
 *   (superseded) → 305 classes / 381.25 h (counts locked, dates provisional).
 * The plans are LEGACY IMPORTS: their lock was recorded in the legacy source,
 * not through an Elevate OS approval, so approvedByUserId is null and
 * sourceRef/legacyApprovedOn say where the decision is recorded.
 */
import { defineSeed } from '@elevate/database/seed';
import type { AcademicChapterId } from '@elevate/database';
import {
  IPMAT_SUBJECTS,
  pad2,
  readLegacy,
  sourceRef,
  type Class12Plan,
  type IpmatBaseline,
} from './legacy';
import { programmeId, upsertChapter, upsertCourse, upsertItems, upsertPlan, upsertSubject, type SeedItem } from './upsert';

const CLASS_MINUTES = 75; // BR-ACD-1: IPMAT teaching/practice classes are 75 minutes (locked).

export const ipmatBaselineSeed = defineSeed({
  name: 'academic.ipmat-baseline',
  module: 'academic',
  dependsOn: ['core.programmes'],
  description: 'IPMAT locked 253-class teaching baseline (course IPMAT-BASE, plan IPMAT-BASELINE-253)',
  async run({ db }) {
    const base = readLegacy<IpmatBaseline>('ipmat-baseline.json');
    const courseId = await upsertCourse(db, {
      programmeId: await programmeId(db, 'IPMAT'),
      code: 'IPMAT-BASE',
      familyCode: 'IPMAT-BASE',
      version: 1,
      name: 'Combined IIM entrance — teaching baseline template',
      description: 'Locked full-year teaching baseline (Quant 151, Verbal 57, LR 32, DI 13). A template: batch plans override it.',
      mode: null,
      classMinutes: CLASS_MINUTES,
      classMinutesStatus: 'locked',
      status: 'active',
      sourceRef: sourceRef('ipmat-baseline.json', 'locked_teaching_baseline'),
    });
    const blocks: { subject: string; title: string; classes: number; prefix: string }[] = [
      ...base.quant_teaching_blocks.map((b) => ({ subject: 'QUANT', title: b.block, classes: b.teaching_classes, prefix: 'Q' })),
      ...base.quant_higher_maths.map((b) => ({ subject: 'QUANT', title: `Higher maths: ${b.topic}`, classes: b.teaching_classes, prefix: 'HM' })),
      ...base.verbal_teaching_blocks.map((b) => ({ subject: 'VERBAL', title: b.block, classes: b.teaching_classes, prefix: 'V' })),
      ...base.lr_teaching_topics.map((b) => ({ subject: 'LR', title: b.topic, classes: b.teaching_classes, prefix: 'LR' })),
      ...base.di_teaching_topics.map((b) => ({ subject: 'DI', title: b.topic, classes: b.teaching_classes, prefix: 'DI' })),
    ];
    const subjectIds = new Map<string, Awaited<ReturnType<typeof upsertSubject>>>();
    for (const [i, s] of IPMAT_SUBJECTS.entries()) subjectIds.set(s.code, await upsertSubject(db, courseId, s.code, s.name, i));
    const counters = new Map<string, number>();
    const items: SeedItem[] = [];
    for (const [i, b] of blocks.entries()) {
      const n = (counters.get(b.prefix) ?? 0) + 1;
      counters.set(b.prefix, n);
      const code = `${b.prefix}-${pad2(n)}`;
      const chapterId = await upsertChapter(db, { courseId, subjectId: subjectIds.get(b.subject)!, code, title: b.title, sortOrder: i });
      items.push({ chapterId, lessonCode: `BASE-${code}`, sessionType: 'teaching', plannedClasses: b.classes, plannedMinutes: b.classes * CLASS_MINUTES });
    }
    const planId = await upsertPlan(db, {
      courseId,
      code: 'IPMAT-BASELINE-253',
      title: 'IPMAT locked teaching baseline — 253 classes',
      version: 1,
      status: 'locked',
      countsStatus: 'locked',
      datesStatus: 'unknown',
      classMinutes: CLASS_MINUTES,
      scopeNote: 'Teaching classes only (programme-level practice allocations are not part of this baseline). Locked for planning; not taught or verified delivery.',
      changeLog: 'Legacy import of the locked baseline recorded on 2026-09-10.',
      sourceRef: sourceRef('ipmat-baseline.json', 'locked_teaching_baseline + quant/verbal/lr/di blocks'),
      legacyApprovedOn: base.locked_teaching_baseline.approved_on,
    });
    await upsertItems(db, planId, items);
  },
});

export const ipmatClass12Seed = defineSeed({
  name: 'academic.ipmat-class12',
  module: 'academic',
  dependsOn: ['core.programmes'],
  description: 'IPMAT Class 12 course IPMAT-C12-2027: 104 chapters, plan 313 (superseded) → 305 (counts locked, dates provisional)',
  async run({ db }) {
    const plan = readLegacy<Class12Plan>('class12-plan.json');
    const courseId = await upsertCourse(db, {
      programmeId: await programmeId(db, 'IPMAT'),
      code: 'IPMAT-C12-2027',
      familyCode: 'IPMAT-C12',
      version: 1,
      name: 'IPMAT Class 12 — April 2027 cycle (provisional)',
      description: 'Class 12 accelerated override for this cohort only; never applied to Class 11, dropper or fast-track batches (BR-ACD-6).',
      mode: 'offline',
      classMinutes: CLASS_MINUTES,
      classMinutesStatus: 'locked',
      status: 'draft',
      sourceRef: sourceRef('class12-plan.json'),
    });
    const subjectIds = new Map<string, Awaited<ReturnType<typeof upsertSubject>>>();
    for (const [i, s] of IPMAT_SUBJECTS.entries()) subjectIds.set(s.label, await upsertSubject(db, courseId, s.code, s.name, i));
    // Chapter codes: <prefix>-<nn> in planner order within each subject. Stable: never renumbered.
    const chapterIds = new Map<string, AcademicChapterId>();
    const counters = new Map<string, number>();
    for (const [i, ch] of plan.chapters.entries()) {
      const subject = IPMAT_SUBJECTS.find((s) => s.label === ch.subject);
      if (!subject) throw new Error(`Unknown Class 12 subject ${ch.subject}`);
      const n = (counters.get(subject.prefix) ?? 0) + 1;
      counters.set(subject.prefix, n);
      const id = await upsertChapter(db, { courseId, subjectId: subjectIds.get(ch.subject)!, code: `${subject.prefix}-${pad2(n)}`, title: ch.chapter, sortOrder: i });
      chapterIds.set(`${ch.subject}|${ch.chapter}`, id);
    }
    const superseded = await upsertPlan(db, {
      courseId,
      code: 'IPMAT-C12-313',
      title: 'IPMAT Class 12 override — 313 classes / 391.25 h (superseded)',
      version: 1,
      status: 'superseded',
      countsStatus: 'unknown',
      datesStatus: 'unknown',
      classMinutes: CLASS_MINUTES,
      scopeNote: 'Lineage only. The per-lesson rows of the 313-class version are not in the legacy extract, so this version has no items.',
      changeLog: '253 teaching + 60 practice = 313 classes / 391.25 h. Superseded by IPMAT-C12-305 (eight practice classes moved to homework).',
      sourceRef: sourceRef('ipmat-baseline.json', 'class12_override.supersedes'),
    });
    const planId = await upsertPlan(db, {
      courseId,
      code: 'IPMAT-C12-305',
      title: 'IPMAT Class 12 override — 305 classes / 381.25 h',
      version: 2,
      status: 'locked',
      countsStatus: 'locked',
      datesStatus: 'provisional',
      supersedesPlanId: superseded,
      classMinutes: CLASS_MINUTES,
      scopeNote: 'Class 12 cohort only. Counts locked; lesson dates provisional (cycle April 2027 – March 2028 is provisional, OD-015). Planned work — nothing here is delivered.',
      changeLog: 'Eight practice classes (Verbal-P038/P042/P043, Quant-P024/P025/P026, LR-P053/P054) moved to homework instead of shifting classes earlier: 313 → 305.',
      sourceRef: sourceRef('class12-plan.json', 'lessons'),
    });
    await upsertItems(
      db,
      planId,
      plan.lessons.map((l) => {
        const chapterId = chapterIds.get(`${l.subject}|${l.chapter}`);
        if (!chapterId) throw new Error(`Lesson ${l.lesson_id} has no chapter`);
        return { chapterId, lessonCode: l.lesson_id, sessionType: l.session, plannedClasses: 1, plannedMinutes: l.planned_minutes, plannedDate: l.planned_date, coverage: l.coverage };
      }),
    );
  },
});
