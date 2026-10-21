/** Request bodies: teacher reviews of students (single store) and reviewed student reports. */
import { z } from 'zod';
import {
  OPS_FEEDBACK_SCOPES,
  OPS_FEEDBACK_VISIBILITY,
  OPS_REPORT_AUDIENCES,
} from '@elevate/database';
import { isoDateSchema } from '@elevate/shared-contracts';
import { REPORT_SECTIONS } from '../domain/student-report';

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish();

/** Observation / strengths / areas needing support / suggested next step (brief §5). */
const feedbackFields = {
  subject: text(100).min(1, 'Required'),
  observedOn: isoDateSchema,
  relatedRef: optText(200),
  observations: text(4000).min(1, 'Required'),
  strengths: optText(2000),
  areasToImprove: optText(2000),
  actionPlan: optText(2000),
  status: z.enum(['draft', 'final']).default('draft'),
  visibility: z.enum(OPS_FEEDBACK_VISIBILITY).default('internal'),
};

/** What the review is about: demo_session ⇔ demoSessionId, enrolment ⇔ enrolmentId. */
export const teacherFeedbackBody = z
  .object({
    studentId: z.uuid(),
    /** Only holders of ops:feedback:manage may write as another teacher. */
    teacherStaffId: z.uuid().nullish(),
    scope: z.enum(OPS_FEEDBACK_SCOPES).default('general'),
    demoSessionId: z.uuid().nullish(),
    enrolmentId: z.uuid().nullish(),
    ...feedbackFields,
  })
  .refine((b) => (b.scope === 'demo_session') === Boolean(b.demoSessionId), {
    error: 'Choose the demo class this review is about (and only for a demo-class review).',
    path: ['demoSessionId'],
  })
  .refine((b) => (b.scope === 'enrolment') === Boolean(b.enrolmentId), {
    error: 'Choose the enrolment this review is about (and only for an enrolment review).',
    path: ['enrolmentId'],
  });
/** An edit keeps the current visibility unless it is sent. */
export const teacherFeedbackUpdateBody = z.object({
  ...feedbackFields,
  visibility: z.enum(OPS_FEEDBACK_VISIBILITY).optional(),
});

export const reportBody = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    audience: z.enum(OPS_REPORT_AUDIENCES).default('internal'),
    /**
     * Optional subset (admin dossier; a guardian/student fee statement must be asked for), as a
     * list or as form checkboxes `{ results: true, fees: false, … }`.
     */
    sections: z
      .union([
        z.array(z.enum(REPORT_SECTIONS)).max(REPORT_SECTIONS.length),
        z
          .partialRecord(z.enum(REPORT_SECTIONS), z.boolean())
          .transform((r) => REPORT_SECTIONS.filter((k) => r[k])),
      ])
      .optional(),
    acknowledgement: z.boolean().default(false),
  })
  .strict()
  .refine((b) => b.from <= b.to, { error: 'The start must be on or before the end', path: ['to'] });

export const reportStatusBody = z.object({ to: z.enum(['reviewed', 'final']) }).strict();
