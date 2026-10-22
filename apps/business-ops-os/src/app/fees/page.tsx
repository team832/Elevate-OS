import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ALLOWED_PROGRAMME_COMBINATIONS, combinationLabel } from '../../domain/catalog';
import { listFeeStructures } from '../../server/fees';
import { formOptions } from '../../server/options';
import { ActionForm } from '../../ui/action-form';
import { FeesNav } from '../../ui/admissions-nav';
import { StatCard } from '../../ui/charts';
import { fmtDateTime, fmtPaise } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, options } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fee structure' };

type Params = Record<string, string | undefined>;
type Fee = Awaited<ReturnType<typeof listFeeStructures>>['items'][number];
const BASE = '/ops/fees';

const MODE_TEXT: Record<Fee['mode'], string> = {
  online: 'Online',
  offline_sikar: 'Offline, Sikar centre',
  both: 'Online and offline (Sikar)',
};

const comboKey = (codes: readonly string[]) => [...codes].sort().join('+');

function SourceBadge({ source }: { source: Fee['source'] }) {
  if (source === 'sample') return <span className="el-badge el-badge-sample">SAMPLE</span>;
  return source === 'website_stated' ? (
    <StatusBadge tone="warning">From website, unverified</StatusBadge>
  ) : (
    <StatusBadge tone="success">Owner approved</StatusBadge>
  );
}

const StatusText = ({ status }: { status: Fee['status'] }) => (
  <StatusBadge tone={status === 'approved' ? 'success' : 'neutral'}>
    {status === 'approved' ? 'Approved' : 'Draft'}
  </StatusBadge>
);

const amount = (f: Fee) =>
  `${fmtPaise(f.amountPaise)}${f.billingPeriod === 'per_month' ? ' per month' : ' course total'}`;

const instalments = (f: Fee) =>
  f.instalmentCount
    ? `${f.instalmentCount} instalment${f.instalmentCount === 1 ? '' : 's'}${f.instalmentNote ? `: ${f.instalmentNote}` : ''}`
    : (f.instalmentNote ?? 'Not set');

