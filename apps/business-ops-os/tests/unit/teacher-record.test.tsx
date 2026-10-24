import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { metric, type AcademicTeacherActivityV1 } from '@elevate/shared-contracts';
import type { AuthenticatedUser } from '@elevate/authentication';
import { AssessmentCounts } from '../../src/app/teachers/teacher-record';
import { AcademicReviewList } from '../../src/ui/student-feedback-section';

const meta = {
  definition: 'Assessments in the window',
  window: { from: '2026-10-01', to: '2026-10-31' },
  unit: 'count',
} as const;
const activity = (assessments: AcademicTeacherActivityV1['assessments']) =>
  ({ window: meta.window, assessments }) as AcademicTeacherActivityV1;

describe('Ops teacher page — assessment counts from Academic', () => {
  it.each([
    ['Assessments assigned', '4'],
    ['Completed', '0'],
    ['Awaiting marking', 'Not recorded'],
    ['Results published', 'Not recorded'],
  ])('%s shows %s (missing is "Not recorded", a measured 0 stays 0)', (label, value) => {
    const html = renderToStaticMarkup(
      <AssessmentCounts
        a={activity({
          prepared: metric.ok(1, meta),
          marked: metric.ok(1, meta),
          assigned: metric.ok(4, meta),
          completed: metric.ok(0, meta),
          awaitingMarking: metric.missing('No roster snapshot yet.', meta),
        })}
      />,
    );
    const item = html.split('<li').find((li) => li.includes(`>${label}<`));
    expect(item).toContain(`class="el-metric-value">${value}<`);
  });

  it('an older Academic without the counts shows all four as Not recorded', () => {
    const html = renderToStaticMarkup(<AssessmentCounts a={activity(undefined)} />);
    expect(html.match(/el-metric-value">Not recorded</g)).toHaveLength(4);
  });
});

describe('Ops review list — observation date and batch', () => {
  const user = { id: 'u1', roles: ['operations_manager'] } as unknown as AuthenticatedUser;
  const review = (batchId: string | null) =>
    ({
      reviewKey: '00000000-0000-4000-8000-000000000001',
      version: 1,
      superseded: false,
      subjectName: 'Sample Maths',
      authorName: 'Sample Teacher',
      studentName: 'Sample Student',
      reviewType: 'periodic',
      sessionDate: null,
      periodFrom: null,
      periodTo: null,
      observationOn: '2026-10-20',
      batchId,
      visibility: 'internal',
      submittedAt: '2026-10-21T05:00:00Z',
      coreStudentId: null,
      acknowledgements: [],
    }) as never;
  const render = (batchId: string | null) =>
    renderToStaticMarkup(
      <AcademicReviewList
        result={{
          status: 'available',
          checkedAt: '2026-10-21T05:00:00Z',
          reviews: [review(batchId)],
        }}
        user={user}
        batchNames={new Map([['b-1', 'Sample IPMAT Morning']])}
      />,
    );

  it.each([
    ['b-1', 'Sample IPMAT Morning'],
    ['b-other', 'Batch recorded in Academic'],
  ])('batch %s shows %s and the observation date', (batchId, shown) => {
    const html = render(batchId);
    expect(html).toContain(shown);
    expect(html).toContain('Observed on');
    expect(html).toContain('20 Oct 2026');
    expect(html).not.toContain(batchId);
  });

  it('no batch on the review: no batch row', () => {
    expect(render(null)).not.toContain('>Batch<');
  });
});
