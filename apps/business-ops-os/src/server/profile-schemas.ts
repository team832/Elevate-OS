/** Request schemas for KYC documents, sibling links and the onboarding checklist (owner brief §8). */
import { z } from 'zod';
import { OPS_KYC_SUBJECTS, OPS_STUDENT_STAGES } from '@elevate/database';
import { isoDateSchema } from '@elevate/shared-contracts';
import { MATERIAL_MOVES, ONBOARDING_ITEM_KINDS, ONBOARDING_STATUSES } from '../domain/onboarding';

const optText = (max: number) => z.string().trim().max(max).nullish();
const needsNote = (path: string, message: string) => ({ error: message, path: [path] });

/** POST /students/{id}/kyc — the masked-reference rule is checked in the service (field error). */
export const kycDocumentBody = z
  .object({
    subjectType: z.enum(OPS_KYC_SUBJECTS),
    guardianId: z.uuid().nullish(),
    documentType: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    maskedReference: z.string().trim().max(40),
  })
  .strict()
  .refine(
    (b) => (b.subjectType === 'guardian') === Boolean(b.guardianId),
    needsNote('guardianId', 'Choose the guardian for a guardian document (and only then)'),
  );
export type KycDocumentInput = z.output<typeof kycDocumentBody>;

/** POST /students/{id}/kyc/{documentId} — verify or reject (ops:kyc:verify). */
export const kycVerifyBody = z
  .object({ status: z.enum(['verified', 'rejected']), note: optText(1000) })
  .strict()
  .refine(
    (b) => b.status !== 'rejected' || Boolean(b.note),
    needsNote('note', 'Say why the document is rejected'),
  );
export const kycDocumentParams = z.object({ id: z.uuid(), documentId: z.uuid() });

/** POST /students/{id}/siblings — a link only; never merges the two records. */
export const siblingBody = z.object({ siblingStudentId: z.uuid(), note: optText(500) }).strict();

const itemKey = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, {
  error: 'Lower-case letters, digits and _ (e.g. hostel_form)',
});

/** POST /students/{id}/onboarding — build/extend from templates, or add one item by hand. */
export const onboardingBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), admissionId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('add'),
      admissionId: z.uuid(),
      itemKey,
      label: z.string().trim().min(2).max(120),
      kind: z.enum(ONBOARDING_ITEM_KINDS),
      dueDate: isoDateSchema.nullish(),
      ownerStaffId: z.uuid().nullish(),
    })
    .strict(),
]);
export type OnboardingInput = z.output<typeof onboardingBody>;

/** POST /students/{id}/onboarding/{itemId} — a status event (append-only) plus owner/due date. */
export const onboardingItemBody = z
  .object({
    status: z.enum(ONBOARDING_STATUSES),
    note: optText(1000),
    /** External reference only (e.g. a biometric system enrolment id) — never biometric data. */
    evidenceRef: z
      .string()
      .trim()
      .regex(/^[\w.:/#-]{1,120}$/, {
        error: 'A short reference without spaces, e.g. BIO-2026-0042',
      })
      .nullish(),
    ownerStaffId: z.uuid().nullish(),
    dueDate: isoDateSchema.nullish(),
  })
  .strict()
  .refine(
    (b) => b.status !== 'blocked' || Boolean(b.note),
    needsNote('note', 'Say what is blocking it'),
  );
export type OnboardingItemInput = z.output<typeof onboardingItemBody>;
export const onboardingItemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

/** POST /students/{id}/materials — issue, return or replacement of one material item. */
export const materialBody = z
  .object({
    itemId: z.uuid(),
    kind: z.enum(MATERIAL_MOVES),
    quantity: z.number().int().min(1).max(50),
    edition: optText(60),
    issuedOn: isoDateSchema,
    note: optText(500),
  })
  .strict();
export type MaterialInput = z.output<typeof materialBody>;

const code = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/);
const programmeCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);

/** POST /onboarding-templates — publish the next version of a template (ops:settings:manage). */
export const templateBody = z
  .object({
    code,
    programmeCodes: z.array(programmeCode).min(1).max(10),
    classCategory: z.enum(OPS_STUDENT_STAGES).nullable(),
    items: z
      .array(
        z
          .object({
            key: code,
            label: z.string().trim().min(2).max(120),
            kind: z.enum(ONBOARDING_ITEM_KINDS),
            dueDays: z.number().int().min(0).max(365).optional(),
            /** Material only: the programme whose set this is, copies per set, catalogue code. */
            programmeCode: programmeCode.optional(),
            requiredQuantity: z.number().int().min(1).max(50).optional(),
            catalogueCode: code.optional(),
            edition: z.string().trim().max(60).optional(),
          })
          .strict()
          .refine(
            (i) =>
              i.kind === 'material' ||
              (i.programmeCode ?? i.requiredQuantity ?? i.catalogueCode ?? i.edition) === undefined,
            {
              error: 'Programme, quantity, catalogue code and edition are for material items only',
            },
          ),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine((t) => new Set(t.items.map((i) => i.key)).size === t.items.length, {
    error: 'Each item key must be unique',
    path: ['items'],
  })
  .refine(
    (t) => t.items.every((i) => !i.programmeCode || t.programmeCodes.includes(i.programmeCode)),
    {
      error: 'A material item’s programme must be one of the template’s programmes',
      path: ['items'],
    },
  );
export type TemplateInput = z.output<typeof templateBody>;
