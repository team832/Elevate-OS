/** zod inputs for the demo-students routes (docs/parts/admissions-demos.md §API). */
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, programmeCodeSchema } from '@elevate/shared-contracts';
import { ADMISSION_STATUSES } from '../domain';
import {
  CHECKLIST_STATUSES,
  DEMO_OUTCOMES,
  DEMO_VIEWS,
  MANUAL_OUTCOMES,
  MOCK_STATUSES,
} from '../domain/demos';
import { contactFields } from './schemas';

const optText = (max: number) => z.string().trim().max(max).nullish();
/** Domain rules decide when a reason is required, so their message is the one shown. */
const reason = optText(1000);
/** Filter forms submit "" for "Any". */
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const day = z.coerce.number().int().min(1).max(10);
/**
 * ActionForm posts `sessions.0.startsAt` as an object keyed by index; a class slot left
 * empty in the form (only its hidden day number) is dropped.
 */
const indexed = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => {
    const list = v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v) : v;
    return Array.isArray(list)
      ? list.filter(
          (s) => !(s && typeof s === 'object' && Object.keys(s).every((k) => k === 'dayNumber')),
        )
      : list;
  }, z.array(item).min(1).max(30));
/** Checkbox groups post `{ CLAT: true, CUET: false }`; an array of codes is accepted too. */
const codeSet = z.preprocess(
  (v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.entries(v).flatMap(([k, on]) => (on ? [k] : []))
      : v,
  z.array(programmeCodeSchema).max(6),
);

/**
 * Basic demo KYC (brief §5) on the lead and the case: blank keeps what is recorded. Class /
 * category = `currentStage` (`gap_year` = Dropper); a child needs no own contact when a
 * guardian contact is recorded (the lead keeps at least one contact).
 */
export const demoKycBody = z
  .object({
    ...contactFields,
    interestedProgrammeCodes: codeSet,
    emergencyContactName: optText(200),
    emergencyContactPhone: optText(40),
    intendedStartDate: isoDateSchema.nullish(),
    counsellorStaffId: z.uuid().nullish(),
    notes: optText(2000),
  })
  .partial();
export type DemoKycInput = z.output<typeof demoKycBody>;

export const createDemoBody = z.object({
  admissionId: z.uuid(),
  programmeCode: programmeCodeSchema.nullish(),
  counsellorStaffId: z.uuid().nullish(),
  /** End = start + duration unless a class gives its own end. */
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  /** Classes; without `dayNumber`, classes on the same IST date form one demo day. */
  sessions: indexed(
    z.object({
      dayNumber: day.nullish(),
      startsAt: isoDateTimeSchema,
      endsAt: isoDateTimeSchema.nullish(),
      subject: z.string().trim().min(1).max(100),
      teacherStaffId: z.uuid().nullish(),
    }),
  ),
  notes: optText(2000),
  kyc: demoKycBody.nullish(),
});

export const DEMO_SORTS = ['name', 'first_class', 'follow_up', 'recent'] as const;

export const demoListQuery = z.object({
  view: opt(z.enum(DEMO_VIEWS)),
  q: opt(z.string().trim().max(100)),
  programme: opt(programmeCodeSchema),
  counsellor: opt(z.uuid()),
  outcome: opt(z.enum(DEMO_OUTCOMES)),
  stage: opt(z.enum(ADMISSION_STATUSES)),
  from: opt(isoDateSchema),
  to: opt(isoDateSchema),
  followUp: opt(z.enum(['due', 'overdue'])),
  sort: opt(z.enum(DEMO_SORTS)),
  page: opt(z.coerce.number().int().min(1)),
});

export const demoActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('outcome'), outcome: z.enum(MANUAL_OUTCOMES), reason }),
  z.object({ action: z.literal('kyc'), ...demoKycBody.shape }),
]);

export const sessionActionBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('attendance'),
    attendance: z.enum(['present', 'late', 'absent', 'excused', 'not_recorded', 'scheduled']),
    reason,
    notes: optText(2000),
  }),
  z.object({
    action: z.literal('reschedule'),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema.nullish(),
    /** Move every live class of this class's day by the same amount (the day changes date). */
    wholeDay: z.boolean().optional(),
    reason,
  }),
  z.object({ action: z.literal('cancel'), reason }),
  z.object({
    action: z.literal('mock'),
    mockStatus: z.enum(MOCK_STATUSES),
    mockAttemptRef: optText(200),
  }),
  z.object({
    action: z.literal('assign'),
    teacherStaffId: z.uuid().nullish(),
    subject: z.string().trim().min(1).max(100),
    /** The teacher stood in for the planned one. */
    isSubstitute: z.boolean().optional(),
    reason,
  }),
]);

/** Add a class to a demo day (a day beyond the booked count needs "Extra demo days"). */
export const addSessionBody = z.object({
  dayNumber: day,
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema.nullish(),
  subject: z.string().trim().min(1).max(100),
  teacherStaffId: z.uuid().nullish(),
  reason,
});

export const checklistBody = z.object({
  itemKey: z.string().max(60),
  status: z.enum(CHECKLIST_STATUSES),
  reason,
});

export const sessionParams = z.object({ id: z.uuid(), sessionId: z.uuid() });

export type CreateDemoInput = z.output<typeof createDemoBody>;
export type DemoListQuery = z.output<typeof demoListQuery>;
export type SessionAction = z.output<typeof sessionActionBody>;
export type AddSessionInput = z.output<typeof addSessionBody>;
