/**
 * `<base>/my-payslips` (F4-14): the signed-in person's payslips, each once that month's payroll
 * is approved, with its PDF. Nothing in the URL can point it at someone else. For Ops, Academic
 * and Marketing (work.ts), like My attendance.
 */
import { LINK_LOGIN_HELP } from '@elevate/shared-contracts';
import { EmptyState, PageHeader } from '@elevate/shared-ui';
import { PAY_MODE_LABELS } from '../../domain/payroll';
import { myPayslips } from '../../server/payroll-read';
import { fmtDate, fmtMonth, fmtPaise, plural } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { RecordTable } from '../../ui/record-table';
import type { BodyProps } from '../tasks/_components/bodies';
import '../ops.css';

export function MyPayslipsBody(props: Omit<BodyProps, 'searchParams'>) {
  return (
    <>
      <PageHeader
        title="My payslips"
        description="Your payslip for each month once payroll is approved. Questions about your pay go to HR."
      />
      <Section label="Loading your payslips…">
        <MyPayslips {...props} />
      </Section>
    </>
  );
}

async function MyPayslips({ user, base }: Omit<BodyProps, 'searchParams'>) {
  const r = await load((db) => myPayslips(db, user));
  if (!r.ok) return r.view;
  if (!r.data)
    return (
      <EmptyState
        title="No staff record"
        description={`Your login is not linked to a staff record yet, so there are no payslips to show. ${LINK_LOGIN_HELP}`}
      />
    );
  return (
    <RecordTable
      caption={plural(r.data.length, 'payslip')}
      rows={r.data}
      rowKey={(p) => p.id}
      empty="No payslips yet. Each one appears here when that month's payroll is approved."
      columns={[
        { key: 'month', header: 'Month', render: (p) => fmtMonth(p.month.slice(0, 7)) },
        {
          key: 'earnings',
          header: 'Earnings',
          numeric: true,
          render: (p) => fmtPaise(p.earningsPaise),
        },
        {
          key: 'deductions',
          header: 'Deductions',
          numeric: true,
          render: (p) => fmtPaise(p.deductionsPaise),
        },
        { key: 'net', header: 'Net pay', numeric: true, render: (p) => fmtPaise(p.netPaise) },
        {
          key: 'paid',
          header: 'Paid',
          render: (p) =>
            p.paidOn ? `${fmtDate(p.paidOn)}, ${PAY_MODE_LABELS[p.paidMode!]}` : 'Not paid yet',
        },
        {
          key: 'pdf',
          header: 'Payslip',
          render: (p) => (
            <a href={`${base}/api/v1/payslips/${p.id}/pdf`} download>
              Download PDF
              <span className="el-visually-hidden"> for {fmtMonth(p.month.slice(0, 7))}</span>
            </a>
          ),
        },
      ]}
    />
  );
}
