/** zod inputs of the HR staff routes (brief 23 Oct 2026 §3, §6). */
import { z } from 'zod';
import { OPS_EMPLOYMENT_STATUSES } from '@elevate/database';
import { isoDateSchema } from '@elevate/shared-contracts';
import { ROLE_KEYS } from '@elevate/shared-types';
import { EMPLOYMENT_TYPES } from '../domain';

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  text(max)
    .transform((v) => v || null)
    .nullish();

/** Directory filters; every id only narrows the list. */
export const directoryQuery = z.object({
  q: text(100).optional(),
  department: z.uuid().optional(),
  manager: z.uuid().optional(),
  branch: z.uuid().optional(),
  role: z.enum(ROLE_KEYS).optional(),
  employment: z.enum(OPS_EMPLOYMENT_STATUSES).optional(),
  status: z.enum(['active', 'on_leave', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** Profile fields HR edits. Exit goes through "End employment", never this form. */
export const hrProfileBody = z
  .object({
    title: optText(200),
    displayName: optText(200),
    staffCode: optText(40),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    employmentStatus: z.enum(['active', 'on_notice', 'not_recorded']),
    joinedOn: isoDateSchema.nullable(),
    leftOn: isoDateSchema.nullable(),
    branchId: z.uuid().nullable(),
    workScheduleId: z.uuid().nullable(),
  })
  .partial();

export const departmentChangeBody = z.object({
  departmentId: z.uuid(),
  /** primary = replaces the main department; additional = adds one; remove = ends an additional one. */
  kind: z.enum(['primary', 'additional', 'remove']),
  fromDate: isoDateSchema.optional(),
});

export const managerChangeBody = z.object({
  /** Left empty = reports to nobody. */
  managerId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  fromDate: isoDateSchema.optional(),
  reason: optText(500),
});

export const endEmploymentBody = z.object({
  leftOn: isoDateSchema,
  reason: text(500).min(1),
});

export const privateDetailsBody = z
  .object({
    personalPhone: optText(40),
    personalEmail: optText(254),
    address: optText(1000),
    emergencyContactName: optText(200),
    emergencyContactPhone: optText(40),
  })
  .partial();

export const staffActionParams = z.object({
  id: z.uuid(),
  action: z.enum(['department', 'manager', 'end-employment']),
});
