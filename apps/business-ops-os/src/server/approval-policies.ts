/**
 * Approval policies used by Business Ops (core approvals service, PLT-006).
 * Neither policy allows self-approval (PLT-004).
 */
import { defineApprovalPolicy } from '@elevate/server-kit';

/** BR-OPS-7 (approved): the agreed fee arrangement needs an authorised approval. */
export const feeArrangementPolicy = defineApprovalPolicy({
  key: 'ops.admission.fee_arrangement',
  module: 'ops',
  subjectType: 'admission',
  deciderPermission: 'ops:admissions:approve',
  requesterPermission: 'ops:admissions:write',
  allowSelfApproval: false,
  requireCommentOnReject: true,
  description:
    'Authorised approval of an agreed fee arrangement before admission (BR-OPS-7). Elevate OS stores the decision and references, not amounts (OD-013).',
});

/** OPS-019: an SOP version is approved through core approvals; the subject is the VERSION. */
export const sopApprovalPolicy = defineApprovalPolicy({
  key: 'ops.sop.approve',
  module: 'ops',
  subjectType: 'sop_version',
  deciderPermission: 'ops:sops:approve',
  requesterPermission: 'ops:sops:write',
  allowSelfApproval: false,
  requireCommentOnReject: true,
  description:
    'Approval of a specific SOP version. The owner cannot approve their own SOP and a named reviewer must recommend it first.',
});
