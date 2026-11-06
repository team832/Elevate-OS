import type { AuthenticatedUser } from '@elevate/authentication';
import { ButtonLink, PageHeader, SourceBadge } from '@elevate/shared-ui';
import { MANUAL_FEE_DISCLAIMER } from '../../../domain/fees';
import {
  defaultersQuery,
  listDefaulters,
  names,
  OVERDUE_BANDS,
  type DefaultersQuery,
} from '../../../server/fee-defaulters';
import { FeesNav } from '../../../ui/admissions-nav';
import { fmtDate, fmtPaise, sampleNote } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { FilterForm, listHref, Pager } from '../../../ui/list-controls';
import { openHref } from '../../../ui/open-link';
import { RecordTable } from '../../../ui/record-table';
import { paymentNote } from '../_components/owing-dialog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overdue fees' };

const BASE = '/ops/fees/defaulters';
const BANDS = Object.entries(OVERDUE_BANDS).map(([value, [label]]) => ({ value, label }));
const filters = ({ programme, counsellor, band }: DefaultersQuery) => ({
  programme,
  counsellor,
  band,
});

/** /ops/fees/defaulters — students with tuition instalments past due and not fully paid (F4-04, ops:fees:read). */
export default async function DefaultersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:fees:read', BASE);
  const q = defaultersQuery.parse(await searchParams);
  return (
    <Frame access={access} active="fees-defaulters">
      <PageHeader
        title="Overdue fees"
        description={`Students with a tuition instalment past its due date and not fully paid, most days overdue first. ${paymentNote(access.user)}`}
        actions={
          <ButtonLink href={listHref('/ops/api/v1/fees/defaulters', filters(q))}>
            Download spreadsheet (CSV)
          </ButtonLink>
        }
        tabs={<FeesNav current="defaulters" user={access.user} />}
      />
      <Section label="Loading overdue fees…">
        <Defaulters user={access.user} q={q} />
      </Section>
    </Frame>
  );
}

async function Defaulters({ user, q }: { user: AuthenticatedUser; q: DefaultersQuery }) {
  const r = await load((db) => listDefaulters(db, user, q));
  if (!r.ok) return r.view;
  const d = r.data;
  return (
    <div className="el-stack">
      <FilterForm
        action={BASE}
        submitLabel="Show these students"
        resetHref={BASE}
        fields={[
          {
            name: 'programme',
            label: 'Programme',
            type: 'select',
            options: d.programmes,
            value: q.programme,
          },
          {
            name: 'counsellor',
            label: 'Counsellor',
            type: 'select',
            options: d.counsellors,
            value: q.counsellor,
          },
          { name: 'band', label: 'Days overdue', type: 'select', options: BANDS, value: q.band },
        ]}
      />
      {d.samplePaise ? (
        <p className="el-field-hint">
          <SourceBadge source="sample" /> {sampleNote(d.samplePaise)}
        </p>
      ) : null}
      <p className="el-field-hint">
        {MANUAL_FEE_DISCLAIMER} Overdue means the due date has passed; an instalment without a due
        date is never overdue. Days overdue count from the oldest unpaid due date.
      </p>
      <RecordTable
        caption={`${d.total} student(s) · ${fmtPaise(d.overduePaise)} overdue`}
        rows={d.rows}
        rowKey={(s) => s.studentId}
        rowHref={(s) => openHref(user, s.href) ?? openHref(user, s.caseHref)}
        linkColumn="student"
        sampleOf={(s) => s.isSample}
        empty={
          d.any
            ? 'No student matches these filters.'
            : 'No tuition instalment is overdue on any fee agreement you may see.'
        }
        columns={[
          { key: 'student', header: 'Student', render: (s) => s.studentName ?? 'Not linked' },
          { key: 'programme', header: 'Programme', render: (s) => names(s.programmes, '—') },
          {
            key: 'counsellor',
            header: 'Counsellor',
            render: (s) => names(s.counsellors, 'Not assigned'),
          },
          {
            key: 'days',
            header: 'Days overdue',
            numeric: true,
            render: (s) => `${s.daysOverdue} (due ${fmtDate(s.oldestDue)})`,
          },
          {
            key: 'amount',
            header: 'Amount overdue',
            numeric: true,
            render: (s) => `${fmtPaise(s.overduePaise)} · ${s.instalments} instalment(s)`,
          },
          {
            key: 'paid',
            header: 'Last payment',
            render: (s) => (s.lastPaymentOn ? fmtDate(s.lastPaymentOn) : 'None recorded'),
          },
        ]}
      />
      <Pager
        basePath={BASE}
        params={filters(q)}
        page={d.page}
        pageSize={d.pageSize}
        total={d.total}
      />
    </div>
  );
}
