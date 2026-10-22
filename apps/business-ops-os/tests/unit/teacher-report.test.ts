import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { AcademicTeacherActivityV1, Metric } from '@elevate/shared-contracts';
import { deliveryFacts, teacherSummary, workOn } from '../../src/domain/teacher-report';
import { teacherReportPdf } from '../../src/server/pdf/teacher-report';
import { PERIOD_DEFINITIONS } from '../../src/server/task-period-report';
import type { TeacherReportSnapshot } from '../../src/server/teacher-report';

const W = { from: '2026-09-21', to: '2026-10-20' } as const;
const ok = (value: number, definition: string): Metric => ({
  status: 'ok',
  value,
  definition,
  window: W as never,
  unit: 'count',
});
const missing = (definition: string, reason: string): Metric => ({
  status: 'missing',
  value: null,
  reason,
  definition,
  window: W as never,
  unit: 'count',
});

const activity = (over: Partial<AcademicTeacherActivityV1> = {}): AcademicTeacherActivityV1 =>
  ({
    contract: 'academic.teacher_activity',
    version: 1,
    generatedAt: '2026-10-21T05:00:00.000Z',
    staffId: '00000000-0000-4000-8000-000000000001',
    window: W,
    assignments: [
      {
        batchCode: 'SAMPLE-CLAT-26',
        subjectName: 'Quant',
        role: 'primary',
        startDate: '2026-07-01',
        endDate: null,
      },
    ],
    sessions: {
      planned: ok(40, 'Classes timetabled for this teacher in the window.'),
      delivered: ok(36, 'Classes marked delivered with this teacher as an actual teacher.'),
      cancelled: ok(2, 'Classes cancelled in the window.'),
      substituted: ok(1, 'Classes a substitute taught instead.'),
    },
    logsPending: ok(3, 'Delivered classes without a submitted teaching log.'),
    attendancePending: ok(2, 'Delivered classes without attendance recorded.'),
    markingPending: missing('Assessments awaiting marks.', 'marking is not tracked yet'),
    reviews: { submitted: ok(4, 'Reviews submitted in the window.'), draft: ok(0, 'Drafts.') },
    unavailability: [],
    ...over,
  }) as AcademicTeacherActivityV1;

const work = {
  assigned: 6,
  completed: 4,
  open: 3,
  overdue: 1,
  eod: { days: 30, submitted: 22, acknowledged: 20, missing: 8 },
};
const reviews = { shareable: 3, internal: 1, latest: '2026-10-12' as never };

describe('teacher report facts (pure)', () => {
  it('keeps Academic metrics as reported: missing stays null with its reason, never 0', () => {
    const d = deliveryFacts(activity());
    expect(d.classes.map((f) => f.value)).toEqual([40, 36, 2]);
    expect(d.deliveredShare).toMatchObject({ value: 90, text: '90%' });
    expect(d.pending[2]).toMatchObject({
      label: 'Marking pending',
      value: null,
      definition: 'Assessments awaiting marks. Not reported: marking is not tracked yet.',
    });
  });

  it.each([
    ['no planned classes', { planned: ok(0, 'x') }],
    ['delivered not reported', { delivered: missing('x', 'y') }],
  ])('the delivered share is not computable with %s', (_n, sessions) => {
    const a = activity();
    const d = deliveryFacts(activity({ sessions: { ...a.sessions, ...sessions } }));
    expect(d.deliveredShare.value).toBeNull();
  });

  it('"where to work on" lists measured non-zero counts only', () => {
    expect(workOn(deliveryFacts(activity()), work)).toEqual([
      '3 teaching logs pending',
      '2 classes without attendance recorded',
      '2 classes cancelled',
      '8 calendar days without an EOD report',
    ]);
    const a = activity();
    const quiet = deliveryFacts(
      activity({
        sessions: { ...a.sessions, cancelled: ok(0, 'x') },
        logsPending: ok(0, 'x'),
        attendancePending: missing('x', 'y'),
      }),
    );
    expect(workOn(quiet, { ...work, eod: { ...work.eod, missing: null } })).toEqual([
      'Nothing pending in this period.',
    ]);
    expect(workOn(null, null)).toEqual(['Nothing pending in this period.']);
  });

  it('the summary is deterministic evidence and names every source it could not read', () => {
    expect(
      teacherSummary({ delivery: deliveryFacts(activity()), unavailableAt: null, reviews, work }),
    ).toEqual([
      'Class delivery: 36 of 40 planned classes delivered (90%); 2 cancelled.',
      'Pending in Academic OS: 3 teaching logs pending, 2 attendance not recorded.',
      'Student reviews: 4 submitted in this period (3 shareable, 1 internal); latest 12 Oct 2026.',
      'Tasks: 4 completed of 6 assigned in the period; 3 open and 1 overdue at the cut-off. EOD reports: 22 of 30 calendar days submitted.',
    ]);
    expect(
      teacherSummary({
        delivery: null,
        unavailableAt: '21 Oct 2026, 10:30 IST',
        reviews: null,
        work: null,
      }),
    ).toEqual([
      'Class delivery: not available for this period (Academic OS unavailable at 21 Oct 2026, 10:30 IST).',
      'Student reviews: not available for this period.',
      'Tasks and EOD reports: not included.',
    ]);
  });
});

