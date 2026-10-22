import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  FEE_CHARGE_LABELS,
  FEE_KIND_LABELS,
  FEE_RECORD_STATUSES,
  FEE_STATUS_LABELS,
  MANUAL_FEE_DISCLAIMER,
  type FeeChargeCategory,
} from '../../../domain/fees';
import { listCollections } from '../../../server/fee-collections';
import { rangeOf } from '../../../server/overview';
import { FeesNav } from '../../../ui/admissions-nav';
import { StatCard } from '../../../ui/charts';
import { fmtDate, fmtPaise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { Pager } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { RangeFilter } from '../../_components/range-filter';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Collections' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/fees/collections';

/** /ops/fees/collections — payments and refunds dated in a period (read only, ops:fees:read). */
export default async function CollectionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:fees:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="fees">
      <PageHeader
        title="Collections"
        description="Payments and refunds with a payment date in the period, for the students you may see. To record or correct a payment, open the student's fees."
        tabs={<FeesNav current="collections" user={access.user} />}
      />
      <Section label="Loading collections…">
        <Collections user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Collections({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const at = rangeOf(sp);
  const status = FEE_RECORD_STATUSES.find((s) => s === sp.status);
  const page = Math.max(1, Number.parseInt(sp.page ?? '', 10) || 1);
  const r = await load((db) => listCollections(db, user, { ...at.range, status, page }));
  if (!r.ok) return r.view;
  const d = r.data;
  const params = { ...at.range, status };
  return (
    <div className="el-stack">
      <RangeFilter base={BASE} at={at} keep={{ status }}>
        <div className="el-field">
          <label htmlFor="collections-status">Status</label>
          <select
            id="collections-status"
            name="status"
            className="el-select"
            defaultValue={status ?? ''}
          >
            <option value="">Any</option>
            {FEE_RECORD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FEE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </RangeFilter>
      <ul className="el-grid ops-kpis" aria-label="Collections in the period">
        <li>
          <StatCard
            label="Collected in the period"
            value={d.collected ? fmtPaise(d.collected.netPaise) : null}
            missingLabel="No payment recorded yet"
            note="Payments minus refunds; voided and reversed entries never count"
          />
        </li>
        {d.collected
          ? (Object.entries(d.collected.byCategory) as [FeeChargeCategory, number][]).map(
              ([c, paise]) => (
                <li key={c}>
                  <StatCard
                    label={FEE_CHARGE_LABELS[c]}
                    value={fmtPaise(paise)}
                    note="Net in the period"
                  />
                </li>
              ),
            )
          : null}
      </ul>
      <p className="el-field-hint">{MANUAL_FEE_DISCLAIMER}</p>
      <RecordTable
        caption={`${d.total} entr${d.total === 1 ? 'y' : 'ies'}${status ? ` · ${FEE_STATUS_LABELS[status]}` : ''}`}
        rows={d.rows}
        rowKey={(f) => f.id}
        rowHref={(f) =>
          f.studentId ? `/ops/students/${f.studentId}?tab=fees` : `/ops/admissions/${f.admissionId}`
        }
        linkColumn="student"
        empty="No payment or refund has a payment date in this period."
        columns={[
          { key: 'student', header: 'Student', render: (f) => f.studentName },
          { key: 'date', header: 'Payment date', render: (f) => fmtDate(f.paymentDate) },
          {
            key: 'kind',
            header: 'Entry',
            render: (f) =>
              `${f.kind === 'received' && f.reverses ? 'Reversal' : FEE_KIND_LABELS[f.kind]} · ${FEE_CHARGE_LABELS[f.chargeCategory]}`,
          },
          {
            key: 'amount',
            header: 'Amount',
            numeric: true,
            render: (f) => fmtPaise(f.amountPaise),
          },
          {
            key: 'receipt',
            header: 'Receipt ref.',
            render: (f) => f.receiptReference ?? 'Not given',
          },
          { key: 'code', header: 'Entry no.', render: (f) => f.code },
          {
            key: 'status',
            header: 'Status',
            render: (f) => (
              <StatusBadge tone={statusTone(f.status)}>{FEE_STATUS_LABELS[f.status]}</StatusBadge>
            ),
          },
        ]}
      />
      <Pager basePath={BASE} params={params} page={d.page} pageSize={d.pageSize} total={d.total} />
    </div>
  );
}
