/**
 * zod schemas for the HR records routes (OPS-030…OPS-039). Routes validate
 * with them; services take their output types. Documented in docs/parts/hr-records.md.
 */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { ASSET_STATUSES, RETURN_CONDITIONS } from '../../domain/hr/assets';
import {
  COMPENSATION_BASES,
  COMPENSATION_STATUSES,
  COMPONENT_KINDS,
} from '../../domain/hr/compensation';
import {
  DOCUMENT_ACTIONS,
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_KINDS,
  IDENTITY_REFERENCE_KINDS,
  MAX_DOCUMENT_BYTES,
  RETENTION_CLASSES,
} from '../../domain/hr/documents';
import { EMPLOYEE_SORTS, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES } from '../../domain/hr/employees';

const text = (max = 500) => z.string().trim().max(max);
const optText = (max = 500) => text(max).nullish();
const optUuid = z.uuid().nullish();
/** Explicit confirmation for sensitive actions (the UI shows a tick box). */
const confirm = z.literal(true, { error: 'Tick the box to confirm.' });
const paging = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const staffIdParams = z.object({ id: z.uuid() });
export const contactParams = z.object({ id: z.uuid(), contactId: z.uuid() });
export const referenceParams = z.object({ id: z.uuid(), refId: z.uuid() });

// --- employees ------------------------------------------------------------------------------

export const employeeListQuery = z.object({
  q: text(200).optional(),
  departmentId: z.uuid().optional(),
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  location: text(200).optional(),
  sort: z.enum(EMPLOYEE_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  ...paging,
  /** Include separated employees (record-tier callers only). */
  includeSeparated: z.enum(['true', 'false']).optional(),
});
export type EmployeeListQuery = z.output<typeof employeeListQuery>;

export const createEmployeeBody = z.object({
  /** Register an EXISTING staff member as an employee instead of creating a new one. */
  existingStaffId: optUuid,
  fullName: text(200).min(1).optional(),
  workEmail: optText(254),
  workPhone: optText(40),
  workLocation: optText(200),
  timezone: text(64).optional(),
  departmentId: optUuid,
  title: optText(200),
  managerId: optUuid,
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  employmentStartDate: isoDateSchema.nullish(),
  employmentStatus: z.enum(['onboarding', 'active']).optional(),
});
export type CreateEmployeeInput = z.output<typeof createEmployeeBody>;

export const updateEmployeeBody = z
  .object({
    fullName: text(200).min(1),
    workEmail: optText(254),
    workPhone: optText(40),
    workLocation: optText(200),
    timezone: text(64),
    departmentId: optUuid,
    title: optText(200),
    managerId: optUuid,
    employmentType: z.enum(EMPLOYMENT_TYPES),
    employmentStatus: z.enum(EMPLOYMENT_STATUSES),
    employmentStartDate: isoDateSchema.nullish(),
    employmentEndDate: isoDateSchema.nullish(),
    /** When the change takes effect (default: today, Asia/Kolkata). */
    effectiveOn: isoDateSchema,
    reason: optText(1000),
  })
  .partial();
export type UpdateEmployeeInput = z.output<typeof updateEmployeeBody>;

// --- private HR fields ------------------------------------------------------------------------

export const privateDetailsBody = z
  .object({
    legalName: optText(200),
    personalEmail: optText(254),
    personalPhone: optText(40),
    addressLine1: optText(300),
    addressLine2: optText(300),
    city: optText(100),
    state: optText(100),
    postalCode: optText(20),
    country: optText(100),
  })
  .partial();
export type PrivateDetailsInput = z.output<typeof privateDetailsBody>;

export const emergencyContactBody = z.object({
  name: text(200).min(1),
  relationship: text(100).min(1),
  phone: text(40).min(1),
  isPrimary: z.boolean().default(false),
});
export const updateEmergencyContactBody = emergencyContactBody.partial();

export const identityReferenceBody = z.object({
  kind: z.enum(IDENTITY_REFERENCE_KINDS),
  /** Only the last four characters — never the full number. */
  last4: text(40).nullish(),
  documentId: optUuid,
  notes: optText(500),
});
export const retireIdentityReferenceBody = z.object({ status: z.literal('retired') });

// --- documents --------------------------------------------------------------------------------

export const addDocumentBody = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  title: text(300).min(1),
  storageKind: z.enum(['reference', 'stored']).default('reference'),
  /** Reference-only: where the paper or external file is kept. */
  externalReference: optText(500),
  /** Stored: file metadata + base64 content (refused while storage is not configured). */
  contentType: z.enum(DOCUMENT_CONTENT_TYPES).nullish(),
  sizeBytes: z.int().min(0).max(MAX_DOCUMENT_BYTES).nullish(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
  contentBase64: z
    .string()
    .max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 4)
    .nullish(),
  retentionClass: z.enum(RETENTION_CLASSES).nullish(),
  expiresOn: isoDateSchema.nullish(),
  supersedesId: optUuid,
});
export type AddDocumentInput = z.output<typeof addDocumentBody>;

