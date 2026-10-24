import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  attendanceFacts,
  constructiveSummary,
  NEXT_STEP_LABEL,
  resultFacts,
  scoreTrends,
  toneOf,
} from '../../src/domain/student-report';
import { progressReportPdf } from '../../src/server/pdf/progress-report';
import type { ReportSnapshot } from '../../src/server/student-report';

const LONG_NAME = 'Sample Student With A Very Long Family Name '.repeat(3).trim();
const PHONE = '+910000000001';
const results = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    assessmentId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    code: `SAMPLE-${i % 2 ? 'MOCK' : 'SECTIONAL'}-${i + 1}`,
    subject: 'Quant',
    examType: i % 2 ? 'full_mock' : 'sectional',
    heldOn: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    state: i % 5 === 0 ? ('absent' as const) : ('scored' as const),
    score: i % 5 === 0 ? null : 10 + (i % 20),
    maxScore: i < 35 ? 30 : 40,
    percentile: i % 5 === 0 ? null : 50,
    rank: i % 5 === 0 ? null : 4,
    cohort: { label: 'Sample CLAT batch with a long cohort label', scored: 24 },
    resultVersion: i === 3 ? 2 : 1,
  }));
const attendance = attendanceFacts({
  held: 40,
  present: 30,
  partial: 1,
  late: 2,
  absent: 5,
  excused: 1,
  ratePercent: 82.5,
  definition: 'present + late + partial of held',
});
const review = {
  id: 'r1',
  teacher: 'Sample Quant Teacher',
  subject: 'Quant',
  observedOn: '2026-09-15',
  type: 'periodic_progress',
  version: 1,
  visibility: 'shareable' as const,
  strengths: 'Clear reasoning in class',
  areasToImprove: 'Ratios',
  actionPlan: 'Short daily practice set',
};
const INTERNAL = {
  attendanceEvidence: 'Attends regularly',
  homeworkEvidence: 'Homework often late',
  academicConcerns: 'SENTINEL-CONCERN loses marks on ratios',
};

/** A v2 snapshot of either owner kind; `n` assessments (6 = a typical student). */
function snapshot(audience: ReportSnapshot['audience'], n = 6): ReportSnapshot {
  const rows = results(n);
  const ptm = audience === 'guardian' || audience === 'student';
  const tone = toneOf(audience);
  return {
    template: 'progress-report/2',
    audience,
    kind: audience,
    tone,
    sections: ptm
      ? ['overview', 'results', 'attendance', 'feedback', 'summary']
      : ['overview', 'kyc', 'results', 'attendance', 'feedback', 'summary'],
    period: { from: '2026-09-01', to: '2026-09-30' },
    acknowledgement: true,
    student: {
      name: LONG_NAME,
      admissionNumber: null,
      isSample: true,
      counsellor: 'Sample Counsellor',
    },
    programmes: [{ programme: 'CLAT', batch: 'Sample CLAT batch', status: 'Enrolled' }],
    academic: {
      status: 'available',
      checkedAt: '2026-10-01T00:00:00.000Z',
      window: { from: '2026-09-01', to: '2026-09-30' },
      attendance,
      results: rows.map((r) => resultFacts(r as never)),
      trends: scoreTrends(rows as never),
      enrolments: [
        {
          enrolmentId: 'e',
          programmeCode: 'CLAT',
          batchName: 'Sample CLAT batch',
          status: 'active',
          teachers: [{ name: 'Sample Quant Teacher', subject: 'Quant' }],
        },
      ],
    },
    feedback: [ptm ? review : { ...review, ...INTERNAL }],
    kyc: ptm
      ? undefined
      : {
          dateOfBirth: '2009-04-12',
          age: 17,
          class: 'class_12',
          board: 'cbse',
          school: 'Sample School',
          city: 'Sikar',
          guardians: [
            {
              name: 'Sample Guardian',
              relationship: 'mother',
              phone: PHONE,
              email: 'sample-guardian@example.test',
              consent: 'given',
            },
          ],
          documents: [
            { key: 'id_proof', label: 'ID proof', state: 'verified' },
            { key: 'photograph', label: 'Photograph', state: 'not_recorded' },
          ],
        },
    summary: constructiveSummary(
      { attendance, results: rows as never, feedback: [review] },
      { tone },
    ),
  } as unknown as ReportSnapshot;
}
const meta = (status = 'draft') => ({
  referenceCode: 'SR-SAMPLE0001',
  status,
  templateVersion: 'progress-report/2',
});
const sample = (name: string, bytes: Uint8Array) => {
  const out = process.env.PDF_SAMPLE_OUT;
  if (out) writeFileSync(out.replace(/\.pdf$/i, `-${name}.pdf`), bytes);
};

