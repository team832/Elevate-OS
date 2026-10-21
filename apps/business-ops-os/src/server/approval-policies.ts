/**
 * Approval policies used by Business Ops (core approvals service, PLT-006).
 * The policy does not allow self-approval (PLT-004).
 */
import { defineApprovalPolicy } from '@elevate/server-kit';

/** BR-OPS-7 before D-039: admission-level fee approvals. Kept readable in history; they activate no agreement. */
export const feeArrangementPolicy = defineApprovalPolicy({
  key: 'ops.admission.fee_arrangement',
  module: 'ops',
  subjectType: 'admission',
  deciderPermission: 'ops:admissions:approve',
  requesterPermission: 'ops:admissions:write',
  allowSelfApproval: false,
  requireCommentOnReject: true,
  description:
    'Authorised approval of an agreed fee arrangement before admission. Elevate OS stores the decision and references, not amounts.',
});

/**
 * Approval of one exact annual fee agreement version (subject = the fee_plans row, D-039). The only
 * approval that activates an agreement, and what satisfies an admission's fee-approval readiness
 * gap; it can never activate other terms, another version, year or admission.
 */
export const feeAgreementPolicy = defineApprovalPolicy({
  key: 'ops.fee_agreement.version',
  module: 'ops',
  subjectType: 'fee_plan',
  deciderPermission: 'ops:admissions:approve',
  requesterPermission: 'ops:admissions:write',
  allowSelfApproval: false,
  requireCommentOnReject: true,
  description: 'Approval of the exact terms of one annual fee agreement version.',
});