export const documentActionBody = z.object({
  action: z.enum(DOCUMENT_ACTIONS),
  reason: optText(1000),
  /** Required (true) to approve a deletion. */
  confirm: z.boolean().optional(),
});
export const downloadQuery = z.object({ redirect: z.enum(['1']).optional() });

// --- compensation -----------------------------------------------------------------------------

const component = z.object({
  kind: z.enum(COMPONENT_KINDS),
  label: text(100).min(1),
  amountPaise: z.int().min(0),
});

export const compensationListQuery = z.object({
  staffId: z.uuid().optional(),
  status: z.enum(COMPENSATION_STATUSES).optional(),
});

/** Rupees as typed in a form, e.g. "45000" or "45000.50" (converted exactly to paise). */
const rupees = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, { error: 'Use rupees, e.g. 45000 or 45000.50' });

const compensationFields = z.object({
  staffId: z.uuid(),
  basis: z.enum(COMPENSATION_BASES),
  amountPaise: z.int().min(0).optional(),
  amountInr: rupees.optional(),
  components: z.array(component).max(30).default([]),
  effectiveFrom: isoDateSchema,
  note: optText(1000),
});
const toPaise = <T extends { amountPaise?: number; amountInr?: string }>(v: T) => {
  const { amountInr, ...rest } = v;
  if (amountInr === undefined) return rest;
  const [whole, frac = ''] = amountInr.split('.');
  return { ...rest, amountPaise: Number(whole) * 100 + Number(frac.padEnd(2, '0')) };
};
export const createCompensationBody = compensationFields
  .refine((v) => v.amountPaise !== undefined || v.amountInr !== undefined, {
    error: 'Give the amount (amountPaise or amountInr).',
    path: ['amountInr'],
  })
  .transform((v) => toPaise(v) as Omit<typeof v, 'amountInr'> & { amountPaise: number });
export type CreateCompensationInput = z.output<typeof createCompensationBody>;

export const updateCompensationBody = compensationFields
  .omit({ staffId: true })
  .partial()
  .transform((v) => toPaise(v));

export const approveCompensationBody = z.object({ confirm });
export const cancelCompensationBody = z.object({ reason: text(1000).min(3) });
export const compensationExportQuery = z.object({ asOf: isoDateSchema.optional() });

// --- assets -----------------------------------------------------------------------------------

export const assetListQuery = z.object({
  q: text(200).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  category: text(100).optional(),
  ...paging,
});

export const createAssetBody = z.object({
  name: text(200).min(1),
  category: text(100).min(1),
  serialNumber: optText(200),
  notes: optText(1000),
});

export const updateAssetBody = createAssetBody.extend({ status: z.enum(ASSET_STATUSES) }).partial();

export const assignAssetBody = z.object({
  staffId: z.uuid(),
  assignedOn: isoDateSchema.optional(),
  expectedReturnOn: isoDateSchema.nullish(),
  notes: optText(1000),
});

export const returnAssetBody = z.object({
  condition: z.enum(RETURN_CONDITIONS),
  notes: optText(1000),
});

// --- organisation -----------------------------------------------------------------------------

export const assignHeadBody = z.object({
  staffId: z.uuid(),
  startsOn: isoDateSchema.optional(),
  reason: optText(1000),
});
export const endHeadBody = z.object({
  endsOn: isoDateSchema.optional(),
  reason: text(1000).min(3),
});
