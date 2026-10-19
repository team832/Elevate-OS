/**
 * Ops configuration ("policy register", OPS-022) — every value carries a decision
 * state (PLT-007) and its source, so a value that implements a `proposed` or
 * `open` policy is never shown as policy (BR-OPS-13). Defaults come from the
 * legacy extracts in data/legacy/ops/workflows.json and operations-workbook.json.
 * Pure: the server loads stored overrides and calls `resolveSettings()`.
 */
import { z } from 'zod';

export const DECISION_STATES = [
  'proposed',
  'approved',
  'locked',
  'open',
  'pending_verification',
  'superseded',
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const DECISION_STATE_LABELS: Record<DecisionState, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  locked: 'Locked',
  open: 'Open — owner decision needed',
  pending_verification: 'Pending verification',
  superseded: 'Superseded',
};

const days = z.int().min(0).max(365);

export const settingSchemas = {
  /** Demo terms recorded in the legacy decision log (D-003, D-004 "Confirmed"; BR-OPS-2). */
  'demo.terms': z
    .object({
      days: z.int().min(1).max(7),
      separateFromMainBatch: z.literal(true),
      refundableIfNotJoining: z.boolean(),
      adjustedAgainstFeesOnJoining: z.boolean(),
    })
    .strict(),
  /** Demo fee amount. Recorded as Confirmed in legacy, but fee-data scope is OD-013. */
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
  /** BR-OPS-6 parts of the confirmation gate (BR-OPS-7 parts are fixed). */
  'admission.confirmation': z
    .object({ requireDocuments: z.boolean(), requireDownPayment: z.boolean() })
    .strict(),
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
  /** Escalation thresholds in calendar days (BR-OPS-10 levels are a starting model). */
  'tasks.escalation': z
    .object({
      overdueDaysL2: z.int().min(1).max(365),
      overdueDaysL3: z.int().min(1).max(365),
      overdueDaysL4: z.int().min(1).max(365),
      blockedDaysL2: z.int().min(1).max(365),
      responseDays: days,
    })
    .strict()
    .refine((v) => v.overdueDaysL2 < v.overdueDaysL3 && v.overdueDaysL3 < v.overdueDaysL4, {
      error: 'Thresholds must increase: L2 < L3 < L4',
    }),
  /** Cohort window for lead → admission conversion (BR-OPS-8: 7/14/30 days). */
  'kpi.conversion': z
    .object({ windowDays: z.union([z.literal(7), z.literal(14), z.literal(30)]) })
    .strict(),
  /** Online office hours (legacy Rules sheet "Locked"; conflict noted in data/legacy/README.md). */
  'office.online_hours': z
    .object({
      weekdays: z.string(),
      opens: z.string(),
      closes: z.string(),
      sundaySupport: z.boolean(),
    })
    .strict(),
  /** HR lifecycle (OPS-041): how long closed unsuccessful candidates are kept. OPEN (D-028). */
  'hr.candidate_retention': z
    .object({ retainUnsuccessfulDays: z.int().min(30).max(3650).nullable() })
    .strict(),
  /** HR lifecycle (OPS-045): default onboarding checklist. Proposed (D-028). */
  'hr.onboarding_template': z
    .object({
      items: z
        .array(
          z
            .object({
              key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
              title: z.string().min(1).max(200),
              kind: z.enum([
                'document',
                'policy_ack',
                'org_confirmation',
                'asset_assignment',
                'access_request',
                'induction',
                'custom',
              ]),
              required: z.boolean(),
              dueOffsetDays: z.int().min(-30).max(90),
              assignee: z.enum(['hr', 'manager', 'employee']),
            })
            .strict(),
        )
        .min(1)
        .max(40),
    })
    .strict(),
  /** HR lifecycle (OPS-047): fixed parts of the offboarding checklist. Proposed (D-028). */
  'hr.offboarding_checklist': z
    .object({
      exitInterview: z.boolean(),
      finalSettlementRequired: z.boolean(),
      transferDueDaysBeforeLwd: z.int().min(0).max(60),
    })
    .strict(),
  /** Staff attendance rules (OPS-050…052, OD-026). Proposed defaults, not company policy. */
  'attendance.rules': z
    .object({
      multipleSessionsPerDay: z.boolean(),
      lateGraceMinutes: z.int().min(0).max(240),
      earlyDepartureGraceMinutes: z.int().min(0).max(240),
      missingClockOutGraceMinutes: z.int().min(0).max(720),
      maxSessionHours: z.int().min(1).max(24),
    })
    .strict(),
  /** Shift scheduling rules (OPS-053, OD-026). */
  'shifts.rules': z.object({ allowSplitShifts: z.boolean() }).strict(),
  /** Leave counting rules (OPS-055, OD-026). */
  'leave.rules': z
    .object({
      defaultWorkingWeekdays: z.array(z.int().min(0).max(6)).min(1).max(7),
      countProposedHolidays: z.boolean(),
    })
    .strict(),
  /** Leave entitlements — OPEN (OD-026). Recorded only; nothing is accrued or enforced. */
  'leave.entitlements': z
    .object({
      leaveYear: z.string().max(200).nullable(),
      entitlements: z.string().max(2000).nullable(),
      accrual: z.string().max(1000).nullable(),
      carryForward: z.string().max(1000).nullable(),
      encashment: z.string().max(1000).nullable(),
    })
    .strict(),
  /** Admissions (OPS-070): closure reason codes for `→ lost`. Proposed list. */
  'admissions.closure_reasons': z
    .object({
      codes: z
        .array(
          z
            .object({
              code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
              label: z.string().min(1).max(120),
            })
            .strict(),
        )
        .min(1)
        .max(40),
      requireCode: z.boolean(),
    })
    .strict(),
  /** Admissions (OPS-072): how manual fee records are captured. Proposed (OD-013). */
  'fees.recording': z.object({ requireReceiptReference: z.boolean() }).strict(),
  /** Admissions (OPS-072): approved fee schedule reference — OPEN; none is approved. */
  'fees.schedule': z.object({ scheduleReference: z.string().max(300).nullable() }).strict(),
  /** Task reminders before the due date and on becoming overdue (OPS-063). Our proposal. */
  'tasks.reminders': z
    .object({ leadDays: z.int().min(0).max(30), notifyBackupWhenOverdue: z.boolean() })
    .strict(),
  /** Incident resolution targets in calendar days by severity (OPS-068). Our proposal. */
  'incidents.resolution_sla': z
    .object({
      lowDays: z.int().min(1).max(365),
      mediumDays: z.int().min(1).max(365),
      highDays: z.int().min(1).max(365),
    })
    .strict(),
  /** "Review due soon" window for SOPs and company policies (OPS-064, OPS-066). Our proposal. */
  'registers.review_due': z.object({ dueSoonDays: z.int().min(0).max(365) }).strict(),
  /** HR records (OPS-035): retention period per document class, in years. Open (D-028, OD-014). */
  'hr.document_retention': z
    .object({
      employmentRecordYears: z.int().min(1).max(100).nullable(),
      identityYears: z.int().min(1).max(100).nullable(),
      trainingYears: z.int().min(1).max(100).nullable(),
      generalYears: z.int().min(1).max(100).nullable(),
    })
    .strict(),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.output<(typeof settingSchemas)[K]>;

export interface SettingDefinition<K extends SettingKey = SettingKey> {
  key: K;
  label: string;
  description: string;
  defaultValue: SettingValue<K>;
  defaultState: DecisionState;
  source: string;
  ownerDecision: string | null;
  /** Can operations managers change the value here? (Changed values become `proposed`.) */
  editable: boolean;
}

export const SETTING_DEFINITIONS: { [K in SettingKey]: SettingDefinition<K> } = {
  'demo.terms': {
    key: 'demo.terms',
    label: 'Demo terms',
    description:
      'Demo length and handling: separate demo classes (never the main batch), non-refundable if the student does not join, adjusted against fees on joining.',
    defaultValue: {
      days: 2,
      separateFromMainBatch: true,
      refundableIfNotJoining: false,
      adjustedAgainstFeesOnJoining: true,
    },
    defaultState: 'approved',
    source:
      'Legacy decisions LEGACY-OPSWB-D-003 and D-004 ("Confirmed"); data/legacy/ops/workflows.json WF-DEMO; the earlier 3-day demo is superseded.',
    ownerDecision: null,
    editable: false,
  },
  'demo.fee': {
    key: 'demo.fee',
    label: 'Demo fee amount',
    description:
      'Amount recorded on each demo booking. Elevate OS records only the fee status and a reference, never accounting entries.',
    defaultValue: { amountInr: 1000 },
    defaultState: 'pending_verification',
    source:
      'Legacy D-003 and Work Inventory OP-006 record ₹1,000 as "Confirmed"; how Elevate OS handles fee data is open (OD-013), so the amount is configuration, not approved policy.',
    ownerDecision: 'OD-013',
    editable: true,
  },
  'demo.limits': {
    key: 'demo.limits',
    label: 'Demo limits',
    description: 'Consecutive days, subject cap and missed-day treatment. Not enforced while open.',
    defaultValue: { maxConsecutiveDays: null, subjectCap: null, missedDayRule: null },
    defaultState: 'open',
    source: 'Legacy decision LEGACY-OPSWB-D-005 ("Open").',
    ownerDecision: 'OD-012',
    editable: true,
  },
  'pipeline.demo_skip': {
    key: 'pipeline.demo_skip',
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
    key: 'admission.confirmation',
    label: 'Admission confirmation requirements',
    description:
      'Documents verified and down payment verified before "admitted" (BR-OPS-6). Two fee verifications by different people plus an authorised fee approval are always required (BR-OPS-7, approved) and cannot be switched off.',
    defaultValue: { requireDocuments: true, requireDownPayment: true },
    defaultState: 'proposed',
    source:
      'Marketing-Easy "Start Here" A31 (proposed definition); Work Inventory OP-008, OP-010 ("Confirmed").',
    ownerDecision: 'OD-013',
    editable: true,
  },
  'followups.due_rules': {
    key: 'followups.due_rules',
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
  'tasks.escalation': {
    key: 'tasks.escalation',
    label: 'Task escalation thresholds',
    description:
      'Overdue by N calendar days raises L2 (manager), L3 (manager’s manager / operations lead), L4 (leadership). Blocked for N days raises L2. The owner keeps the task.',
    defaultValue: {
      overdueDaysL2: 2,
      overdueDaysL3: 5,
      overdueDaysL4: 10,
      blockedDaysL2: 3,
      responseDays: 1,
    },
    defaultState: 'proposed',
    source:
      'Escalation levels L1–L4 from SYSTEM_ARCHITECTURE.md ("starting model"); thresholds are our proposal.',
    ownerDecision: 'OD-011',
    editable: true,
  },
  'kpi.conversion': {
    key: 'kpi.conversion',
    label: 'Lead → admission conversion window',
    description:
      'Days after receipt within which a cohort lead must be admitted to count (7, 14 or 30).',
    defaultValue: { windowDays: 30 },
    defaultState: 'proposed',
    source: 'BR-OPS-8 (cohort conversion over 7, 14 and 30 days; Marketing-Easy SOP Register G14).',
    ownerDecision: 'OD-027',
    editable: true,
  },
  'office.online_hours': {
    key: 'office.online_hours',
    label: 'Online office hours',
    description: 'Routine online support hours. Sunday events need an assigned event team.',
    defaultValue: {
      weekdays: 'Monday–Saturday',
      opens: '11:00',
      closes: '18:00',
      sundaySupport: false,
    },
    defaultState: 'locked',
    source:
      'Elevate-Online-Easy Rules A5:C6 ("Locked"); note: handover Claude.md says the coordinator SOP timings still need management approval.',
    ownerDecision: null,
    editable: false,
  },
  'hr.candidate_retention': {
    key: 'hr.candidate_retention',
    label: 'Unsuccessful-candidate retention',
    description:
      'Days after the last application closed (rejected or withdrawn) after which an unsuccessful candidate is listed as due for anonymisation. Null = not decided: nothing is flagged and nothing is removed automatically; anonymisation is a manual, audited action.',
    defaultValue: { retainUnsuccessfulDays: null },
    defaultState: 'open',
    source:
      'D-028: retention periods stay open until the owner supplies the policy. No legacy source gives a period.',
    ownerDecision: 'D-028',
    editable: true,
  },
  'hr.onboarding_template': {
    key: 'hr.onboarding_template',
    label: 'Default onboarding checklist',
    description:
      'Items generated for every new onboarding case: key, title, kind, required, due offset in days from the start date (or the case date) and who it is assigned to (HR = the person who opened the case, manager, or the employee).',
    defaultValue: {
      items: [
        {
          key: 'documents',
          title: 'Employment documents collected (references only)',
          kind: 'document',
          required: true,
          dueOffsetDays: 0,
          assignee: 'hr',
        },
        {
          key: 'policy_ack',
          title: 'Policy acknowledgements recorded (code of conduct, data protection)',
          kind: 'policy_ack',
          required: true,
          dueOffsetDays: 3,
          assignee: 'employee',
        },
        {
          key: 'org_confirmation',
          title: 'Department and reporting manager confirmed',
          kind: 'org_confirmation',
          required: true,
          dueOffsetDays: 0,
          assignee: 'hr',
        },
        {
          key: 'assets',
          title: 'Work assets assigned (recorded in the asset register)',
          kind: 'asset_assignment',
          required: false,
          dueOffsetDays: 0,
          assignee: 'hr',
        },
        {
          key: 'system_access',
          title: 'System access requested (request reference and status only — no credentials)',
          kind: 'access_request',
          required: true,
          dueOffsetDays: 0,
          assignee: 'hr',
        },
        {
          key: 'induction',
          title: 'Induction completed',
          kind: 'induction',
          required: true,
          dueOffsetDays: 7,
          assignee: 'manager',
        },
      ],
    },
    defaultState: 'proposed',
    source:
      'Proposal by the Business Ops team from the owner’s HR scope (D-028) and the wave 2 staff onboarding checklist; the owner has not approved a checklist.',
    ownerDecision: 'D-028',
    editable: true,
  },
  'hr.offboarding_checklist': {
    key: 'hr.offboarding_checklist',
    label: 'Offboarding checklist options',
    description:
      'Asset returns, access revocation and ownership transfers are always generated. These options add an exit interview item, make the final settlement reference item required, and set how many days before the last working day transfers are due.',
    defaultValue: {
      exitInterview: true,
      finalSettlementRequired: true,
      transferDueDaysBeforeLwd: 2,
    },
    defaultState: 'proposed',
    source: 'Proposal by the Business Ops team (D-028); no owner-approved exit process exists.',
    ownerDecision: 'D-028',
    editable: true,
  },
  'attendance.rules': {
    key: 'attendance.rules',
    label: 'Staff attendance rules',
    description:
      'Whether an employee may record several sessions on one day; grace minutes before a clock-in counts as late or a clock-out as early (against the assigned shift); how long after shift end an open session counts as a missing clock-out; maximum session length. Staff attendance only, never a performance measure on its own.',
    defaultValue: {
      multipleSessionsPerDay: false,
      lateGraceMinutes: 10,
      earlyDepartureGraceMinutes: 10,
      missingClockOutGraceMinutes: 60,
      maxSessionHours: 16,
    },
    defaultState: 'proposed',
    source:
      'Proposal by the Business Ops team (D-028). No owner-approved attendance policy exists; OD-026 covers staff attendance and leave.',
    ownerDecision: 'OD-026',
    editable: true,
  },
  'shifts.rules': {
    key: 'shifts.rules',
    label: 'Shift scheduling rules',
    description:
      'Whether one employee may hold overlapping shift assignments (split shifts). When allowed, the shifts themselves must still not overlap in time.',
    defaultValue: { allowSplitShifts: false },
    defaultState: 'proposed',
    source: 'Proposal by the Business Ops team (D-028); actual shift timings are owner decisions.',
    ownerDecision: 'OD-026',
    editable: true,
  },
  'leave.rules': {
    key: 'leave.rules',
    label: 'Leave day counting',
    description:
      'Working weekdays (0 = Sunday) used to count leave days for an employee without a shift assignment, and whether holidays still in "proposed" state are excluded from leave counts.',
    defaultValue: { defaultWorkingWeekdays: [1, 2, 3, 4, 5, 6], countProposedHolidays: true },
    defaultState: 'proposed',
    source:
      'Proposal by the Business Ops team: Monday–Saturday follows the recorded online office week (office.online_hours); OD-026 is open.',
    ownerDecision: 'OD-026',
    editable: true,
  },
  'leave.entitlements': {
    key: 'leave.entitlements',
    label: 'Leave entitlements, accrual, carry-forward, encashment',
    description:
      'Recorded for reference only and NOT enforced: no accrual job runs, nothing is carried forward or encashed, and requests are not blocked by balance. Balances exist only where HR records an allocation.',
    defaultValue: {
      leaveYear: null,
      entitlements: null,
      accrual: null,
      carryForward: null,
      encashment: null,
    },
    defaultState: 'open',
    source: 'No source defines staff leave entitlements (D-028; OD-026 open).',
    ownerDecision: 'OD-026',
    editable: true,
  },
  'admissions.closure_reasons': {
    key: 'admissions.closure_reasons',
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
    ownerDecision:
      'OD-ADM-1 (new, to be numbered): confirm the reason list and whether a code is mandatory',
    editable: true,
  },
  'fees.recording': {
    key: 'fees.recording',
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
    key: 'fees.schedule',
    label: 'Approved fee schedule',
    description:
      'Reference to the approved fee schedule that fee records quote. None is approved: every fee record carries a free-text pricing reference instead, and no amount is computed from a schedule.',
    defaultValue: { scheduleReference: null },
    defaultState: 'open',
    source: 'No approved fee schedule exists in the sources (OD-013 open).',
    ownerDecision: 'OD-013',
    editable: true,
  },
  'tasks.reminders': {
    key: 'tasks.reminders',
    label: 'Task reminders',
    description:
      'Days before the due date (Asia/Kolkata) when the task owner is reminded (0 = on the due date only), and whether the backup owner is also told when a task becomes overdue. Each reminder is sent once per due date.',
    defaultValue: { leadDays: 1, notifyBackupWhenOverdue: true },
    defaultState: 'proposed',
    source: 'Proposal by the Business Ops team (OPS-063); no source sets reminder timings.',
    ownerDecision: 'OD-011',
    editable: true,
  },
  'incidents.resolution_sla': {
    key: 'incidents.resolution_sla',
    label: 'Incident resolution targets',
    description:
      'Calendar days from when an incident or exception occurred (IST) by which it should be resolved, by severity. Used only to flag "breached"; nothing is closed automatically.',
    defaultValue: { lowDays: 14, mediumDays: 7, highDays: 2 },
    defaultState: 'proposed',
    source: 'Proposal by the Business Ops team (OPS-068); SLAs are owner decision OD-011.',
    ownerDecision: 'OD-011',
    editable: true,
  },
  'registers.review_due': {
    key: 'registers.review_due',
    label: 'Review-due window (SOPs and policies)',
    description:
      'An SOP version or company policy whose next review date is within this many days is flagged "review due soon"; after the date it is "review overdue".',
    defaultValue: { dueSoonDays: 30 },
    defaultState: 'proposed',
    source: 'Proposal by the Business Ops team (OPS-064, OPS-066).',
    ownerDecision: 'OD-027',
    editable: true,
  },
  'hr.document_retention': {
    key: 'hr.document_retention',
    label: 'Employment document retention',
    description:
      'How many years document metadata of each retention class (employment record, identity, training, general) is kept after separation. Null = not decided: nothing is flagged or removed automatically; deletion is a manual request decided by a second HR manager, and the metadata row is always kept.',
    defaultValue: {
      employmentRecordYears: null,
      identityYears: null,
      trainingYears: null,
      generalYears: null,
    },
    defaultState: 'open',
    source:
      'D-028: retention periods stay open until the owner supplies the policy; identity documents follow OD-014. No legacy source gives a period.',
    ownerDecision: 'OD-014',
    editable: true,
  },
};

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTING_DEFINITIONS;
}

export interface StoredSetting {
  key: string;
  value: unknown;
  decisionState: string;
  source: string | null;
  ownerDecision: string | null;
  updatedAt?: Date | string | null;
}

export interface ResolvedSetting<K extends SettingKey = SettingKey> {
  key: K;
  label: string;
  description: string;
  value: SettingValue<K>;
  decisionState: DecisionState;
  source: string;
  ownerDecision: string | null;
  editable: boolean;
  /** `default` = code default (nothing stored); `stored` = DB row; `invalid_stored` = DB row failed validation, default used. */
  origin: 'default' | 'stored' | 'invalid_stored';
}

export type ResolvedSettings = { [K in SettingKey]: ResolvedSetting<K> };

function isDecisionState(v: string): v is DecisionState {
  return (DECISION_STATES as readonly string[]).includes(v);
}

/** Merge stored rows over the defaults. Invalid stored values never override (fail safe). */
export function resolveSettings(stored: readonly StoredSetting[]): ResolvedSettings {
  const byKey = new Map(stored.map((s) => [s.key, s]));
  const out = {} as Record<SettingKey, ResolvedSetting>;
  for (const key of SETTING_KEYS) {
    const def = SETTING_DEFINITIONS[key] as SettingDefinition;
    const row = byKey.get(key);
    let resolved: ResolvedSetting = {
      key,
      label: def.label,
      description: def.description,
      value: def.defaultValue,
      decisionState: def.defaultState,
      source: def.source,
      ownerDecision: def.ownerDecision,
      editable: def.editable,
      origin: 'default',
    };
    if (row) {
      const parsed = (settingSchemas[key] as z.ZodType).safeParse(row.value);
      resolved =
        parsed.success && isDecisionState(row.decisionState)
          ? {
              ...resolved,
              value: parsed.data as never,
              decisionState: row.decisionState,
              source: row.source ?? def.source,
              ownerDecision: row.ownerDecision ?? def.ownerDecision,
              origin: 'stored',
            }
          : { ...resolved, origin: 'invalid_stored' };
    }
    out[key] = resolved;
  }
  return out as ResolvedSettings;
}

/**
 * Validate a requested change. Changing a value never makes it approved: the
 * result state is `proposed` (approving policies is a director decision, OPS-022).
 */
export function validateSettingChange(
  key: string,
  value: unknown,
):
  | { ok: true; key: SettingKey; value: unknown; decisionState: 'proposed' }
  | { ok: false; message: string } {
  if (!isSettingKey(key)) return { ok: false, message: `Unknown setting "${key}".` };
  const def = SETTING_DEFINITIONS[key];
  if (!def.editable)
    return {
      ok: false,
      message: `"${def.label}" records a legacy ${def.defaultState} decision and cannot be changed here.`,
    };
  const parsed = (settingSchemas[key] as z.ZodType).safeParse(value);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid value.' };
  return { ok: true, key, value: parsed.data, decisionState: 'proposed' };
}
