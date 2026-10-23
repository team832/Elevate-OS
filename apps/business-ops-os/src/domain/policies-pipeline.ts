/** Policy register: demo, pipeline, follow-up, KPI, closure and fee-recording settings. */
import { z } from 'zod';
import { codeList, type DefinitionsFor } from './policies-base';

const days = z.int().min(0).max(365);

export const pipelineSettingSchemas = {
  /** Demo terms recorded in the legacy decision log (D-003, D-004 "Confirmed"; BR-OPS-2). */
  'demo.terms': z
    .object({
      separateFromMainBatch: z.literal(true),
      refundableIfNotJoining: z.boolean(),
      adjustedAgainstFeesOnJoining: z.boolean(),
    })
    .strict(),
  /** Demo days per demo student, each with one or more classes (D-038; supersedes D-035's classes). */
  'admissions.demo.day_count': z.object({ count: z.int().min(1).max(10) }).strict(),
  /** Whether an authorised person may add demo days beyond the day count (brief §5). */
  'admissions.demo.extension': z
    .object({ allowed: z.boolean(), maxExtraDays: z.int().min(0).max(7) })
    .strict(),
  /** Whether every demo checklist item must be resolved before conversion (owner brief §6). */
  'admissions.demo.checklist_required': z
    .object({ requiredBeforeConversion: z.boolean() })
    .strict(),
  /** Demo fee amount in rupees (₹1,000, owner decision D-045); stored rows use this shape. */
  'demo.fee': z.object({ amountInr: z.number().min(0).max(1_000_000) }).strict(),
  /** Demo limits — OPEN (legacy D-005, OD-012). Null = not decided, not enforced. */
  'demo.limits': z
    .object({
      maxConsecutiveDays: z.int().min(1).max(14).nullable(),
      subjectCap: z.int().min(1).max(20).nullable(),
      missedDayRule: z.string().max(500).nullable(),
    })
    .strict(),
  /** Whether counselled → admission_pending (demo skipped) is allowed. Our proposal. */
  'pipeline.demo_skip': z.object({ allowed: z.boolean() }).strict(),
  /** BR-OPS-6: documents checklist item (payment before admission is `admission.payment_gate`). */
  'admission.confirmation': z.object({ requireDocuments: z.boolean() }).strict(),
  /** Follow-up due rules (legacy OP-007 "Proposed"; service hours are OD-011). */
  'followups.due_rules': z
    .object({
      firstContactDays: days,
      afterCounsellingDays: days,
      afterDemoDays: days,
      upcomingWindowDays: days,
      closedWeekdays: z.array(z.int().min(0).max(6)).max(6),
    })
    .strict(),
  /** Cohort window for lead → admission conversion (BR-OPS-8: 7/14/30 days). */
  'kpi.conversion': z
    .object({ windowDays: z.union([z.literal(7), z.literal(14), z.literal(30)]) })
    .strict(),
  /** Admissions (OPS-070): closure reason codes for `→ lost`. Proposed list. */
  'admissions.closure_reasons': z
    .object({
      codes: codeList.min(1),
      requireCode: z.boolean(),
    })
    .strict(),
  /** Admissions (OPS-072): how manual fee records are captured. Proposed (OD-013). */
  'fees.recording': z.object({ requireReceiptReference: z.boolean() }).strict(),
  /** Admissions (OPS-072): approved fee schedule reference — OPEN; none is approved. */
  'fees.schedule': z.object({ scheduleReference: z.string().max(300).nullable() }).strict(),
  /** Fee plans (owner brief §8E): how ledger money is applied to instalments. Proposed. */
  'fees.allocation': z
    .object({ rule: z.literal('oldest_due_first'), dueWindowDays: z.int().min(0).max(60) })
    .strict(),
} as const;