function snapshot(over: Partial<TeacherReportSnapshot> = {}): TeacherReportSnapshot {
  const a = activity();
  const delivery = deliveryFacts(a);
  return {
    template: 'teacher-report/1',
    kind: 'internal',
    period: W,
    teacher: {
      name: 'Sample Quant Teacher With A Long Name',
      staffCode: 'DEMO-T01',
      subjects: ['Quant', 'Logical Reasoning'],
      verification: 'Unverified',
      roleNote: null,
      department: 'Academics',
      status: 'active',
      isSample: true,
    },
    academic: {
      status: 'available',
      checkedAt: '2026-10-21T05:00:00.000Z',
      assignments: a.assignments,
      delivery,
    },
    reviews,
    reviewsNote: 'Submitted reviews this teacher wrote in Academic OS.',
    feedback: { approved: 2, rejected: 0, hidden: 1, scope: 'all moderated states' },
    work: { status: 'available', cutOff: '2026-10-20T18:29:59.000Z', ...work },
    workOn: workOn(delivery, work),
    summary: teacherSummary({ delivery, unavailableAt: null, reviews, work }),
    definitions: [
      ...[...delivery.classes, delivery.deliveredShare, ...delivery.pending].map((f) => [
        f.label,
        f.definition,
      ]),
      ...PERIOD_DEFINITIONS.slice(0, 4),
      PERIOD_DEFINITIONS[5],
    ],
    ...over,
  } as TeacherReportSnapshot;
}
const meta = { referenceCode: 'TR-SAMPLE0001', templateVersion: 'teacher-report/1' };

describe('teacher report PDF', () => {
  it('is a two-page A4 folio: bars with values, words for what is not reported, sample banner', async () => {
    const pdf = await teacherReportPdf(snapshot(), meta);
    if (process.env.PDF_SAMPLE_OUT) writeFileSync(process.env.PDF_SAMPLE_OUT, pdf.bytes);
    const pages = (await PDFDocument.load(pdf.bytes)).getPages();
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
    const { lines } = pdf;
    expect(lines).toContain('Sample data — fictional teacher');
    expect(lines[lines.indexOf('Classes planned') + 1]).toBe('40');
    expect(lines[lines.indexOf('Delivered share') + 1]).toBe('90%');
    expect(lines[lines.indexOf('Marking pending') + 1]).toBe('Not reported');
    expect(lines[lines.indexOf('EOD reports submitted') + 1]).toBe('22 of 30 days');
    expect(lines.join(' ')).toContain('• 3 teaching logs pending');
    expect(lines).not.toContain('SR-');
    expect(pdf.unsupportedCharacters).toBe(false);
  });

  it('says Academic OS was unavailable instead of printing zeros, and names withheld sections', async () => {
    const pdf = await teacherReportPdf(
      snapshot({
        academic: {
          status: 'unavailable',
          reason: 'fetch failed',
          checkedAt: '2026-10-21T05:00:00.000Z',
        },
        reviews: null,
        reviewsNote: 'Not included (no feedback permission).',
        feedback: null,
        work: { status: 'not_included', reason: 'no task permission' },
        workOn: ['Nothing pending in this period.'],
        definitions: [],
      }),
      meta,
    );
    const text = pdf.lines.join('\n');
    expect(text).toContain(
      'Academic OS unavailable at 21 Oct 2026, 10:30 am IST; delivery figures not available.',
    );
    expect(text).toContain('Not included (no feedback permission).');
    expect(text).toContain('Not included: no task permission.');
    expect(pdf.lines).not.toContain('Classes planned');
    expect(pdf.lines).not.toContain('0');
  });
});
