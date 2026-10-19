/**
 * Provisional plans (D-016: labels preserved, nothing delivered):
 * - CA Foundation Accountancy v0.2 (batch CAF-SEP27-REG): 11 chapters / 46 topics,
 *   150 h teaching + practice. Hours are provisional planning judgments.
 * - Online Class 12 Accountancy: 14 chapters, 118 CBSE teaching hours in 60-minute classes.
 *
 * Programme mapping (core.ts is not ours to change): the legacy programme
 * `ONL-C12-CUET` (online Class 12 boards + CUET, status paused in the legacy
 * handover) is represented as the course ONL-C12-ACC under core programme
 * COMMERCE_11_12 with mode online and course status `paused`. The core
 * programme's own status is left as the core seed set it.
 */
import { defineSeed } from '@elevate/database/seed';
import { pad2, readLegacy, sourceRef, type CaAccountancy, type OnlineAccountancy } from './legacy';
import { programmeId, upsertChapter, upsertCourse, upsertItems, upsertPlan, upsertSubject, type SeedItem } from './upsert';

export const caFoundationSeed = defineSeed({
  name: 'academic.ca-foundation',
  module: 'academic',
  dependsOn: ['core.programmes'],
  description: 'CA Foundation Accountancy v0.2 (provisional): course CAF-ACC-SEP27, plan CAF-ACC-V0.2 (46 topics, 150 h)',
  async run({ db }) {
    const ca = readLegacy<CaAccountancy>('ca-foundation-accountancy.json');
    // Class length: 75 minutes was "selected in conversation" but the start date and
    // session length are still open in other sources (OD-019) → proposed, not locked.
    const courseId = await upsertCourse(db, {
      programmeId: await programmeId(db, 'CA_FOUNDATION'),
      code: 'CAF-ACC-SEP27',
      familyCode: 'CAF-ACC',
      version: 1,
      name: 'CA Foundation Accountancy — September 2027 attempt (v0.2, provisional)',
      description: 'Accountancy only; other papers have reference budgets but no plan. Start date unresolved (OD-019).',
      mode: 'offline',
      classMinutes: 75,
      classMinutesStatus: 'proposed',
      status: 'paused',
      sourceRef: sourceRef('ca-foundation-accountancy.json'),
    });
    const subjectId = await upsertSubject(db, courseId, 'ACC', 'Accountancy', 0);
    const items: SeedItem[] = [];
    for (const r of ca.records) {
      const chapterId = await upsertChapter(db, { courseId, subjectId, code: `ACC-${pad2(r.chapter_no)}`, title: r.title, sortOrder: r.chapter_no });
      for (const t of r.topics) {
        // Hours are multiples of 0.25 → exact whole minutes. Classes are 75-minute
        // CLASS EQUIVALENTS ("150 h = 120 x 75-minute class equivalents; not an
        // approved 120-class timetable"), never an approved class count.
        const minutes = Math.round(t.total_hours * 60);
        items.push({ chapterId, lessonCode: t.topic_id, sessionType: 'teaching', plannedClasses: Math.max(1, Math.round(minutes / 75)), plannedMinutes: minutes, coverage: t.topic });
      }
    }
    const planId = await upsertPlan(db, {
      courseId,
      code: 'CAF-ACC-V0.2',
      title: 'CA Foundation Accountancy plan v0.2 — 150 h (provisional)',
      version: 2,
      status: 'provisional',
      countsStatus: 'provisional',
      datesStatus: 'unknown',
      classMinutes: 75,
      scopeNote: 'Teaching + practice hours per topic (98 + 52 = 150 h). Tests (12 h) and discussions (13 h) are separate. Planned class counts are 75-minute class equivalents, not an approved timetable.',
      changeLog: 'v0.2 splits the v0.1 chapter totals (superseded, not imported) into 46 topic blocks.',
      sourceRef: sourceRef('ca-foundation-accountancy.json', 'records'),
    });
    await upsertItems(db, planId, items);
  },
});

export const onlineAccountancySeed = defineSeed({
  name: 'academic.online-class12-accountancy',
  module: 'academic',
  dependsOn: ['core.programmes'],
  description: 'Online Class 12 Accountancy (provisional): course ONL-C12-ACC, plan ONL-C12-ACC-226 (14 chapters, 118 CBSE h)',
  async run({ db }) {
    const oc = readLegacy<OnlineAccountancy>('online-class12-accountancy.json');
    const courseId = await upsertCourse(db, {
      programmeId: await programmeId(db, 'COMMERCE_11_12'),
      code: 'ONL-C12-ACC',
      familyCode: 'ONL-C12-ACC',
      version: 1,
      name: 'Online Class 12 Accountancy (boards + CUET) — provisional',
      description: 'Legacy programme ONL-C12-CUET (paused). 60-minute online classes are proposed (OD-020).',
      mode: 'online',
      classMinutes: 60,
      classMinutesStatus: 'proposed',
      status: 'paused',
      sourceRef: sourceRef('online-class12-accountancy.json'),
    });
    const subjectId = await upsertSubject(db, courseId, 'ACC', 'Accountancy', 0);
    const items: SeedItem[] = [];
    for (const r of oc.records) {
      const title = r.chapter_note ? `${r.chapter} (${r.chapter_note})` : r.chapter;
      const chapterId = await upsertChapter(db, { courseId, subjectId, code: `ACC12-${pad2(r.seq)}`, title, sortOrder: r.seq });
      items.push({ chapterId, lessonCode: `ACC12-${pad2(r.seq)}`, sessionType: 'teaching', plannedClasses: r.classes, plannedMinutes: r.classes * r.class_minutes });
    }
    const planId = await upsertPlan(db, {
      courseId,
      code: 'ONL-C12-ACC-226',
      title: 'Online Class 12 Accountancy — 226 h build-up (provisional)',
      version: 1,
      status: 'provisional',
      countsStatus: 'provisional',
      datesStatus: 'unknown',
      classMinutes: 60,
      scopeNote:
        'Items cover the 118 CBSE teaching hours only. The 226 h build-up adds CUET approach 4 h, practice 40 h (board 24 / CUET 16), assessments 30 h, discussions 13 h and revision 21 h (board 15 / CUET 6) — not chapter items.',
      changeLog: 'Legacy import (single source: the handover notes). The other four online subjects are not started.',
      sourceRef: sourceRef('online-class12-accountancy.json', 'records + build_up'),
    });
    await upsertItems(db, planId, items);
  },
});
