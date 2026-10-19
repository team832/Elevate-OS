import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, programmeCodeSchema } from './ids';

/**
 * Cross-module read-only summaries (D-011.2), served at
 * `GET /<zone>/api/internal/v1/summary` and consumed by Business Ops and the
 * platform dashboard.
 *
 * MISSING IS NOT ZERO. Every metric carries a status:
 *   ok        — measured from real records in the window; value is a number
 *   estimated — derived/approximate (say how in `basis`); value is a number
 *   missing   — no trustworthy data (source not connected, nothing recorded);
 *               value is null and must be shown as "missing", never as 0
 * A consumer that cannot reach the source at all renders "source unavailable"
 * (see `SourceResult`).
 */

export const metricWindowSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    /** Human label, e.g. "Week of 12 Oct 2026". */
    label: z.string().min(1).max(100).optional(),
  })
  .refine((w) => w.from <= w.to, { error: 'window.from must not be after window.to' });
export type MetricWindow = z.output<typeof metricWindowSchema>;

export const metricUnitSchema = z.enum(['count', 'percent', 'ratio', 'inr', 'minutes', 'hours']);

const metricBase = {
  /** What is counted and how, in one sentence, e.g. "Classes marked delivered in the window". */
  definition: z.string().min(1).max(500),
  window: metricWindowSchema,
  unit: metricUnitSchema,
};

export const metricSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), value: z.number().finite(), ...metricBase }),
  z.object({
    status: z.literal('estimated'),
    value: z.number().finite(),
    ...metricBase,
    /** How the estimate was produced. */
    basis: z.string().min(1).max(500),
  }),
  z.object({
    status: z.literal('missing'),
    value: z.null(),
    ...metricBase,
    /** Why the value is missing, e.g. "Metricool not connected". */
    reason: z.string().min(1).max(500),
  }),
]);
export type Metric = z.output<typeof metricSchema>;
export type MetricStatus = Metric['status'];

export type MetricMeta = {
  definition: string;
  window: z.input<typeof metricWindowSchema>;
  unit: Metric['unit'];
};

/** Validated metric builders (throw ZodError on an invalid window or value). */
export const metric = {
  ok: (value: number, meta: MetricMeta): Metric =>
    metricSchema.parse({ status: 'ok', value, ...meta }),
  estimated: (value: number, basis: string, meta: MetricMeta): Metric =>
    metricSchema.parse({ status: 'estimated', value, basis, ...meta }),
  missing: (reason: string, meta: MetricMeta): Metric =>
    metricSchema.parse({ status: 'missing', value: null, reason, ...meta }),
};

export const connectionStatusSchema = z.enum(['not_configured', 'sandbox', 'connected', 'error']);
export type ConnectionStatus = z.output<typeof connectionStatusSchema>;

// --- Marketing ------------------------------------------------------------------

export const marketingSummaryV1Schema = z.object({
  contract: z.literal('marketing.summary'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  window: metricWindowSchema,
  metrics: z.object({
    ideasCaptured: metricSchema,
    contentApproved: metricSchema,
    postsScheduled: metricSchema,
    postsPublished: metricSchema,
    totalReach: metricSchema,
    engagementRate: metricSchema,
    followerGrowth: metricSchema,
    leadsAttributed: metricSchema,
  }),
  accounts: z.array(
    z.object({
      accountCode: z.string().min(1).max(40),
      platform: z.enum(['instagram', 'youtube', 'linkedin', 'other']),
      connection: connectionStatusSchema,
      postsPublished: metricSchema,
      reach: metricSchema,
    }),
  ),
  dataSources: z.array(
    z.object({
      name: z.string().min(1),
      connection: connectionStatusSchema,
      lastSyncAt: isoDateTimeSchema.nullable(),
    }),
  ),
});
export type MarketingSummaryV1 = z.output<typeof marketingSummaryV1Schema>;

// --- Academic ---------------------------------------------------------------------

const academicDeliveryMetrics = z.object({
  activeStudents: metricSchema,
  activeBatches: metricSchema,
  /** Planned ≠ delivered: planned classes are never reported as delivered (D-016). */
  classesPlanned: metricSchema,
  classesDelivered: metricSchema,
  classesCancelled: metricSchema,
  attendanceRate: metricSchema,
  assessmentsPlanned: metricSchema,
  assessmentsConducted: metricSchema,
  studentsAtRisk: metricSchema,
  syllabusCompletionRate: metricSchema,
});

export const academicDeliverySummaryV1Schema = z.object({
  contract: z.literal('academic.delivery_summary'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  window: metricWindowSchema,
  metrics: academicDeliveryMetrics,
  programmes: z.array(
    z.object({ programmeCode: programmeCodeSchema, metrics: academicDeliveryMetrics }),
  ),
});
export type AcademicDeliverySummaryV1 = z.output<typeof academicDeliverySummaryV1Schema>;

// --- Consumer side ------------------------------------------------------------------

/** What a consumer holds after trying to fetch a summary. Never substitute zeros. */
export type SourceResult<T> =
  | { status: 'available'; data: T; fetchedAt: string }
  | { status: 'unavailable'; reason: string; fetchedAt: string };
