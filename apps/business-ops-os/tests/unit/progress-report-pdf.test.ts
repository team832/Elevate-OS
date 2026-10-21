import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  attendanceFacts,
  constructiveSummary,
  resultFacts,
  scoreTrends,
} from '../../src/domain/student-report';
import { progressReportPdf } from '../../src/server/pdf/progress-report';
import type { ReportSnapshot } from '../../src/server/student-report';

const LONG_NAME = 'Sample Student With A Very Long Family Name '.repeat(3).trim();
const results = Array.from({ length: 70 }, (_, i) => ({
  assessmentId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  code: `SAMPLE-SECTIONAL-${i + 1}`,
  subject: 'Quant',
  examType: 'sectional',
  heldOn: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
  state: i % 9 === 0 ? ('absent' as const) : ('scored' as const),
  score: i % 9 === 0 ? null : 10 + (i % 20),
  maxScore: i < 35 ? 30 : 40,
  percentile: i % 9 === 0 ? null : 50,
  rank: i % 9 === 0 ? null : 4,
  cohort: { label: 'Sample CLAT batch with a long cohort label', scored: 24 },
  resultVersion: i === 3 ? 2 : 1,
}));

function snapshot(audience: ReportSnapshot['audience']): ReportSnapshot {
  const attendance = attendanceFacts({
    held: 40,
    present: 30,
    partial: 1,
    late: 2,
    absent: 5,
    excused: 1,
  });
  return {
    template: 'progress-report/1',
    audience,
    sections: ['overview', 'programmes', 'results', 'attendance', 'summary'],
    period: { from: '2026-09-01', to: '2026-09-30' },
    acknowledgement: true,
    student: { name: LONG_NAME, admissionNumber: null, isSample: true },
    programmes: [{ programme: 'CLAT', batch: 'Assigned in Academic OS', status: 'Enrolled' }],
    academic: {
      status: 'available',
      checkedAt: '2026-10-01T00:00:00.000Z',
      window: { from: '2026-09-01', to: '2026-09-30' },
      attendance,
      results: results.map((r) => resultFacts(r as never)),
      trends: scoreTrends(results as never),
      enrolments: [
        {
          enrolmentId: 'e',
          programmeCode: 'CLAT',
          batchName: null,
          status: 'active',
          teachers: [{ name: 'Sample Quant Teacher', subject: 'Quant' }],
        },
      ],
    },
    summary: constructiveSummary({ attendance, results: results as never, feedback: [] }),
  } as unknown as ReportSnapshot;
}

describe('progress report PDF (acceptance 18)', () => {
  it('opens as a multi-page A4 document with page numbers, the full long name and honest gaps', async () => {
    const pdf = await progressReportPdf(snapshot('guardian'), {
      referenceCode: 'SR-SAMPLE0001',
      status: 'draft',
      templateVersion: 'progress-report/1',
    });
    if (process.env.PDF_SAMPLE_OUT) writeFileSync(process.env.PDF_SAMPLE_OUT, pdf.bytes);
    const doc = await PDFDocument.load(pdf.bytes);
    const pages = doc.getPages();
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
    pages.forEach((_, i) => expect(pdf.lines).toContain(`Page ${i + 1} of ${pages.length}`));
    const text = pdf.lines.join(' ');
    expect(text).toContain(LONG_NAME.slice(0, 60));
    expect(pdf.lines).toEqual(expect.arrayContaining(['Not assigned', 'Absent']));
    expect(text).toContain('not for sharing until it is final');
    expect(text).toContain('formats differ (out of 30, 40), compared as percentages');
    expect(text).toContain('No strengths recorded for this period.');
    expect(text).toContain('Sample CLAT batch with a long cohort label');
    expect(text).toContain('re-scored v2');
    expect(pdf.unsupportedCharacters).toBe(false);
    expect(pdf.lines.filter((l) => l === 'Assessment').length).toBeGreaterThanOrEqual(2); // header repeats
  });

  it('a final report has no draft banner and still prints the review area', async () => {
    const pdf = await progressReportPdf(snapshot('student'), {
      referenceCode: 'SR-SAMPLE0002',
      status: 'final',
      templateVersion: 'progress-report/1',
    });
    expect(pdf.lines.join(' ')).not.toContain('not for sharing');
    expect(pdf.lines).toEqual(expect.arrayContaining(['Review', 'Acknowledgement']));
  });
  it('staff reports print exit records from the snapshot; family reports carry none', async () => {
    const meta = {
      referenceCode: 'SR-SAMPLE0003',
      status: 'final',
      templateVersion: 'progress-report/1',
    };
    const staff = await progressReportPdf(
      {
        ...snapshot('internal'),
        history: {
          changes: [],
          exits: [{ status: 'Withdrawn', date: '2026-09-10', reason: 'Sample reason: moved city' }],
        },
      } as ReportSnapshot,
      meta,
    );
    expect(staff.lines).toEqual(
      expect.arrayContaining(['Exit records', 'Sample reason: moved city']),
    );
    const family = await progressReportPdf(snapshot('guardian'), meta);
    expect(family.lines).not.toContain('Exit records');
  });
});
