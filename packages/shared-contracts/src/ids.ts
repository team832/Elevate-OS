import { z } from 'zod';
import type {
  AdmissionId,
  ApprovalId,
  AuditEventId,
  BatchId,
  Brand,
  CampaignId,
  ContentItemId,
  CourseId,
  DepartmentId,
  EnrolmentId,
  IdeaId,
  IntegrationEventId,
  IsoDate,
  IsoDateTime,
  LeadId,
  NotificationId,
  ProgrammeId,
  StaffMemberId,
  StudentId,
  TaskId,
  UserId,
} from '@elevate/shared-types';
import { MODULE_KEYS, isIsoDate } from '@elevate/shared-types';

/** A zod schema that accepts a UUID string and yields the branded ID type. */
export function idSchema<T extends Brand<string, string>>() {
  return z.uuid().transform((v) => v as T);
}

export const userIdSchema = idSchema<UserId>();
export const departmentIdSchema = idSchema<DepartmentId>();
export const staffMemberIdSchema = idSchema<StaffMemberId>();
export const programmeIdSchema = idSchema<ProgrammeId>();
export const approvalIdSchema = idSchema<ApprovalId>();
export const auditEventIdSchema = idSchema<AuditEventId>();
export const notificationIdSchema = idSchema<NotificationId>();
export const integrationEventIdSchema = idSchema<IntegrationEventId>();
export const leadIdSchema = idSchema<LeadId>();
export const admissionIdSchema = idSchema<AdmissionId>();
export const taskIdSchema = idSchema<TaskId>();
export const studentIdSchema = idSchema<StudentId>();
export const courseIdSchema = idSchema<CourseId>();
export const batchIdSchema = idSchema<BatchId>();
export const enrolmentIdSchema = idSchema<EnrolmentId>();
export const ideaIdSchema = idSchema<IdeaId>();
export const contentItemIdSchema = idSchema<ContentItemId>();
export const campaignIdSchema = idSchema<CampaignId>();

export const moduleKeySchema = z.enum(MODULE_KEYS);

/** `YYYY-MM-DD` calendar date (validated as a real date). */
export const isoDateSchema = z
  .string()
  .refine(isIsoDate, { error: 'Expected a calendar date in YYYY-MM-DD form' })
  .transform((v) => v as IsoDate);

/** ISO 8601 instant with offset or `Z`. */
export const isoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .transform((v) => v as IsoDateTime);

/**
 * Programme code from `core.programmes.code` — upper-case letters, digits and
 * underscores (e.g. `CLAT`, `COMMERCE_11_12`). Not an enum, because Academic OS
 * stewards the catalogue and may add programmes without a contract change.
 */
export const programmeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, {
  error: 'Programme codes are upper-case, e.g. CLAT or COMMERCE_11_12',
});

/** Programme codes seeded by the foundation (see packages/database/src/seed/core-seed.ts). */
export const SEEDED_PROGRAMME_CODES = [
  'CLAT',
  'IPMAT',
  'CUET',
  'COMMERCE_11_12',
  'CLASS_11',
  'CLASS_12',
  'DROPPER',
  'CA_FOUNDATION',
] as const;

/** Indian or international phone number in E.164 form, e.g. +919800000000. */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, { error: 'Phone numbers use E.164 form, e.g. +919800000000' });
