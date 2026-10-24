/**
 * Tests and Mock Tests screens (brief §20): the score import review table shows, per row, what was
 * read, the proposed student and basis, marks, attendance only when stated, warnings and
 * problems, and the controls a person needs (choose/skip, AI check, overwrite confirmation).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ImportReview, type ReviewRowView } from '../../src/app/tests/_components/import-review';
import { ScoreUpload } from '../../src/app/tests/_components/score-upload';
import { Papers, Publications } from '../../src/app/tests/_components/test-panels';
import { testDetail } from '../integration/tests-ops-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const row = (over: Partial<ReviewRowView>): ReviewRowView => ({
  rowId: 'row-1',
  rowNumber: 1,
  ai: false,
  original: 'Admission number: SAMPLE-ADM-1 · QA: 7',
  status: 'matched',
  proposed: 'Sample Student 1 (SAMPLE-ADM-1, SAMPLE-IPM-A)',
  basis: 'Admission number',
  marks: '7',
  attendance: null,
  change: 'new',
  errors: [],
  warnings: [],
  choices: [{ studentId: 's1', label: 'Sample Student 1', suggested: false }],
  ...over,
});
const ROWS = [
  row({}),
  row({
    rowId: 'row-2',
    rowNumber: 2,
    status: 'ambiguous',
    proposed: null,
    basis: 'No match',
    original: 'Name: Sample Twin · QA: 5',
    change: null,
    choices: [
      { studentId: 't1', label: 'Sample Twin (A)', suggested: true },
      { studentId: 't2', label: 'Sample Twin (B)', suggested: true },
    ],
  }),
  row({ rowId: 'row-3', rowNumber: 3, ai: true, attendance: 'present', marks: '-0.5' }),
  row({
    rowId: 'row-4',
    rowNumber: 4,
    change: 'overwrite',
    errors: ['Quant -3 is outside -2.5 to 10.'],
  }),
];
const html = (editable: boolean) =>
  renderToStaticMarkup(
    <ImportReview
      rows={ROWS}
      editable={editable}
      action="/ops/api/v1/score-imports/x/confirm"
      doneHref="/ops/tests/t"
    />,
  );

describe('score import review table', () => {
  const out = html(true);
  it.each([
    'In the file',
    'Matched by',
    'Attendance in the file',
    'Name: Sample Twin · QA: 5',
    'Ambiguous',
    'Suggested: Sample Twin (A)',
    'Skip this row',
    'Read by AI',
    'Checked against the sheet',
    'Changes a verified mark',
    'Replace the verified',
    'Quant -3 is outside -2.5 to 10.',
    'Not stated',
    '-0.5',
    'Mark scored students present',
    'Save marks to Academic OS',
  ])('shows %s', (text) => expect(out).toContain(text));

  it('AI and overwrite checks appear only on their own rows', () => {
    expect(out.match(/name="ai\./g)).toHaveLength(1);
    expect(out.match(/name="overwrite\./g)).toHaveLength(1);
  });

  it('read-only for people who cannot confirm: no controls', () => {
    const ro = html(false);
    expect(ro).not.toMatch(/<select|<form|Save marks/);
    expect(ro).toContain('Ambiguous');
  });
});

describe('score sheet upload', () => {
  it('tells plainly to save Excel as CSV; picks only CSV or PDF', () => {
    const out = renderToStaticMarkup(
      <ScoreUpload
        action="/x"
        reviewHref="/y/{id}"
        sections={[{ code: 'QA', name: 'Quant' }]}
        ai={null}
      />,
    );
    expect(out).toContain('Excel: save as CSV first');
    expect(out).toContain('accept=".csv,.pdf');
  });
});

describe('test page panels', () => {
  const withdrawn = testDetail();
  withdrawn.publication = {
    state: 'withdrawn',
    rankVisible: true,
    current: null,
    history: [
      {
        version: 1,
        resultVersion: 1,
        status: 'withdrawn',
        rankingScope: 'roster',
        cohortBatchIds: null,
        tiePolicy: 'competition',
        provisional: false,
        completeness: withdrawn.assessment.rosterCounts!,
        publishedAt: '2026-10-02T05:00:00.000Z' as never,
        publishedByName: 'Sample Manager',
        withdrawnAt: '2026-10-03T05:00:00.000Z' as never,
        withdrawnReason: 'Re-scored: answer key corrected',
        note: null,
      },
    ],
  };
  it('a withdrawn publication shows its reason (also Academic’s own) to every reader', () => {
    const out = renderToStaticMarkup(<Publications d={withdrawn} publish={false} />);
    expect(out).toContain('Withdrawn');
    expect(out).toContain('Re-scored: answer key corrected');
    expect(out).not.toContain('Publish results');
  });

  it('a replaced paper version says which version replaced it', () => {
    const f = (version: number, supersededByVersion: number | null) => ({
      id: `f${version}`,
      name: 'key.pdf',
      purpose: 'reference' as const,
      sizeBytes: 10,
      createdAt: new Date('2026-10-01T05:00:00Z'),
      uploadedByUserId: 'u',
      uploaderName: 'Sample Manager',
      isSample: false,
      version,
      releasedAt: null,
      supersedes: null,
      supersededByVersion,
      canDelete: false,
    });
    const out = renderToStaticMarkup(
      <Papers id="t" manage={false} files={{ paper: [], key: [f(2, null), f(1, 2)] } as never} />,
    );
    expect(out).toContain('Replaced by version 2');
  });
});
