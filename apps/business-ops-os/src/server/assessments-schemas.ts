/**
 * zod bodies for Tests and Mock Tests in Business Ops (owner brief 23 Oct 2026 §17–§21). The
 * Academic contract bodies (shared-contracts modules/academic.ts) are the truth; these only turn
 * form shapes (checkbox maps, a sections text box) into them.
 */
import { z } from 'zod';
import {
  ASSESSMENT_VIEWS,
  assessmentListQuerySchema,
  createAssessmentInternalBody,
  markTextSchema,
  rosterCorrectionBody,
} from '@elevate/shared-contracts';
import { uploadAttachmentBody } from './attachments';

/** `{ "<id>": true|false }` from checkboxes named `<field>.<id>` → the ticked ids, in form order. */
const ticked = (min: number, error: string) =>
  z
    .record(z.uuid(), z.boolean())
    .transform((r) => Object.keys(r).filter((k) => r[k]))
    .pipe(z.array(z.uuid()).min(min, { error }));

/** One section per line: `Code, Name, Questions, Maximum marks` (maximum optional). */
const sectionsText = z
  .string()
  .max(4000)
  .transform((text, ctx) =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => {
        const [code = '', name = '', count = '', max = ''] = line.split(',').map((p) => p.trim());
        const questionCount = Number(count);
        if (!code || !name || !Number.isInteger(questionCount) || questionCount < 1)
          ctx.addIssue({
            code: 'custom',
            message: `Line ${i + 1}: write “Code, Name, Questions, Maximum marks”, e.g. QA, Quant, 40, 160.`,
          });
        else if (max && !markTextSchema.safeParse(max).success)
          ctx.addIssue({ code: 'custom', message: `Line ${i + 1}: “${max}” is not a mark.` });
        return { code, name, questionCount, ...(max ? { capMarks: max } : {}) };
      }),
  );

const { batchIds: _batchIds, sections: _sections, ...fields } = createAssessmentInternalBody.shape;
export const createTestBody = z
  .strictObject({
    ...fields,
    batches: ticked(1, 'Choose at least one eligible batch.'),
    sections: sectionsText.optional(),
  })
  .transform(({ batches, sections, ...rest }) => ({
    ...rest,
    batchIds: batches,
    ...(sections?.length ? { sections } : {}),
  }));

/** For `add` Ops itself supplies the batch and admission number (never the client's). */
const { action, studentId, reason } = rosterCorrectionBody.shape;
export const correctionBody = z.strictObject({ action, studentId, reason });

export const testListQuery = assessmentListQuerySchema.extend({
  view: z.enum([...ASSESSMENT_VIEWS, 'imports']).default('upcoming'),
});
export type TestListQuery = z.output<typeof testListQuery>;

export const publishBody = z.strictObject({
  provisional: z.boolean().default(false),
  /** Ticked batches = rank this cohort; none = the whole roster. */
  cohort: ticked(0, '').optional(),
  note: z.string().trim().max(500).optional(),
});

const file = uploadAttachmentBody.pick({ name: true, mime: true, dataBase64: true });
export const releaseBody = z.strictObject({ note: z.string().trim().max(500).optional() });
export const testFileParams = z.object({ id: z.uuid(), fileId: z.uuid() });

export const startImportBody = file
  .extend({
    source: z.enum(['csv', 'pdf_ai']),
    /** File column → score field (domain ScoreMapping); CSV only, default = matched by heading. */
    mapping: z.record(z.string().max(200), z.string().max(200)).optional(),
    confirmSend: z.boolean().optional(),
  })
  .refine((b) => b.source !== 'pdf_ai' || b.confirmSend === true, {
    error: 'Tick “I confirm sending this score sheet to an AI service” to have it read.',
    path: ['confirmSend'],
  });

const rowFlags = z
  .record(z.string().max(40), z.boolean())
  .default({})
  .transform((r) => Object.keys(r).filter((k) => r[k]));
export const confirmImportBody = z.strictObject({
  /** rowId → roster student id, or 'skip'; '' = keep the match. */
  resolutions: z.record(z.string().max(40), z.string().max(40)).default({}),
  aiConfirmed: rowFlags,
  overwriteConfirmed: rowFlags,
  markScoredPresent: z.boolean().default(false),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type ConfirmImportInput = z.output<typeof confirmImportBody>;
