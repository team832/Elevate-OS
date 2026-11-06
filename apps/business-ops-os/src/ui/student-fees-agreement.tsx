/** One annual fee agreement: figures, instalment bar and table, approval and change actions. */
import type { CSSProperties } from 'react';
import { Alert, StatusBadge } from '@elevate/shared-ui';
import { INSTALMENT_STATUS_LABELS, type InstalmentStatus } from '../domain/fee-plans';
import { ActionForm } from './action-form';
import { StatCard } from './charts';
import { fmtDate, fmtDateTime, fmtPaise } from './format';
import { RecordTable } from './record-table';
import { DetailTable, Segment } from './sections';
import { API, dueDateFields, EntryForm, type Level, type PlanView } from './student-fees-forms';

export const TITLE = 'Fees';
const TONE: Record<InstalmentStatus, 'success' | 'info' | 'danger' | 'warning' | 'neutral'> = {
  paid: 'success',
  waived_adjusted: 'success',
  part_paid: 'info',
  overdue: 'danger',
  unpaid: 'neutral',
};

/** Due date with its state in words: overdue vs not yet due; no date is never overdue. */
function dueText(dueDate: string | null, remainingPaise: number, today: string) {
  if (!dueDate) return 'No due date entered';
  if (remainingPaise <= 0) return fmtDate(dueDate);
  return dueDate < today ? `${fmtDate(dueDate)} (overdue)` : `${fmtDate(dueDate)} (not yet due)`;
}

