/**
 * Branded UUID types (D-009). Every primary key is a UUID; the brand stops a
 * `LeadId` being passed where a `StudentId` is expected. Brands exist only at
 * compile time — at runtime they are plain strings.
 */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

// --- core (platform) --------------------------------------------------------
export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type DepartmentId = Brand<string, 'DepartmentId'>;
export type StaffMemberId = Brand<string, 'StaffMemberId'>;
export type ProgrammeId = Brand<string, 'ProgrammeId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type NotificationId = Brand<string, 'NotificationId'>;
export type IntegrationEventId = Brand<string, 'IntegrationEventId'>;
export type EventDeliveryId = Brand<string, 'EventDeliveryId'>;
export type IdempotencyKeyId = Brand<string, 'IdempotencyKeyId'>;

// --- Business Ops OS (ops schema) ------------------------------------------------
export type LeadId = Brand<string, 'LeadId'>;
export type AdmissionId = Brand<string, 'AdmissionId'>;
export type TaskId = Brand<string, 'TaskId'>;

// --- Academic OS (academic schema) ---------------------------------------------
export type StudentId = Brand<string, 'StudentId'>;
export type CourseId = Brand<string, 'CourseId'>;
export type BatchId = Brand<string, 'BatchId'>;
export type EnrolmentId = Brand<string, 'EnrolmentId'>;

// --- Marketing OS (marketing schema) -------------------------------------------
export type IdeaId = Brand<string, 'IdeaId'>;
export type ContentItemId = Brand<string, 'ContentItemId'>;
export type CampaignId = Brand<string, 'CampaignId'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when `value` is an RFC 4122 UUID (versions 1–8). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Cast a string to a branded ID after checking it is a UUID.
 * Throws `TypeError` when it is not — use at trust boundaries only; zod
 * schemas in `@elevate/shared-contracts` are the normal way to obtain IDs.
 */
export function asId<T extends Brand<string, string>>(value: string): T {
  if (!isUuid(value)) {
    throw new TypeError(`Expected a UUID, received ${JSON.stringify(value)}`);
  }
  return value as T;
}
