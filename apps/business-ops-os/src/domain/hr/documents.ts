/**
 * Employment document metadata rules (OPS-035). Pure.
 * Bytes never live in PostgreSQL; `reference` documents record where a paper or
 * external file is kept, `stored` documents sit behind the DocumentStorage
 * adapter (D-014; default mock = not configured). Identity documents follow OD-014.
 */

export const DOCUMENT_KINDS = [
  'agreement',
  'identification_reference',
  'qualification',
  'certificate',
  'policy_acknowledgement',
  'onboarding',
  'training',
  'performance_review',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const IDENTITY_REFERENCE_KINDS = [
  'aadhaar',
  'pan',
  'passport',
  'voter_id',
  'driving_licence',
  'other',
] as const;

export const DOCUMENT_STATUSES = [
  'active',
  'superseded',
  'retention_hold',
  'deletion_requested',
  'deleted',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const RETENTION_CLASSES = ['employment_record', 'identity', 'training', 'general'] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

/** Default retention class per kind (the PERIODS per class are an open owner decision). */
export const DEFAULT_RETENTION_CLASS: Record<DocumentKind, RetentionClass> = {
  agreement: 'employment_record',
  identification_reference: 'identity',
  qualification: 'employment_record',
  certificate: 'training',
  policy_acknowledgement: 'employment_record',
  onboarding: 'employment_record',
  training: 'training',
  performance_review: 'employment_record',
  other: 'general',
};

/** Kinds that also need `ops:employee_private:read` (identity documents, OD-014). */
export function isPrivateDocumentKind(kind: DocumentKind): boolean {
  return kind === 'identification_reference';
}

export const DOCUMENT_ACTIONS = [
  'hold',
  'release_hold',
  'request_deletion',
  'approve_deletion',
  'reject_deletion',
] as const;
export type DocumentAction = (typeof DOCUMENT_ACTIONS)[number];

const ACTION_RULES: Record<DocumentAction, { from: DocumentStatus[]; to: DocumentStatus }> = {
  hold: { from: ['active', 'superseded'], to: 'retention_hold' },
  release_hold: { from: ['retention_hold'], to: 'active' },
  request_deletion: { from: ['active', 'superseded'], to: 'deletion_requested' },
  approve_deletion: { from: ['deletion_requested'], to: 'deleted' },
  reject_deletion: { from: ['deletion_requested'], to: 'active' },
};

/**
 * Document status change. A retention hold blocks deletion requests; deletion
 * is decided by a different person from the requester (no self-approval);
 * requests and rejections need a reason.
 */
export function checkDocumentAction(
  status: DocumentStatus,
  action: DocumentAction,
  context: { actorUserId: string; requestedBy: string | null; reason?: string | null },
):
  | { ok: true; to: DocumentStatus }
  | { ok: false; code: 'ILLEGAL' | 'SELF_DECISION' | 'REASON_REQUIRED'; message: string } {
  const rule = ACTION_RULES[action];
  if (!rule.from.includes(status)) {
    const message =
      status === 'retention_hold' && action === 'request_deletion'
        ? 'The document is under a retention hold; release the hold first.'
        : `Cannot ${action.replace(/_/g, ' ')} a document that is ${status.replace(/_/g, ' ')}.`;
    return { ok: false, code: 'ILLEGAL', message };
  }
  if ((action === 'approve_deletion' || action === 'reject_deletion') && context.requestedBy) {
    if (context.requestedBy === context.actorUserId)
      return {
        ok: false,
        code: 'SELF_DECISION',
        message: 'A different authorised person must decide a deletion you requested.',
      };
  }
  if (
    (action === 'request_deletion' || action === 'reject_deletion' || action === 'hold') &&
    !context.reason?.trim()
  )
    return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason.' };
  return { ok: true, to: rule.to };
}

export function isSha256Hex(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Allowed content types for stored documents (when storage is configured). */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
/** 10 MB — a technical limit, not a policy. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Is the document past its expiry on `today`? (null expiry = never.) */
export function isExpired(expiresOn: string | null, today: string): boolean {
  return Boolean(expiresOn) && (expiresOn as string) < today;
}