export function Agreement({
  p,
  record,
  approver,
  cover = null,
  requester,
  level,
  today,
}: {
  p: PlanView;
  record: boolean;
  /** The signed-in user's id when they may approve fee arrangements, else null. */
  approver: string | null;
  /** Approval cover (F4-10): the user and the fee approvers they cover today. */
  cover?: { self: string; approvers: readonly string[] } | null;
  /** May ask for the fee-arrangement approval of a draft. */
  requester: boolean;
  level: Level;
  today: string;
}) {
  const { plan, totals, reconciliation, nextDue: next } = p;
  const base = `${API}/fee-plans/${plan.id}`;
  const change = record && (plan.status === 'draft' || (plan.status === 'active' && approver));
  // Closed only because a newer version was drafted: it stands until that one is activated.
  const replaced = p.inForce && plan.status !== 'active';
  const pending = p.pendingApproval;
  const decide =
    pending && approver && approver !== plan.createdBy && approver !== pending.requestedBy;
  return (
    <Segment
      title={`${TITLE}: annual agreement ${plan.academicYear ?? '(year not recorded)'}`}
      level={level}
      description={`${plan.label}. Manually recorded, not verified payments.`}
      meta={
        <>
          <StatusBadge tone={TONE[p.status]}>{INSTALMENT_STATUS_LABELS[p.status]}</StatusBadge>{' '}
          <StatusBadge tone={p.inForce ? 'success' : 'neutral'}>
            {p.proposedChange
              ? 'Proposed change'
              : plan.status === 'draft'
                ? 'Draft'
                : p.inForce
                  ? 'Active'
                  : 'Closed'}
          </StatusBadge>{' '}
          Version {plan.version}
        </>
      }
    >
      <div className="el-stack">
        {replaced ? (
          <Alert title="These figures stand">
            A proposed change to this agreement is not in force until it is approved and activated.
            Record money here meanwhile.
          </Alert>
        ) : null}
        {p.proposedChange ? (
          <p className="el-field-hint">
            Not in force. These are the figures if this change is approved and activated.
          </p>
        ) : null}
        <ul className="el-grid ops-kpis" aria-label="Fee figures">
          <li>
            <StatCard label="Annual tuition" value={fmtPaise(totals.totalPaise)} />
          </li>
          <li>
            <StatCard
              label="Collected"
              value={fmtPaise(totals.netPaidPaise)}
              note="Payments less refunds"
            />
          </li>
          <li>
            <StatCard
              label={plan.status === 'draft' ? 'Outstanding if activated' : 'Outstanding'}
              value={fmtPaise(totals.outstandingPaise)}
            />
          </li>
          <li>
            <StatCard
              label="Next due"
              value={
                next
                  ? fmtPaise(next.remainingPaise)
                  : p.aboveInstalmentsPaise > 0
                    ? fmtPaise(p.aboveInstalmentsPaise)
                    : 'Nothing due'
              }
              note={
                next
                  ? dueText(next.instalment.dueDate, next.remainingPaise, today)
                  : p.aboveInstalmentsPaise > 0
                    ? 'Debit adjustments, no due date'
                    : undefined
              }
            />
          </li>
          {totals.creditPaise > 0 ? (
            <li>
              <StatCard
                label="Credit"
                value={fmtPaise(totals.creditPaise)}
                note="Recorded above what is owed; refund it or carry it over"
              />
            </li>
          ) : null}
        </ul>
        <InstalmentBar p={p} today={today} />
        {reconciliation.reconciled ? null : (
          <Alert tone="warning" title="The agreement and its ledger do not agree">
            <ul>
              {reconciliation.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Alert>
        )}
        <RecordTable
          caption="Instalments (payments go to the instalment they name, otherwise oldest due first)"
          rows={p.instalments}
          rowKey={(i) => i.instalment.id}
          empty="No instalments on this agreement."
          columns={[
            { key: 'n', header: '#', render: (i) => i.instalment.sequence, numeric: true },
            {
              key: 'due',
              header: 'Due',
              render: (i) => dueText(i.instalment.dueDate, i.remainingPaise, today),
            },
            {
              key: 'amount',
              header: 'Amount',
              render: (i) => fmtPaise(i.instalment.amountPaise),
              numeric: true,
            },
            { key: 'paid', header: 'Paid', render: (i) => fmtPaise(i.paidPaise), numeric: true },
            {
              key: 'adjusted',
              header: 'Waived or adjusted',
              render: (i) => fmtPaise(i.adjustedPaise),
              numeric: true,
            },
            {
              key: 'remaining',
              header: 'Remaining',
              render: (i) => fmtPaise(i.remainingPaise),
              numeric: true,
            },
            {
              key: 'status',
              header: 'State',
              render: (i) => (
                <StatusBadge tone={TONE[i.status]}>
                  {INSTALMENT_STATUS_LABELS[i.status]}
                </StatusBadge>
              ),
            },
          ]}
        />
        <DetailTable
          caption="Agreement"
          rows={[
            {
              label: 'Discounts, waivers and adjustments (apart from tuition)',
              value: fmtPaise(totals.reductionsPaise),
            },
            p.aboveInstalmentsPaise > 0 && {
              label: 'Owed above the instalments (debit adjustments)',
              value: fmtPaise(p.aboveInstalmentsPaise),
            },
            { label: 'Refunded', value: fmtPaise(totals.refundedPaise) },
            { label: 'Pricing reference', value: plan.pricingReference ?? 'Not given' },
            {
              label: 'Approval',
              value: plan.approvedAt
                ? `Approved by ${p.approvedByName ?? 'an approver'}, ${fmtDateTime(plan.approvedAt)}`
                : 'Draft: a different approver approves this version, then it is activated',
            },
          ]}
        />
        {record && p.canActivate ? (
          <ActionForm
            action={base}
            submitLabel="Activate agreement"
            extra={{ action: 'activate' }}
            compact
          />
        ) : null}
        {plan.status === 'draft' && !pending && !p.canActivate && requester ? (
          <ActionForm
            action={`${base}/approval-request`}
            submitLabel="Request approval of this agreement"
            compact
          />
        ) : null}
        {plan.status === 'draft' && pending ? (
          <p className="el-field-hint">Approval requested; a different approver decides it.</p>
        ) : null}
        {decide ? (
          <details>
            <summary>Decide the approval request for this version</summary>
            <ActionForm
              action={`${base}/decision`}
              submitLabel="Approve"
              extra={{ decision: 'approved' }}
              compact
            />
            <ActionForm
              action={`${base}/decision`}
              submitLabel="Reject"
              variant="danger"
              extra={{ decision: 'rejected' }}
              fields={[{ name: 'comment', label: 'Reason', type: 'textarea', required: true }]}
            />
          </details>
        ) : null}
        {record && p.inForce ? (
          <EntryForm
            action={`${base}/entries`}
            p={p}
            reduce={
              (approver !== null && approver !== plan.createdBy) ||
              (!!cover &&
                cover.self !== plan.createdBy &&
                cover.approvers.some((a) => a !== plan.createdBy))
            }
          />
        ) : null}
        {change ? (
          <>
            <details>
              <summary>Change the agreement (new version)</summary>
              <ActionForm
                action={base}
                submitLabel="Save new version"
                extra={{ action: 'adjust' }}
                fields={[
                  {
                    name: 'totalRupees',
                    label: 'Annual tuition (₹)',
                    type: 'money',
                    required: true,
                    defaultValue: String(plan.totalPaise / 100),
                  },
                  ...dueDateFields(
                    [...p.instalments]
                      .sort((a, b) => a.instalment.sequence - b.instalment.sequence)
                      .map((i) => i.instalment.dueDate),
                  ),
                  {
                    name: 'reason',
                    label: 'Reason',
                    type: 'textarea',
                    required: true,
                    hint: 'At least 10 characters. An active agreement needs the fee-approval permission; receipts are never changed.',
                  },
                ]}
              />
            </details>
            <details>
              <summary>Close this agreement</summary>
              <ActionForm
                action={base}
                submitLabel="Close agreement"
                variant="danger"
                extra={{ action: 'close' }}
                fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
              />
            </details>
          </>
        ) : null}
      </div>
    </Segment>
  );
}

/** Three segments sized by amount, each filled by what was applied; the state is written out. */
function InstalmentBar({ p, today }: { p: PlanView; today: string }) {
  const bySequence = [...p.instalments].sort(
    (a, b) => a.instalment.sequence - b.instalment.sequence,
  );
  const total = bySequence.reduce((n, i) => n + i.instalment.amountPaise, 0);
  return (
    <ol className="ops-fees-bar" aria-label="Instalments: share, amount, due date and state">
      {bySequence.map((i) => (
        <li
          key={i.instalment.id}
          style={{ '--ops-fees-share': i.instalment.amountPaise } as CSSProperties}
        >
          <span className="el-hbar-track" aria-hidden="true">
            <span
              className="el-hbar-fill"
              style={{ width: `${(100 * i.allocatedPaise) / i.instalment.amountPaise}%` }}
            />
          </span>
          <span className="el-field-hint">
            Instalment {i.instalment.sequence}
            {total ? ` · ${Math.round((100 * i.instalment.amountPaise) / total)} %` : ''}
          </span>
          <span className="ops-fees-amount">{fmtPaise(i.instalment.amountPaise)}</span>
          <span>{dueText(i.instalment.dueDate, i.remainingPaise, today)}</span>
          <StatusBadge tone={TONE[i.status]}>{INSTALMENT_STATUS_LABELS[i.status]}</StatusBadge>
        </li>
      ))}
    </ol>
  );
}
