import { z } from 'zod';
import { ROLE_KEYS } from '@elevate/shared-types';
import {
  approvalIdSchema,
  auditEventIdSchema,
  batchIdSchema,
  courseIdSchema,
  departmentIdSchema,
  isoDateTimeSchema,
  leadIdSchema,
  moduleKeySchema,
  programmeCodeSchema,
  programmeIdSchema,
  staffMemberIdSchema,
  studentIdSchema,
  taskIdSchema,
  userIdSchema,
} from './ids';

/**
 * Shared entity shapes as they cross module boundaries. Owners are listed in
 * D-010; a `*Ref` is the minimum another module may hold about an entity it
 * does not own (store the UUID, read the rest through the owner's contract).
 */

export const roleKeySchema = z.enum(ROLE_KEYS);

export const userStatusSchema = z.enum(['active', 'disabled']);

export const userSummarySchema = z.object({
  id: userIdSchema,
  email: z.email(),
  displayName: z.string().min(1),
  status: userStatusSchema,
  roles: z.array(roleKeySchema),
});
export type UserSummary = z.output<typeof userSummarySchema>;

export const departmentStatusSchema = z.enum(['active', 'provisional', 'archived']);
export const departmentSchema = z.object({
  id: departmentIdSchema,
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  name: z.string().min(1),
  description: z.string().nullable(),
  status: departmentStatusSchema,
});
export type Department = z.output<typeof departmentSchema>;

export const staffStatusSchema = z.enum(['active', 'on_leave', 'inactive']);
export const staffMemberSchema = z.object({
  id: staffMemberIdSchema,
  /** Null when the staff member has no login. */
  userId: userIdSchema.nullable(),
  fullName: z.string().min(1),
  departmentId: departmentIdSchema.nullable(),
  title: z.string().nullable(),
  managerId: staffMemberIdSchema.nullable(),
  status: staffStatusSchema,
});
export type StaffMember = z.output<typeof staffMemberSchema>;

export const programmeStatusSchema = z.enum(['active', 'planned', 'paused', 'retired']);
export const programmeSchema = z.object({
  id: programmeIdSchema,
  code: programmeCodeSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
  status: programmeStatusSchema,
});
export type Programme = z.output<typeof programmeSchema>;

/** Ops-owned lead as seen by other modules. */
export const leadRefSchema = z.object({
  id: leadIdSchema,
  owner: z.literal('ops'),
  displayName: z.string().min(1).optional(),
  programmeCode: programmeCodeSchema.optional(),
});
export type LeadRef = z.output<typeof leadRefSchema>;

/** Academic-owned student as seen by other modules. */
export const studentRefSchema = z.object({
  id: studentIdSchema,
  owner: z.literal('academic'),
  displayName: z.string().min(1).optional(),
});
export type StudentRef = z.output<typeof studentRefSchema>;

export const courseRefSchema = z.object({
  id: courseIdSchema,
  owner: z.literal('academic'),
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  programmeCode: programmeCodeSchema.optional(),
});
export type CourseRef = z.output<typeof courseRefSchema>;

export const batchRefSchema = z.object({
  id: batchIdSchema,
  owner: z.literal('academic'),
  courseId: courseIdSchema.optional(),
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});
export type BatchRef = z.output<typeof batchRefSchema>;

/** Ops-owned task as seen by other modules. */
export const taskRefSchema = z.object({
  id: taskIdSchema,
  owner: z.literal('ops'),
  title: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
});
export type TaskRef = z.output<typeof taskRefSchema>;

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'withdrawn']);
export type ApprovalStatus = z.output<typeof approvalStatusSchema>;

export const approvalSchema = z.object({
  id: approvalIdSchema,
  subjectModule: moduleKeySchema,
  subjectType: z.string().min(1),
  subjectId: z.uuid(),
  policy: z.string().min(1),
  status: approvalStatusSchema,
  requestedBy: userIdSchema,
  requestedAt: isoDateTimeSchema,
  requestComment: z.string().nullable(),
  decidedBy: userIdSchema.nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  comment: z.string().nullable(),
});
export type Approval = z.output<typeof approvalSchema>;

export const auditActorTypeSchema = z.enum(['user', 'system', 'service']);
export const auditEventSchema = z.object({
  id: auditEventIdSchema,
  at: isoDateTimeSchema,
  actorType: auditActorTypeSchema,
  actorUserId: userIdSchema.nullable(),
  module: moduleKeySchema,
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEvent = z.output<typeof auditEventSchema>;
