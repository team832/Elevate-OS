/** Leave applications: the table on HR attendance, My attendance and the staff record, and their forms. */
import type { ReactNode } from 'react';
import type { Database } from '@elevate/database';
import { StatusBadge, Subnav, type Column, type Tone } from '@elevate/shared-ui';
import {
  LEAVE_STATUS_LABELS,
  LEAVE_STATUSES,
  LEAVE_WHY_HIDDEN,
  leaveRange,
  type LeaveStatus,
} from '../../../../domain/leave';
import { balanceText, overBalanceText } from '../../../../domain/leave-balance';
import { listAttachments, type AttachmentListRow } from '../../../../server/attachments';
import type { Actor } from '../../../../server/context';
import type { LeaveList } from '../../../../server/leave-applications';
import { ActionForm } from '../../../../ui/action-form';
import { AttachmentUpload } from '../../../../ui/attachments';
import { fmtDateTime } from '../../../../ui/format';
import { listHref, Pager } from '../../../../ui/list-controls';
import { RecordTable } from '../../../../ui/record-table';
import { BASE } from './days';

type Row = LeaveList['items'][number];
const LEAVE_API = 'api/v1/attendance/leave-applications';
const TONE: Record<LeaveStatus, Tone> = {
  pending: 'info',
  approved: 'success',
  rejected: 'neutral',
  cancelled: 'neutral',
};

/** Each application's letters and certificates, and the workspace API they download from. */
export interface LeaveFiles {
  api: string;
  /** null = this reader may not open that application's files (a cover outside their own reach). */
  byId: Record<string, readonly AttachmentListRow[] | null>;
}

/**
 * Only for a reader the attachment rule lets read every row: the applicant, or a leave approver.
 * shortcut: one access check per row (a page is 25); batch it if pages grow.
 */
export const leaveFiles = async (
  db: Database,
  user: Actor,
  api: string,
  rows: readonly Row[],
): Promise<LeaveFiles> => ({
  api,
  byId: Object.fromEntries(
    await Promise.all(
      rows.map(async (r) => [
        r.id,
        await listAttachments(db, user, 'leave_application', r.id).catch(() => null),
      ]),
    ),
  ),
});

const fileLinks = ({ api, byId }: LeaveFiles, r: Row) =>
  byId[r.id] === null
    ? LEAVE_WHY_HIDDEN
    : byId[r.id]?.length
    ? byId[r.id]!.map((f, i) => (
        <span key={f.id}>
          {i ? ', ' : null}
          <a href={`${api}/attachments/${f.id}`} download>
            {f.name}
          </a>
        </span>
      ))
    : 'None';

export function LeaveTable({
  rows,
  staffHref,
  actions,
  files,
  empty,
}: {
  rows: Row[];
  /** Adds the name column, linking to that person's history. */
  staffHref?: (r: Row) => string;
  actions?: (r: Row) => ReactNode;
  /** Adds the files column. */
  files?: LeaveFiles;
  empty: ReactNode;
}) {
  const columns: Column<Row>[] = [
    { key: 'dates', header: 'Dates', render: (r) => leaveRange(r.fromDate, r.toDate, r.dayPart) },
    ...(staffHref
      ? [
          {
            key: 'staff',
            header: 'Staff member',
            render: (r: Row) => <a href={staffHref(r)}>{r.staffName}</a>,
          },
        ]
      : []),
    { key: 'kind', header: 'Type', render: (r) => r.kind },
    {
      key: 'balance',
      header: 'Balance now',
      render: (r) =>
        r.status === 'pending' && r.balance ? (
          <>
            {balanceText(r.balance)}
            {r.overBy ? <StatusBadge tone="warning">{overBalanceText(r.overBy)}</StatusBadge> : null}
          </>
        ) : null,
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason ?? LEAVE_WHY_HIDDEN },
    ...(files ? [{ key: 'files', header: 'Files', render: (r: Row) => fileLinks(files, r) }] : []),
    { key: 'sent', header: 'Applied', render: (r) => fmtDateTime(r.createdAt) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <>
          <StatusBadge tone={TONE[r.status]}>{LEAVE_STATUS_LABELS[r.status]}</StatusBadge>
          {[
            r.decisionNote,
            r.cancelReason && `Cancelled: ${r.cancelReason}`,
            r.decidedAt && `Decided ${fmtDateTime(r.decidedAt)}`,
            r.decidedFor,
          ]
            .filter(Boolean)
            .map((line) => (
              <p key={line as string} className="el-field-hint">
                {line}
              </p>
            ))}
        </>
      ),
    },
    ...(actions ? [{ key: 'action', header: 'Action', render: actions }] : []),
  ];
  return (
    <RecordTable
      rows={rows}
      rowKey={(r) => r.id}
      caption="Leave applications, newest first"
      empty={empty}
      columns={columns}
      sortedBy={{ column: 'sent', direction: 'descending' }}
      sampleOf={(r) => r.isSample}
    />
  );
}

const suffix = (r: Row) => ` — ${r.staffName}, ${leaveRange(r.fromDate, r.toDate)}`;

