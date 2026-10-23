/**
 * The outstanding segment's drill-down (`/ops/fees?open=outstanding`): the students whose tuition
 * makes up the chart's outstanding figure under the same filters. Its header sums these rows with
 * the chart's own totals function, so the two always agree (A-FEE-9).
 */
import { StatusBadge } from '@elevate/shared-ui';
import { feeYearTotals } from '../../../domain/fee-year';
import { FEE_PAGE_SIZE } from '../../../server/fee-collections';
import type { FeeYearStudent, OwingSort } from '../../../server/fee-year';
import { fmtDate, fmtPaise } from '../../../ui/format';
import { listHref, Pager } from '../../../ui/list-controls';
import { RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { batchLabel } from '../../students/_components/profile-sections';

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const courseLine = (r: FeeYearStudent) =>
  r.courses
    .map(
      (c) =>
        `${c.name ?? 'Programme not set'}, batch ${batchLabel(c.enrolledBatchId, c.intendedBatchId).replace(/^./, (x) => x.toLowerCase())}`,
    )
    .join(' + ') || 'Not recorded in Business Ops';

const SORT_LABELS: Record<OwingSort, string> = {
  overdue: 'Overdue first',
  outstanding: 'Largest balance first',
  name: 'Name',
};

export function OwingDialog({
  rows,
  filters,
  basePath,
  params,
  page,
  closeHref,
  canOpenLedger,
}: {
  /** owingStudents(...) of the same feeYear result the chart uses, in the chosen order. */
  rows: readonly FeeYearStudent[];
  filters: readonly string[];
  basePath: string;
  /** The dialog's URL params (year, course, open, sort); links keep them. */
  params: Record<string, string | undefined> & { sort: OwingSort };
  page: number;
  closeHref: string;
  /** The fee ledger is the student's Fees tab (ops:students:read). */
  canOpenLedger: boolean;
}) {
  const t = feeYearTotals(rows);
  const money = (key: keyof typeof t & `${string}Paise`, header: string) => ({
    key,
    header,
    numeric: true,
    render: (r: FeeYearStudent) => fmtPaise(r[key]),
  });
  return (
    <RecordModal
      id="fee-outstanding"
      title="Students with tuition outstanding"
      meta={filters.map((f) => (
        <StatusBadge key={f} tone="neutral">
          {f}
        </StatusBadge>
      ))}
      closeHref={closeHref}
    >
      <p>
        <strong>{plural(t.students, 'student')}</strong> · {fmtPaise(t.outstandingPaise)}{' '}
        outstanding: {fmtPaise(t.overduePaise)} overdue, {fmtPaise(t.dueNowPaise)} due now (today)
        and {fmtPaise(t.futurePaise)} not yet due.
      </p>
      <p className="el-field-hint">
        A balance is not late until its due date has passed: only the Overdue column is.
        {canOpenLedger
          ? ' Open a student to see their fee ledger.'
          : ' Opening a fee ledger needs access to student records.'}
      </p>
      <nav className="el-inline-form" aria-label="Order of students">
        <span>Order:</span>
        {(Object.keys(SORT_LABELS) as OwingSort[]).map((k) => (
          <a
            key={k}
            href={listHref(basePath, params, { sort: k, page: undefined })}
            aria-current={k === params.sort ? 'true' : undefined}
          >
            {SORT_LABELS[k]}
          </a>
        ))}
      </nav>
      <RecordTable
        caption={`${plural(t.students, 'student')} · ${fmtPaise(t.outstandingPaise)} outstanding`}
        rows={rows.slice((page - 1) * FEE_PAGE_SIZE, page * FEE_PAGE_SIZE)}
        rowKey={(r) => r.planId}
        rowHref={canOpenLedger ? (r) => `/ops/students/${r.studentId}?tab=fees` : undefined}
        empty="No tuition is outstanding under these filters."
        columns={[
          {
            key: 'student',
            header: 'Student',
            render: (r) => (
              <>
                {r.studentName ?? 'Not linked'}
                {r.isSample ? <span className="el-badge el-badge-sample">SAMPLE DATA</span> : null}
                {r.closed ? <StatusBadge tone="neutral">Agreement closed</StatusBadge> : null}
              </>
            ),
          },
          {
            key: 'number',
            header: 'Admission number',
            render: (r) => r.admissionNumber ?? 'Not given yet',
          },
          { key: 'course', header: 'Course and batch', render: courseLine },
          money('billedPaise', 'Net annual tuition'),
          money('paidPaise', 'Paid'),
          money('outstandingPaise', 'Outstanding'),
          money('overduePaise', 'Overdue'),
          money('dueNowPaise', 'Due now'),
          money('futurePaise', 'Not yet due'),
          {
            key: 'next',
            header: 'Next due date',
            render: (r) => (r.nextDueDate ? fmtDate(r.nextDueDate) : 'No due date'),
          },
        ]}
      />
      <Pager
        basePath={basePath}
        params={params}
        page={page}
        pageSize={FEE_PAGE_SIZE}
        total={rows.length}
      />
    </RecordModal>
  );
}
