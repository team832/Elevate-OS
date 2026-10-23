import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwingDialog } from '../../src/app/fees/_components/owing-dialog';
import { owingStudents, type FeeYearStudent, type OwingSort } from '../../src/server/fee-year';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const student = (id: string, extra: Partial<FeeYearStudent>): FeeYearStudent => ({
  planId: `plan-${id}`,
  studentId: id,
  studentName: `Sample Student ${id}`,
  isSample: false,
  admissionNumber: null,
  courses: [{ name: 'CLAT', enrolledBatchId: null, intendedBatchId: 'b1' }],
  closed: false,
  reconciled: true,
  billedPaise: 100_000_00,
  paidPaise: 50_000_00,
  outstandingPaise: 50_000_00,
  dueNowPaise: 0,
  overduePaise: 25_000_00,
  futurePaise: 25_000_00,
  creditPaise: 0,
  nextDueDate: '2026-09-01',
  ...extra,
});
const rows = [
  student('s1', { isSample: true, admissionNumber: 'ELV/2026/001' }),
  student('s2', {
    closed: true,
    outstandingPaise: 1_25_000_00,
    overduePaise: 0,
    futurePaise: 1_25_000_00,
  }),
];
const render = (canOpenLedger: boolean, list = rows, page = 1, sort: OwingSort = 'overdue') =>
  renderToStaticMarkup(
    <OwingDialog
      rows={list}
      filters={['Academic year 2026-27', 'All courses']}
      basePath="/ops/fees"
      params={{ year: '2026-27', open: 'outstanding', sort }}
      page={page}
      closeHref="/ops/fees?year=2026-27"
      canOpenLedger={canOpenLedger}
    />,
  );

describe('Outstanding tuition drill-down', () => {
  const out = render(true);

  it('heads with the count and the exact sum of its rows, overdue apart from not yet due', () => {
    expect(out).toContain('<strong>2 students</strong> · ₹1,75,000');
    expect(out).toContain('₹25,000 overdue, ₹0 due now (today) and ₹1,50,000 not yet due');
    expect(out).toContain('Academic year 2026-27');
    expect(out).toContain('All courses');
  });

  it('never calls anyone a defaulter', () => {
    expect(out).not.toMatch(/default/i);
  });

  it('labels sample students and closed agreements; names a missing admission number', () => {
    expect(out.match(/SAMPLE DATA/g)).toHaveLength(1);
    expect(out).toContain('Agreement closed');
    expect(out).toContain('ELV/2026/001');
    expect(out).toContain('Not given yet');
    expect(out).toContain('CLAT, batch requested from Academic OS');
  });

  it.each([
    [true, true],
    [false, false],
  ])('ledger link with student access %s', (can, linked) => {
    const html = render(can);
    expect(html.includes('href="/ops/students/s1?tab=fees"')).toBe(linked);
    if (!linked) expect(html).toContain('needs access to student records');
  });

  it('pages after 25 students; the header still sums every student', () => {
    const many = Array.from({ length: 30 }, (_, i) => student(`m${i}`, {}));
    const first = render(true, many);
    expect(first.match(/data-row-link/g)).toHaveLength(25);
    expect(first).toContain('Showing 1–25 of 30');
    expect(first).toContain('<strong>30 students</strong> · ₹15,00,000');
    expect(first).toContain(
      'href="/ops/fees?year=2026-27&amp;open=outstanding&amp;sort=overdue&amp;page=2"',
    );
    expect(render(true, many, 2).match(/data-row-link/g)).toHaveLength(5);
  });

  it('marks the current order; changing it goes back to page 1', () => {
    const out = render(true, rows, 2, 'name');
    expect(out).toContain(
      'href="/ops/fees?year=2026-27&amp;open=outstanding&amp;sort=name" aria-current="true"',
    );
  });

  it.each<[OwingSort, string[]]>([
    ['overdue', ['s1', 's2']],
    ['outstanding', ['s2', 's1']],
    ['name', ['s1', 's2']],
  ])('order %s', (sort, ids) => {
    const fully = student('s3', { outstandingPaise: 0, overduePaise: 0, futurePaise: 0 });
    expect(owingStudents([...rows, fully], sort).map((r) => r.studentId)).toEqual(ids);
  });
});
