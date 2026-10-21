/**
 * Draft syllabus reference courses from the accuracy-reviewed distribution in
 * data/syllabus (owner, 21 Oct 2026). Everything is a draft pending owner
 * verification: no plans, no class counts, no teacher assignments.
 * Also fills chapter weights on the existing IPMAT-BASE course — the weight
 * column only; its codes, titles, order, plan and locked 253 classes stay as
 * academic.ipmat-baseline seeds them (that seed leaves weight at the default).
 */
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { academicChapters, academicCourses } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import { programmeId, upsertChapter, upsertCourse, upsertSubject } from './upsert';

export const SYLLABUS_FILE = 'data/syllabus/syllabus-distribution-2026-10-21.json';

interface Source { url: string; title: string; year: string; retrieved: string }
interface Syllabus {
  programmes: {
    programmeCode: string;
    courseCode: string;
    familyCode?: string;
    source: Source;
    subjects: { code: string; name: string; chapters: { code: string; title: string; sortOrder: number; weight: number }[] }[];
  }[];
}

export const readSyllabus = () =>
  JSON.parse(readFileSync(new URL(`../../../${SYLLABUS_FILE}`, import.meta.url), 'utf8')) as Syllabus;

const MATHS = 'Mathematics (041) and Applied Mathematics (241) are separate subjects; each student or batch takes one of them.';
const DRAFTS: Record<string, { name: string; note: string }> = {
  'CLAT-SYL-2027': { name: 'CLAT UG 2027 syllabus (draft)', note: 'Official syllabus page: https://consortiumofnlus.ac.in/clat-2027/ug-syllabus.html. Chapters marked "derived" come from observed papers, not the syllabus.' },
  'CUET-SYL-2026': { name: 'CUET (UG) 2026 Commerce papers syllabus (draft)', note: 'Holds all six papers (101, 301, 305, 309, 319, 501). NTA allows at most five subjects per candidate, so counsellors pick five per student. Weights are a proxy from CBSE unit marks.' },
  'CAF-SYL-2024': { name: 'CA Foundation syllabus, ICAI May 2024 onwards (draft)', note: 'Paper durations: not published by ICAI.' },
  'COM-C11-2627': { name: 'Class 11 Commerce syllabus, CBSE 2026-27 (draft)', note: MATHS },
  'COM-C12-2627': { name: 'Class 12 Commerce syllabus, CBSE 2026-27 (draft)', note: MATHS },
};

export const syllabusDraftsSeed = defineSeed({
  name: 'academic.syllabus-drafts',
  module: 'academic',
  dependsOn: ['core.programmes', 'academic.ipmat-baseline'],
  description: `Draft syllabus courses ${Object.keys(DRAFTS).join(', ')} + IPMAT-BASE chapter weights (${SYLLABUS_FILE})`,
  async run({ db }) {
    for (const p of readSyllabus().programmes) {
      const draft = DRAFTS[p.courseCode];
      if (!draft) {
        // IPMAT weights = mean of IIM Indore, IIMB UG-AT, IIM Rohtak and JIPMAT 2026 subject shares (owner, 21 Oct 2026).
        const [course] = await db.select({ id: academicCourses.id }).from(academicCourses).where(eq(academicCourses.code, p.courseCode));
        for (const ch of p.subjects.flatMap((s) => s.chapters)) {
          const updated = await db
            .update(academicChapters)
            .set({ weight: ch.weight })
            .where(and(eq(academicChapters.courseId, course!.id), eq(academicChapters.code, ch.code), eq(academicChapters.title, ch.title)))
            .returning({ id: academicChapters.id });
          if (updated.length !== 1) throw new Error(`${p.courseCode} chapter ${ch.code} "${ch.title}" not found — weights only apply to existing chapters`);
        }
        continue;
      }
      const { url, title, year, retrieved } = p.source;
      const courseId = await upsertCourse(db, {
        programmeId: await programmeId(db, p.programmeCode),
        code: p.courseCode,
        familyCode: p.familyCode!,
        version: 1,
        name: draft.name,
        description: `Draft syllabus — pending owner verification. Source: ${title} (${year}), ${url}, retrieved ${retrieved}. ${draft.note}`,
        mode: null,
        classMinutes: null,
        status: 'draft',
        sourceRef: `${SYLLABUS_FILE} ${p.courseCode}`,
      });
      for (const [i, s] of p.subjects.entries()) {
        const subjectId = await upsertSubject(db, courseId, s.code, s.name, i);
        for (const ch of s.chapters) await upsertChapter(db, { courseId, subjectId, code: ch.code, title: ch.title, sortOrder: ch.sortOrder, weight: ch.weight });
      }
    }
  },
});