export const PIPELINE_SETTING_DEFINITIONS: DefinitionsFor<typeof pipelineSettingSchemas> = {
  'demo.terms': {
    label: 'Demo terms',
    description:
      'Demo handling: separate demo classes (never the main batch), non-refundable if the student does not join, adjusted against fees on joining (applied as a ledger credit through fees.demo_credit).',
    defaultValue: {
      separateFromMainBatch: true,
      refundableIfNotJoining: false,
      adjustedAgainstFeesOnJoining: true,
    },
    defaultState: 'approved',
    source:
      'Legacy decisions LEGACY-OPSWB-D-003 and D-004 ("Confirmed"); data/legacy/ops/workflows.json WF-DEMO. The legacy 2-day length moved to admissions.demo.day_count (D-038).',
    ownerDecision: null,
    editable: false,
  },
  'admissions.demo.day_count': {
    label: 'Demo days per student',
    description:
      'How many demo days each demo student gets; each day has one or more classes. Progress counts days attended (sessions attended are shown separately). A change applies to demos booked afterwards (each demo keeps the count it was booked with).',
    defaultValue: { count: 3 },
    defaultState: 'approved',
    source:
      'Owner, 21 Oct 2026: a demo is three demo days, each with one or more classes (supersedes the three classes of D-035 and the legacy 2-day demo).',
    ownerDecision: 'D-038',
    editable: true,
  },
  'admissions.demo.extension': {
    label: 'Extra demo days',
    description:
      'Off: a demo never gets a day beyond the day count, and an absent day is never counted as attended. On: a person with demo rights may add up to the given number of extra days, with a reason (audited).',
    defaultValue: { allowed: false, maxExtraDays: 1 },
    defaultState: 'proposed',
    source:
      'owner brief 2026-10-21 §5 ("extensions need an explicit configured authorized process").',
    ownerDecision: 'Owner to decide whether demos can be extended, and by how much',
    editable: true,
  },
  'admissions.demo.checklist_required': {
    label: 'Demo checklist required before conversion',
    description:
      'When on, every demo checklist item must be complete, waived with a reason or not applicable before a demo can be converted to an admission. Off: the checklist is shown as information only.',
    defaultValue: { requiredBeforeConversion: false },
    defaultState: 'proposed',
    source:
      'owner brief 2026-10-20 §6 ("don’t force all items unless management approves"); not enforced until approved.',
    ownerDecision: null,
    editable: true,
  },
  'demo.fee': {
    label: 'Demo fee amount',
    description:
      'Amount recorded on each demo booking. Elevate OS records only the fee status and a reference, never accounting entries.',
    defaultValue: { amountInr: 1000 },
    defaultState: 'approved',
    source:
      'Owner approved in session, 21 Oct 2026 (D-045): demo fee ₹1,000 (legacy D-003 / OP-006 had the same amount). Refund and waiver limits (rest of OD-013) stay open.',
    ownerDecision: 'D-045',
    editable: true,
  },
  'demo.limits': {
    label: 'Demo limits',
    description: 'Consecutive days, subject cap and missed-day treatment. Not enforced while open.',
    defaultValue: { maxConsecutiveDays: null, subjectCap: null, missedDayRule: null },
    defaultState: 'open',
    source: 'Legacy decision LEGACY-OPSWB-D-005 ("Open").',
    ownerDecision: 'OD-012',
    editable: true,
  },
  'pipeline.demo_skip': {
    label: 'Allow admission without a demo',
    description:
      'Whether a counselled lead may go straight to "admission pending" (a reason is always required). The legacy sources describe the demo step but do not say it is mandatory.',
    defaultValue: { allowed: true },
    defaultState: 'proposed',
    source:
      'Proposal by the Business Ops team: BR-OPS-1 lists the demo step; no source makes it mandatory or optional.',
    ownerDecision: null,
    editable: true,
  },
  'admission.confirmation': {
    label: 'Admission confirmation requirements',
    description:
      'Whether the "documents verified" checklist item is shown as required. Two fee verifications by different people plus an authorised fee approval are always required (approved). Payment before admission is the separate setting "Payment before admission"; an admission is confirmed only through "Confirm admission" with a password re-check.',
    defaultValue: { requireDocuments: true },
    defaultState: 'proposed',
    source:
      'Marketing-Easy "Start Here" A31 (proposed definition); Work Inventory OP-008, OP-010 ("Confirmed").',
    ownerDecision: 'OD-013',
    editable: true,
  },
  'followups.due_rules': {
    label: 'Follow-up due rules',
    description:
      'Days after an event when the next follow-up is due (Asia/Kolkata calendar days), the "upcoming" window, and closed weekdays (0 = Sunday) that push a due date to the next open day.',
    defaultValue: {
      firstContactDays: 0,
      afterCounsellingDays: 1,
      afterDemoDays: 1,
      upcomingWindowDays: 2,
      closedWeekdays: [0],
    },
    defaultState: 'proposed',
    source:
      'Work Inventory LEGACY-OPSWB-OP-007 ("Proposed": WhatsApp next-day feedback, calls within 1–2 days); Sunday closure follows the online "no routine Sunday support" rule.',
    ownerDecision: 'OD-011',
    editable: true,
  },
  'kpi.conversion': {
    label: 'Lead → admission conversion window',
    description:
      'Days after receipt within which a cohort lead must be admitted to count (7, 14 or 30).',
    defaultValue: { windowDays: 30 },
    defaultState: 'proposed',
    source: 'BR-OPS-8 (cohort conversion over 7, 14 and 30 days; Marketing-Easy SOP Register G14).',
    ownerDecision: 'OD-027',
    editable: true,
  },
  'admissions.closure_reasons': {
    label: 'Admission closure reason codes',
    description:
      'Coded reasons offered when a case is closed as lost/withdrawn (the free-text reason stays required). "Withdrew after admission" applies only to admitted cases; "duplicate merged" is set by the merge service. With requireCode off, an uncoded closure is reported as "not coded".',
    defaultValue: {
      codes: [
        { code: 'not_interested', label: 'Not interested' },
        { code: 'chose_competitor', label: 'Chose another institute' },
        { code: 'fees_affordability', label: 'Fees / affordability' },
        { code: 'timing_schedule', label: 'Timing or schedule does not suit' },
        { code: 'location_mode', label: 'Location or mode does not suit' },
        { code: 'unreachable', label: 'Could not be reached' },
        { code: 'not_eligible', label: 'Not eligible for the programme' },
        { code: 'withdrawn_after_admission', label: 'Withdrew after admission (before enrolment)' },
        { code: 'cancelled_by_institute', label: 'Cancelled by Elevate' },
        { code: 'duplicate_merged', label: 'Duplicate merged into another lead' },
        { code: 'other', label: 'Other (explain in the reason)' },
      ],
      requireCode: false,
    },
    defaultState: 'proposed',
    source:
      'Proposal by the Business Ops team (admissions build, 19 Oct 2026); the legacy CRM records only free-text "lost" reasons.',
    ownerDecision: 'OD-046: confirm the reason list and whether a code is mandatory',
    editable: true,
  },
  'fees.recording': {
    label: 'Manual fee records',
    description:
      'Fee records are typed in by authorised staff and are NOT verified payment transactions (no gateway, no card data). When on, amounts received and refunds need a receipt/transaction reference. A second, different person may mark a record as checked.',
    defaultValue: { requireReceiptReference: true },
    defaultState: 'proposed',
    source:
      'Owner prompt 19 Oct 2026 (manually recorded administrative fee records); fee-data scope is OD-013.',
    ownerDecision: 'OD-013',
    editable: true,
  },
  'fees.schedule': {
    label: 'Approved fee schedule',
    description:
      'Reference to the approved fee schedule that fee records quote. None is approved: every fee record carries a free-text pricing reference instead, and no amount is computed from a schedule.',
    defaultValue: { scheduleReference: null },
    defaultState: 'open',
    source: 'No approved fee schedule exists in the sources (OD-013 open).',
    ownerDecision: 'OD-013',
    editable: true,
  },
  'fees.allocation': {
    label: 'Fee instalment allocation',
    description:
      'How manually recorded payments, discounts and waivers are applied to a fee plan’s instalments: oldest due date first. An unpaid instalment due within the window (days, Asia/Kolkata) shows as "Due soon", later ones as "Upcoming", past its due date as "Overdue".',
    defaultValue: { rule: 'oldest_due_first', dueWindowDays: 7 },
    defaultState: 'proposed',
    source:
      'Proposal by the Business Ops team (fee plans build, 20 Oct 2026); no owner rule exists.',
    ownerDecision: 'Owner to confirm the allocation order and the "due soon" window',
    editable: true,
  },
};
