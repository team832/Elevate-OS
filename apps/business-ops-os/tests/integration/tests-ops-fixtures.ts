/**
 * Academic OS simulated at its contract boundary for the Tests and Mock Tests suite: one test held
 * in memory, answered in `academic.assessment(s)` v1 shapes, with the write routes applying the
 * roster rules (optimistic versions, one call per score write). The AI provider is a separate stub (ai.test).
 * Fictional people only.
 */
import { vi } from 'vitest';
import {
  academicAssessmentDetailV1Schema,
  type AcademicAssessmentDetailV1,
} from '@elevate/shared-contracts';

type Detail = AcademicAssessmentDetailV1;
type Row = Detail['roster'][number];
export const TEST_ID = '0b0e8a43-1c55-4c42-9a1d-0000000000a1';
export const BATCH_A = '0b0e8a43-1c55-4c42-9a1d-0000000000b1';
export const BATCH_B = '0b0e8a43-1c55-4c42-9a1d-0000000000b2';
const COURSE = '0b0e8a43-1c55-4c42-9a1d-0000000000c1';
const AT = '2026-10-01T05:00:00.000Z' as Detail['generatedAt'];

const id = (n: number) => `0b0e8a43-1c55-4c42-9a1d-${String(n).padStart(12, '0')}`;
export const student = (n: number, over: Partial<Row> = {}): Row =>
  ({
    rosterId: id(100 + n),
    studentId: id(200 + n),
    coreStudentId: null,
    studentCode: `SC-${n}`,
    admissionNumber: `SAMPLE-ADM-${n}`,
    displayName: `Sample Student ${n}`,
    batchId: BATCH_A,
    batchCode: 'SAMPLE-IPM-A',
    attendance: 'unmarked',
    marksState: 'not_entered',
    score: null,
    rank: null,
    addedReason: null,
    removedAt: null,
    removedReason: null,
    version: 1,
    isSample: true,
    ...over,
  }) as Row;

/** One section's effective rule as Academic sends it. */
export const section = (
  code: string,
  name: string,
  n: number,
  perCorrect: string,
  perWrong: string,
) => ({
  code,
  name,
  questionCount: n,
  maxMarks: String(n * Number(perCorrect)),
  perCorrect,
  perWrong,
  perUnattempted: '0',
  capMarks: null,
});

/** A dated mock (10 questions, +1 / −0.25: negative marking) with four students on its roster. */
export function testDetail(over: Partial<Detail['assessment']> = {}, roster?: Row[]): Detail {
  return academicAssessmentDetailV1Schema.parse({
    contract: 'academic.assessment',
    version: 1,
    generatedAt: AT,
    assessment: {
      id: TEST_ID,
      code: 'SAMPLE-MOCK-1',
      title: 'Sample IPMAT mock 1',
      kind: 'full_mock',
      type: 'mock_test',
      status: 'conducted',
      academicYear: '2026-27',
      courseId: COURSE,
      courseName: 'Sample IPMAT',
      batches: [
        { batchId: BATCH_A, code: 'SAMPLE-IPM-A', primary: true },
        { batchId: BATCH_B, code: 'SAMPLE-IPM-B', primary: false },
      ],
      scheduledDate: '2026-10-01',
      startTime: '10:00',
      maxMarks: '10',
      responsibleTeacher: null,
      evaluator: null,
      publicationState: 'not_published',
      rosterCounts: {
        active: 4,
        present: 0,
        absent: 0,
        excused: 0,
        unmarked: 4,
        notEntered: 4,
        imported: 0,
        verified: 0,
        removed: 0,
      },
      isSample: true,
      subjectId: null,
      subjectName: null,
      durationMinutes: 60,
      marking: { marksPerCorrect: '1', marksPerWrong: '-0.25', marksUnattempted: '0' },
      sections: [section('QA', 'Quant', 10, '1', '-0.25')],
      rosterSnapshotAt: AT,
      ...over,
    },
    roster: roster ?? [1, 2, 3, 4].map((n) => student(n)),
    results: null,
    publication: { state: 'not_published', rankVisible: true, current: null, history: [] },
  });
}

export type Call = { method: string; path: string; body: unknown };

/**
 * Stub every fetch: Academic's assessment routes act on `state.detail`; the AI provider (https://ai.test)
 * answers with `ai.reply`; anything else is unreachable. Returns the calls for assertions.
 */
