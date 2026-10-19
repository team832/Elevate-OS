/**
 * Concept-book indices (ACD-023): six books, 133 numbered chapters + the Book 2
 * opening unit. Index only — content is deliberately empty (`not_started`).
 * Question counts exist only for Book 5 (Critical Reasoning) and are PLANNED
 * allocations (`questionCountStatus = 'planned'`), never written questions.
 * Retired/moved ids are kept as alias rows that point at the current code
 * (BR-ACD-10). The B5 "later CR ids shifted by one" renumbering has no
 * recorded old→new mapping, so no aliases are invented for it.
 */
import { defineSeed } from '@elevate/database/seed';
import { academicConceptBookChapters, type Database } from '@elevate/database';
import { readLegacy, sourceRef, type ConceptBooks, type ConceptChapter } from './legacy';

type Row = typeof academicConceptBookChapters.$inferInsert;

const ALIASES: { code: string; status: 'retired' | 'moved'; aliasOf: string; title: string }[] = [
  { code: 'B4-11', status: 'retired', aliasOf: 'B4-10', title: 'Classification (merged into B4-10 Analogy and Classification)' },
  ...[12, 13, 14, 15, 16, 17].map((n, i) => ({
    code: `B1-${n}`,
    status: 'moved' as const,
    aliasOf: `B6-${18 + i}`,
    title: `Vocabulary chapter moved to Book 6 (B6-${18 + i})`,
  })),
  { code: 'B1-25', status: 'moved', aliasOf: 'B5-07', title: 'Conversation Analysis (moved to Book 5)' },
];

async function upsertRow(db: Database, row: Row) {
  const { chapterCode: _c, ...set } = row;
  await db
    .insert(academicConceptBookChapters)
    .values(row)
    .onConflictDoUpdate({ target: academicConceptBookChapters.chapterCode, set });
}

function chapterRow(book: { book_id: string; title: string }, ch: ConceptChapter, status: Row['status']): Row {
  const q = ch.planned_questions;
  return {
    bookCode: book.book_id,
    bookTitle: book.title,
    chapterCode: ch.chapter_id,
    chapterNumber: ch.chapter_number,
    section: ch.section,
    title: ch.title,
    subtopics: ch.subtopics,
    status,
    aliasOfCode: null,
    indexStatus: 'locked',
    contentStatus: ch.content_status,
    plannedConceptQuestions: q?.concept_building ?? null,
    plannedPracticeQuestions: q?.practice_application ?? null,
    plannedRankerQuestions: q?.rankers_zone ?? null,
    questionCountStatus: q ? 'planned' : null,
    sourceRef: sourceRef('concept-books.json', `records[${book.book_id}]`),
  };
}

export const conceptBooksSeed = defineSeed({
  name: 'academic.concept-books',
  module: 'academic',
  description: 'Concept-book indices: 6 books, 133 numbered chapters + 1 opening unit, id aliases (planned question counts only)',
  async run({ db }) {
    const cb = readLegacy<ConceptBooks>('concept-books.json');
    const present = new Set<string>();
    for (const book of cb.records) {
      if (book.opening_unit) {
        await upsertRow(db, chapterRow(book, book.opening_unit, 'opening_unit'));
        present.add(book.opening_unit.chapter_id);
      }
      for (const ch of book.chapters) {
        await upsertRow(db, chapterRow(book, ch, 'active'));
        present.add(ch.chapter_id);
      }
    }
    for (const a of ALIASES) {
      if (present.has(a.code) || !present.has(a.aliasOf)) continue;
      const book = cb.records.find((b) => a.code.startsWith(`${b.book_id}-`))!;
      await upsertRow(db, {
        bookCode: book.book_id,
        bookTitle: book.title,
        chapterCode: a.code,
        chapterNumber: null,
        section: null,
        title: a.title,
        subtopics: [],
        status: a.status,
        aliasOfCode: a.aliasOf,
        indexStatus: 'locked',
        contentStatus: 'not_started',
        questionCountStatus: null,
        sourceRef: sourceRef('concept-books.json', 'id_history'),
      });
    }
  },
});