export function ApplyForLeave({ base, types }: { base: string; types: readonly string[] }) {
  return (
    <ActionForm
      action={`${base}/${LEAVE_API}`}
      submitLabel="Apply for leave"
      successText="Sent. You get a notification when it is decided."
      resetOnSuccess
      fields={[
        {
          name: 'kind',
          label: 'Type of leave',
          type: 'select',
          required: true,
          options: types.map((t) => ({ value: t, label: t })),
        },
        { name: 'fromDate', label: 'First day', type: 'date', required: true },
        {
          name: 'toDate',
          label: 'Last day',
          type: 'date',
          required: true,
          hint: 'The same as the first day for one day of leave.',
        },
        HALF_DAY_FIELD,
        { name: 'reason', label: 'Reason', type: 'textarea', required: true },
      ]}
    />
  );
}

/** Half-day leave (F4-12): one day only; the server refuses it on longer leave. */
export const HALF_DAY_FIELD = {
  name: 'dayPart',
  label: 'Half day (optional)',
  type: 'select' as const,
  options: [
    { value: 'first_half', label: 'First half of the day' },
    { value: 'second_half', label: 'Second half of the day' },
  ],
  hint: 'Only for one day of leave. A half day counts 0.5.',
};

/** What the applicant can do with their own application. */
export function myLeaveAction(base: string, r: Row) {
  if (r.status === 'approved')
    return <p className="el-field-hint">To cancel approved leave, ask HR.</p>;
  if (r.status !== 'pending') return null;
  return (
    <>
      <details>
        <summary>Attach a letter or certificate</summary>
        <AttachmentUpload
          apiBase={`${base}/api/v1`}
          ownerKind="leave_application"
          ownerId={r.id}
          purpose="evidence"
          label={`File for ${leaveRange(r.fromDate, r.toDate)}`}
        />
      </details>
      <ActionForm
        action={`${base}/${LEAVE_API}/${r.id}/cancel`}
        extra={{ version: r.version }}
        submitLabel="Cancel application"
        successText="Application cancelled."
        labelSuffix={suffix(r)}
        variant="secondary"
        compact
      />
    </>
  );
}

const reasonField = (label: string, name: string) => [
  { name, label, type: 'textarea' as const, required: true },
];

/** Approve, reject or cancel, for someone allowed to decide; never on your own application. */
function decideLeaveAction(r: Row, ownStaffId: string | null) {
  if (r.status !== 'pending' && r.status !== 'approved') return null;
  if (r.staffId === ownStaffId)
    return <p className="el-field-hint">Your own: another HR person decides this.</p>;
  const action = `/ops/${LEAVE_API}/${r.id}`;
  if (r.status === 'approved')
    return (
      <details>
        <summary>Cancel leave</summary>
        <ActionForm
          action={`${action}/cancel`}
          extra={{ version: r.version }}
          submitLabel="Cancel this leave"
          successText="Leave cancelled."
          labelSuffix={suffix(r)}
          variant="danger"
          fields={reasonField('Why (shown to the employee)', 'reason')}
        />
      </details>
    );
  return (
    <>
      <ActionForm
        action={action}
        extra={{ decision: 'approved', version: r.version }}
        submitLabel="Approve"
        successText="Approved."
        labelSuffix={suffix(r)}
        compact
      />
      <details>
        <summary>Reject</summary>
        <ActionForm
          action={action}
          extra={{ decision: 'rejected', version: r.version }}
          submitLabel="Reject application"
          successText="Rejected."
          labelSuffix={suffix(r)}
          variant="danger"
          fields={reasonField('Why (shown to the employee)', 'note')}
        />
      </details>
    </>
  );
}

type Params = Record<string, string | undefined>;

/** /ops/hr/attendance?tab=leave: one person's history with `staffId`, each status with `status`. */
export function LeaveTab({
  list,
  params,
  canDecide,
  ownStaffId,
  files,
}: {
  list: LeaveList;
  params: Params;
  canDecide: boolean;
  ownStaffId: string | null;
  files?: LeaveFiles;
}) {
  const view = (status?: string, staffId = params.staffId) =>
    listHref(BASE, { tab: 'leave', status, staffId });
  // Waiting is the default view, so it has no status in its link.
  const named = LEAVE_STATUSES.includes(params.status as LeaveStatus) || params.status === 'all';
  const current = named && params.status !== 'pending' ? params.status : undefined;
  const all = LEAVE_STATUSES.reduce((sum, s) => sum + list.counts[s], 0);
  return (
    <>
      <Subnav
        label="Leave applications by status"
        items={[
          ...LEAVE_STATUSES.map((s): [string, string] => [
            view(s === 'pending' ? undefined : s),
            `${LEAVE_STATUS_LABELS[s]} (${list.counts[s]})`,
          ]),
          [view('all'), `All (${all})`],
        ]}
        current={view(current)}
      />
      {params.staffId ? (
        <p>
          One person&apos;s applications. <a href={view(params.status, '')}>Show everyone</a>
        </p>
      ) : null}
      <LeaveTable
        rows={list.items}
        staffHref={(r) => view('all', r.staffId)}
        files={files}
        empty={
          current
            ? 'No leave applications here.'
            : 'No leave applications are waiting. Staff apply from My attendance.'
        }
        actions={canDecide ? (r) => decideLeaveAction(r, ownStaffId) : undefined}
      />
      <Pager
        basePath={BASE}
        params={params}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
    </>
  );
}