export default async function FeesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:fees:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="fees">
      <PageHeader
        title="Fee structure"
        description="Course fees by programme and mode; sample figures until the owner approves them."
        tabs={<FeesNav current="structure" user={access.user} />}
      />
      <Section label="Loading the fee structure…">
        <Fees user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Fees({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const r = await load(async (db) => {
    const [fees, opts] = await Promise.all([listFeeStructures(db, user), formOptions(db)]);
    return { fees, opts };
  });
  if (!r.ok) return r.view;
  const { items } = r.data.fees;
  // formOptions labels read "CODE — Name (status)"; the name is all a combination label needs.
  const names = Object.fromEntries(
    r.data.opts.programmes.map((p) => [
      p.value,
      p.label.replace(`${p.value} — `, '').replace(/ \([a-z_]+\)$/, ''),
    ]),
  );
  const order = new Map(ALLOWED_PROGRAMME_COMBINATIONS.map((c, i) => [comboKey(c), i]));
  const inCatalog = items
    .filter((f) => order.has(comboKey(f.programmeCodes)))
    .sort(
      (a, b) => order.get(comboKey(a.programmeCodes))! - order.get(comboKey(b.programmeCodes))!,
    );
  const others = items.filter((f) => !order.has(comboKey(f.programmeCodes)));
  const covered = new Set(inCatalog.map((f) => comboKey(f.programmeCodes)));
  const missing = ALLOWED_PROGRAMME_COMBINATIONS.filter((c) => !covered.has(comboKey(c)));
  const bySource = (s: Fee['source']) => items.filter((f) => f.source === s).length;
  const open = items.find((f) => f.id === sp.open);
  const edit = can(user, 'ops:fees:record');
  const close = (patch: Params) => listHref(BASE, sp, patch);
  const table = (rows: Fee[], caption: string) => (
    <RecordTable
      caption={caption}
      rows={rows}
      rowKey={(f) => f.id}
      rowHref={(f) => close({ open: f.id, act: undefined })}
      empty="No figures recorded."
      columns={[
        {
          key: 'combination',
          header: 'Programme combination',
          render: (f) => combinationLabel(f.programmeCodes, names),
        },
        { key: 'mode', header: 'Mode', render: (f) => MODE_TEXT[f.mode] },
        {
          key: 'amount',
          header: 'Fee',
          numeric: true,
          render: (f) =>
            `${fmtPaise(f.amountPaise)}${f.billingPeriod === 'per_month' ? ' / month' : ''}`,
        },
        { key: 'instalments', header: 'Instalment template', render: instalments },
        { key: 'source', header: 'Source', render: (f) => <SourceBadge source={f.source} /> },
        { key: 'status', header: 'Status', render: (f) => <StatusText status={f.status} /> },
      ]}
    />
  );
  return (
    <div className="el-stack">
      {bySource('sample') ? (
        <Alert
          tone="warning"
          title="Sample figures are placeholders: replace them with your real fees"
        >
          Rows marked SAMPLE were made up for development. Open a row and edit it to enter the real
          fee; marking it owner-approved needs a note saying where you confirmed it.
        </Alert>
      ) : null}
      <ul className="el-grid ops-kpis" aria-label="Fee structure figures">
        <li>
          <StatCard
            label="Combinations covered"
            value={`${covered.size} of ${ALLOWED_PROGRAMME_COMBINATIONS.length}`}
            note="Allowed combinations with at least one fee row"
          />
        </li>
        <li>
          <StatCard
            label="Owner approved"
            value={bySource('owner_approved')}
            note="Figures the owner confirmed"
          />
        </li>
        <li>
          <StatCard label="Sample" value={bySource('sample')} note="Placeholders to replace" />
        </li>
        <li>
          <StatCard
            label="From website, unverified"
            value={bySource('website_stated')}
            note="Prices quoted on elevateeducation.in"
          />
        </li>
      </ul>
      <Segment
        title="Programme combinations"
        flush
        description="One row per combination and mode, in programme-list order. Fees are course totals unless marked / month."
      >
        {table(inCatalog, `${inCatalog.length} fee row${inCatalog.length === 1 ? '' : 's'}`)}
      </Segment>
      {missing.length ? (
        <Alert tone="warning" title="No fee recorded for these combinations">
          {missing.map((c) => combinationLabel(c, names)).join('; ')}.
        </Alert>
      ) : null}
      {others.length ? (
        <Segment
          title="Other figures on record"
          flush
          description="Figures that do not match one of the allowed combinations (for example website batches). Kept as drafts for reference."
        >
          {table(others, `${others.length} row${others.length === 1 ? '' : 's'}`)}
        </Segment>
      ) : null}
      {open && sp.act === 'edit' && edit ? (
        <FeeEdit f={open} closeHref={close({ act: undefined })} />
      ) : open ? (
        <RecordModal
          id="fee-modal"
          title={combinationLabel(open.programmeCodes, names)}
          meta={
            <>
              <SourceBadge source={open.source} /> <StatusText status={open.status} />
            </>
          }
          closeHref={close({ open: undefined, act: undefined })}
          returnId={open.id}
        >
          <Segment
            title="Fee"
            level={3}
            flush
            actions={edit ? <a href={close({ act: 'edit' })}>Edit fee</a> : undefined}
          >
            <DetailTable
              rows={[
                { label: 'Label', value: open.label },
                { label: 'Mode', value: MODE_TEXT[open.mode] },
                { label: 'Fee', value: amount(open) },
                { label: 'Instalment template', value: instalments(open) },
                { label: 'Billing note', value: open.billingNote ?? 'None' },
                { label: 'Source', value: <SourceBadge source={open.source} /> },
                { label: 'Evidence', value: open.sourceNote ?? 'Not recorded' },
                { label: 'Status', value: <StatusText status={open.status} /> },
                { label: 'Last changed', value: fmtDateTime(open.updatedAt) },
              ]}
            />
          </Segment>
        </RecordModal>
      ) : null}
    </div>
  );
}

function FeeEdit({ f, closeHref }: { f: Fee; closeHref: string }) {
  return (
    <FormModal id="fee-edit" title={`Edit fee: ${f.label}`} closeHref={closeHref}>
      <ActionForm
        action={`/ops/api/v1/fee-structures/${f.id}`}
        method="PATCH"
        submitLabel="Save fee"
        redirectTo={closeHref}
        secondary={<a href={closeHref}>Cancel</a>}
        fields={[
          { name: 'label', label: 'Label', defaultValue: f.label, section: 'Fee' },
          {
            name: 'mode',
            label: 'Mode',
            type: 'select',
            required: true,
            defaultValue: f.mode,
            options: Object.entries(MODE_TEXT).map(([value, label]) => ({ value, label })),
            section: 'Fee',
          },
          {
            name: 'amountRupees',
            label: 'Amount (₹)',
            type: 'money',
            defaultValue: String(f.amountPaise / 100),
            hint:
              f.source === 'sample'
                ? 'e.g. 150000 or 1,50,000. A SAMPLE row stays sample (and is deleted when sample data is cleared) until it is marked owner-approved below.'
                : 'e.g. 150000 or 1,50,000',
            section: 'Fee',
          },
          {
            name: 'billingPeriod',
            label: 'Charged as',
            type: 'select',
            required: true,
            defaultValue: f.billingPeriod,
            options: [
              { value: 'course_total', label: 'Course total' },
              { value: 'per_month', label: 'Per month' },
            ],
            section: 'Fee',
          },
          {
            name: 'instalmentCount',
            label: 'Number of instalments',
            type: 'number',
            defaultValue: f.instalmentCount ? String(f.instalmentCount) : '',
            section: 'Instalments',
          },
          {
            name: 'instalmentNote',
            label: 'When instalments fall due',
            defaultValue: f.instalmentNote ?? '',
            section: 'Instalments',
          },
          {
            name: 'billingNote',
            label: 'Billing note',
            type: 'textarea',
            defaultValue: f.billingNote ?? '',
            section: 'Instalments',
          },
          {
            name: 'source',
            label: 'Mark as owner-approved',
            type: 'select',
            options: [{ value: 'owner_approved', label: 'Yes: the owner confirmed this fee' }],
            hint:
              f.source === 'owner_approved'
                ? 'Already owner-approved.'
                : 'Leave empty to keep it as it is now.',
            section: 'Approval',
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            required: true,
            defaultValue: f.status,
            options: options(['draft', 'approved']),
            hint: 'Only an owner-approved fee can be approved.',
            section: 'Approval',
          },
          {
            name: 'sourceNote',
            label: 'Evidence',
            defaultValue: f.sourceNote ?? '',
            section: 'Approval',
          },
          {
            name: 'reason',
            label: 'Reason',
            type: 'textarea',
            hint: 'Required (10 or more characters) to mark owner-approved or approved: say where the owner confirmed it.',
            section: 'Approval',
          },
        ]}
      />
    </FormModal>
  );
}