describe('student report PDF (two kinds, D-078)', () => {
  it('PTM report: at most 2 pages for a typical student, bars, affirmative headings, no KYC or guardian data', async () => {
    const comment =
      'The student attends regularly and scored 36.7% in the latest sectional test; the next step is steady practice before the next mock.';
    const pdf = await progressReportPdf({ ...snapshot('guardian'), comment }, meta());
    sample('ptm', pdf.bytes);
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBeLessThanOrEqual(2);
    const text = pdf.lines.join(' ');
    expect(pdf.lines).toEqual(
      expect.arrayContaining([
        'PTM report (for parents)',
        'Counsellor',
        'Where to work on',
        'Next steps',
        'Absent',
        'Overall comment',
      ]),
    );
    expect(text).toContain(comment.slice(0, 40));
    expect(text).toContain('36.7% (11/30)');
    expect(text).toContain('not attempted (not counted as zero)');
    expect(text).toContain('Attended 33 of 39 recorded classes');
    for (const forbidden of [
      'KYC',
      'Admission number',
      PHONE,
      'SENTINEL',
      'Status changes',
      NEXT_STEP_LABEL,
      'Academic concerns',
    ])
      expect(text).not.toContain(forbidden);
    expect(pdf.unsupportedCharacters).toBe(false);
  });

  it('internal report: KYC block, attendance bar with the contract rate, every review field, neutral headings', async () => {
    const pdf = await progressReportPdf(snapshot('internal', 70), meta());
    sample('internal', pdf.bytes);
    const doc = await PDFDocument.load(pdf.bytes);
    const pages = doc.getPages();
    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
    pages.forEach((_, i) => expect(pdf.lines).toContain(`Page ${i + 1} of ${pages.length}`));
    const text = pdf.lines.join(' ');
    expect(text).toContain(LONG_NAME.slice(0, 60));
    expect(pdf.lines).toEqual(
      expect.arrayContaining([
        'KYC and student details (private — internal use only)',
        '12 Apr 2009 (age 17)',
        PHONE,
        'Verified',
        'Marks — Sectional',
        'Marks — Full mock',
        'Attendance rate',
        '82.5%',
        'present + late + partial of held',
        'Academic concerns',
        'Areas for improvement',
        NEXT_STEP_LABEL,
        'Not assigned',
      ]),
    );
    expect(text).toContain('formats differ (out of 30, 40), compared as percentages');
    expect(text).toContain('Sample CLAT batch with a long cohort label');
    expect(text).toContain('re-scored v2');
    expect(text).toContain('missed (absent, not counted as zero)');
    expect(pdf.unsupportedCharacters).toBe(false);
  });

  it('an internal report whose author could not read private data says so instead of the KYC block', async () => {
    const s = snapshot('internal');
    const pdf = await progressReportPdf(
      { ...s, kyc: undefined, sections: s.sections.filter((x) => x !== 'kyc') } as ReportSnapshot,
      meta('final'),
    );
    const text = pdf.lines.join(' ');
    expect(text).toContain('Not included — the author may not read private details');
    expect(text).not.toContain('not for sharing');
    expect(pdf.lines).toEqual(expect.arrayContaining(['Review', 'Acknowledgement']));
  });

  it('progress-report/1 snapshots keep the table layout, the joined internal remarks and the contract rate', async () => {
    const s = snapshot('internal', 12) as ReportSnapshot & { feedback: Record<string, unknown>[] };
    const legacy = {
      ...s,
      template: 'progress-report/1',
      tone: undefined,
      kyc: undefined,
      sections: ['overview', 'programmes', 'results', 'attendance', 'feedback'],
      feedback: [
        {
          ...review,
          type: undefined,
          observations: 'Attendance and engagement: Attends regularly',
        },
      ],
      history: {
        changes: [],
        exits: [{ status: 'Withdrawn', date: '2026-09-10', reason: 'Sample reason: moved city' }],
      },
    } as unknown as ReportSnapshot;
    const pdf = await progressReportPdf(legacy, {
      ...meta(),
      templateVersion: 'progress-report/1',
    });
    const text = pdf.lines.join(' ');
    for (const expected of [
      'Compared with (same assessment)',
      'Internal remarks',
      'Attendance and engagement: Attends regularly',
      '82.5% (present + late + partial of held)',
      'Exit records',
      'Sample reason: moved city',
    ])
      expect(text).toContain(expected);
    expect(pdf.lines.filter((l) => l === 'Assessment').length).toBeGreaterThanOrEqual(1);
    expect(text).not.toContain('Marks — ');
  });
});