export function fakeAcademic(detail: Detail = testDetail()) {
  const state = { detail, calls: [] as Call[], down: false };
  const ai = {
    reply: (() => Response.json({}, { status: 500 })) as () => Response,
    calls: [] as unknown[],
  };
  const json = (data: unknown, status = 200) => Response.json({ data }, { status });
  const refuse = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === 'https://ai.test') {
        ai.calls.push(JSON.parse(String(init?.body)));
        return ai.reply();
      }
      const m = /\/academic\/api\/internal\/v1\/assessments(\/.*)?$/.exec(url.pathname);
      if (!m || state.down) throw new TypeError('fetch failed');
      const method = init?.method ?? 'GET';
      const path = m[1] ?? '';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      state.calls.push({ method, path: `${path}${url.search}`, body });
      const d = state.detail;
      if (method === 'GET' && path === '')
        return json({
          contract: 'academic.assessments',
          version: 1,
          generatedAt: AT,
          view: url.searchParams.get('view') ?? 'upcoming',
          total: 1,
          page: 1,
          pageSize: Number(url.searchParams.get('pageSize') ?? 25),
          viewCounts: { upcoming: 1, in_progress: 0, previous: 2, awaiting_publication: 1 },
          filterOptions: {
            courses: [{ id: d.assessment.courseId, label: d.assessment.courseName }],
            batches: d.assessment.batches.map((b) => ({ id: b.batchId, label: b.code })),
          },
          items: [d.assessment],
        });
      if (method === 'GET' && path === `/${TEST_ID}`) return json(d);
      if (method === 'GET') return refuse(404, 'NOT_FOUND', 'Not found.');
      if (path === '') {
        state.detail = testDetail(
          { status: body.scheduledDate ? 'scheduled' : 'draft', rosterSnapshotAt: null },
          [],
        );
        return json(state.detail, 201);
      }
      if (method === 'PATCH') {
        state.detail = testDetail({ ...d.assessment, ...body }, d.roster);
        return json(state.detail);
      }
      if (path.endsWith('/withdraw')) {
        const history = d.publication.history.map((p) =>
          p.status === 'current'
            ? { ...p, status: 'withdrawn' as const, withdrawnAt: AT, withdrawnReason: body.reason }
            : p,
        );
        state.detail = {
          ...d,
          publication: { ...d.publication, state: 'withdrawn', current: null, history },
        };
        return json(state.detail);
      }
      if (path.endsWith('/roster')) {
        state.detail = testDetail({ ...d.assessment, rosterSnapshotAt: AT }, d.roster);
        return json(state.detail, 201);
      }
      if (path.endsWith('/scores')) {
        const rows = body.rows as {
          studentId: string;
          version: number;
          attendance?: Row['attendance'];
          marksState: Row['marksState'];
          score: string | null;
        }[];
        const stale = rows.find(
          (r) => d.roster.find((x) => x.studentId === r.studentId)?.version !== r.version,
        );
        if (stale)
          return Response.json(
            {
              error: {
                code: 'CONFLICT',
                message: 'Someone changed these marks; reload.',
                details: { stale: [stale.studentId] },
              },
            },
            { status: 409 },
          );
        state.detail = {
          ...d,
          roster: d.roster.map((x) => {
            const r = rows.find((y) => y.studentId === x.studentId);
            return r
              ? {
                  ...x,
                  attendance: r.attendance ?? x.attendance,
                  marksState: r.marksState,
                  score: r.score,
                  version: x.version + 1,
                }
              : x;
          }),
        };
        return json(state.detail);
      }
      if (path.endsWith('/finalise')) {
        state.detail = { ...d, results: { resultVersion: 1, finalisedAt: AT, maxScore: '10' } };
        return json(state.detail);
      }
      if (path.endsWith('/publications')) {
        const unmarked = d.assessment.rosterCounts?.unmarked ?? 0;
        if (!body.provisional && unmarked)
          return Response.json(
            {
              error: {
                code: 'INVALID_STATE_TRANSITION',
                message:
                  'The results are incomplete; resolve these issues or publish provisionally.',
                details: {
                  issues: [{ code: 'UNMARKED', count: unmarked, message: 'Attendance not marked' }],
                },
              },
            },
            { status: 409 },
          );
        const p = {
          version: body.version,
          resultVersion: 1,
          status: 'current' as const,
          rankingScope: body.rankingScope,
          cohortBatchIds: body.cohortBatchIds ?? null,
          tiePolicy: 'competition' as const,
          provisional: body.provisional,
          completeness: d.assessment.rosterCounts!,
          publishedAt: AT,
          publishedByName: 'Sample Manager',
          withdrawnAt: null,
          withdrawnReason: null,
          note: body.note ?? null,
        } as Detail['publication']['history'][number];
        state.detail = {
          ...d,
          publication: { ...d.publication, current: p, history: [...d.publication.history, p] },
        };
        return json(state.detail, 201);
      }
      return json(d);
    }),
  );
  return { state, ai };
}

/** A provider answer carrying `obj` as JSON: Gemini's shape, or Chat Completions (Groq, OpenRouter). */
export const aiAnswer =
  (obj: unknown, shape: 'gemini' | 'chat' = 'gemini') =>
  () =>
    Response.json(
      shape === 'gemini'
        ? {
            candidates: [
              { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } },
            ],
          }
        : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(obj) } }] },
    );

export const b64 = (text: string | Uint8Array) => Buffer.from(text).toString('base64');
export const csvFile = (text: string, name = 'scores.csv') => ({
  name,
  mime: 'text/csv',
  dataBase64: b64(text),
});
export const pdfFile = (name = 'paper.pdf', extra = '') => ({
  name,
  mime: 'application/pdf',
  dataBase64: b64(`%PDF-1.4\n% sample ${extra}\n%%EOF`),
});
