/**
 * "Download (spreadsheet)" (owner, 6 Nov 2026): a list or the staff attendance register as CSV
 * for Excel or Google Sheets (server-kit toCsv: UTF-8 BOM, formula-safe). Each export calls the
 * page's own service with the page's filters, so permission, scope and redaction are the page's,
 * and it pages through every matching row, not only the rows on screen. Columns are the page's;
 * contact fields are never exported. Audited: the list, which filters were set (names only: a
 * value can be a name or a phone number) and the row count.
 */
import type { z } from 'zod';
import { ROLES } from '@elevate/authorization';
import type { Database } from '@elevate/database';
import { csvResponse, toCsv, type CsvCell } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import { ADMISSION_STATUS_LABELS, ADMISSION_STATUSES, istToday } from '../domain';
import {
  datesBetween,
  monthRange,
  monthTotals,
  shownStatus,
  type ShownStatus,
} from '../domain/attendance';
import { INSTALMENT_STATUS_LABELS, STUDENT_FEE_STATUS_LABELS } from '../domain/fee-plans';
import {
  FEE_CHARGE_LABELS,
  FEE_KIND_LABELS,
  FEE_RECORD_STATUSES,
  FEE_STATUS_LABELS,
} from '../domain/fees';
import { taskStatusLabel } from '../domain/staff-tasks';
import { fmtDateTime, humanise } from '../ui/format';
import { deriveDays, readableStaff } from './attendance';
import { attendanceListQuery } from './attendance-schemas';
import { notFound, staffIdForUser, type Actor } from './context';
import {
  filterOutstanding,
  listCollections,
  outstandingInstalments,
  OUTSTANDING_VIEWS,
  type OutstandingView,
} from './fee-collections';
import { NOT_STAGED } from './lead-funnel';
import { listLeadStages } from './lead-stages';
import { LEAD_LIST_FLAGS, leadCounts, listLeads } from './leads';
import { opsAudit } from './ops-common';
import { getDirectory } from './organisation';
import { rangeOf } from './overview';
import { listTasks } from './staff-tasks';
import { taskListQuery } from './staff-tasks-schemas';
import { listStudents } from './students';
import { studentSearchQuery } from './students-schemas';
import { leaveAllowanceExport } from './leave-balances';

export const EXPORT_LISTS = [
  'students',
  'leads',
  'collections',
  'outstanding',
  'staff',
  'tasks',
  'attendance',
  'leave-allowances',
] as const;
export type ExportList = (typeof EXPORT_LISTS)[number];
/** The route's gate: any list's page permission; each list's own service checks its own. */
export const EXPORT_PERMISSIONS = [
  'ops:students:read',
  'ops:leads:read',
  'ops:fees:read',
  'ops:hr:read',
  'ops:organisation:read',
  'ops:tasks:read',
  'ops:attendance:read',
] as const;
const EXPORT_MAX_ROWS = 5000;
const PAGE = 200;

type Params = Record<string, string | undefined>;
type Sheet = { header: string[]; rows: CsvCell[][]; footer?: CsvCell[][]; filename?: string };
type Column<T> = readonly [header: string, cell: (row: T) => CsvCell];

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new ValidationError(
      'Some filters are not valid. Open the list again and download from there.',
    );
  return r.data;
}

/** More than EXPORT_MAX_ROWS is refused, never cut short silently. */
function assertCap(total: number) {
  if (total > EXPORT_MAX_ROWS)
    throw new ValidationError(
      `This list has ${total} rows. Narrow the filters to ${EXPORT_MAX_ROWS} or fewer to download it.`,
    );
}

/** Every page of a list's own query (capped). */
async function allPages<T>(page: (n: number) => Promise<{ rows: readonly T[]; total: number }>) {
  const first = await page(1);
  assertCap(first.total);
  const rows = [...first.rows];
  for (let n = 2; rows.length < first.total; n++) {
    const next = await page(n);
    if (!next.rows.length) break;
    rows.push(...next.rows);
  }
  return rows;
}

const sheet = <T>(rows: readonly T[], columns: readonly Column<T>[]): Sheet => ({
  header: columns.map((c) => c[0]),
  rows: rows.map((r) => columns.map((c) => c[1](r))),
});
const SAMPLE: Column<{ isSample: boolean | null }> = [
  'Sample data',
  (r) => (r.isSample ? 'Sample data' : ''),
];
const rupees = (paise: number) => paise / 100;

const LISTS: Record<ExportList, (db: Database, actor: Actor, p: Params) => Promise<Sheet>> = {
  async students(db, actor, p) {
    const q = parse(studentSearchQuery, { ...p, limit: PAGE });
    const rows = await allPages(async (n) => {
      const r = await listStudents(db, actor, { ...q, cursor: String((n - 1) * PAGE) });
      return { rows: r.items, total: r.total };
    });
    return sheet(rows, [
      ['Admission no.', (s) => s.admissionNumber ?? 'Not assigned'],
      ['Student', (s) => s.studentName],
      ['Programmes', (s) => s.combination],
      ['Enrolment status', (s) => s.statusLabel],
      ['Fee status', (s) => (s.feeStatus ? STUDENT_FEE_STATUS_LABELS[s.feeStatus] : 'Restricted')],
      ['Counsellor', (s) => s.counsellorName ?? 'Unassigned'],
      ['Admission date', (s) => s.admissionDate],
      ['Status reason', (s) => s.statusReason],
      ['Review date', (s) => s.holdReviewDate],
      ['Last activity', (s) => fmtDateTime(s.lastActivityAt)],
      SAMPLE,
    ]);
  },

  async leads(db, actor, p) {
    const filters = {
      q: p.q,
      status: ADMISSION_STATUSES.find((s) => s === p.stage),
      leadStage: p.leadStage === NOT_STAGED ? null : p.leadStage || undefined,
      flag: LEAD_LIST_FLAGS.find((f) => f === p.flag),
    };
    const [{ total }, stages] = await Promise.all([
      leadCounts(db, actor, filters),
      listLeadStages(db, actor),
    ]);
    const rows = await allPages(async (n) => ({
      rows: await listLeads(db, actor, { ...filters, limit: PAGE, offset: (n - 1) * PAGE }),
      total,
    }));
    return sheet(rows, [
      ['Lead', (l) => l.code],
      ['Student', (l) => l.studentName],
      ['Interest', (l) => l.programmeName ?? 'Undecided'],
      [
        'Lead stage',
        (l) =>
          l.stageKey
            ? (stages.find((s) => s.key === l.stageKey)?.label ?? humanise(l.stageKey))
            : 'Not staged',
      ],
      ['Admission', (l) => (l.status ? ADMISSION_STATUS_LABELS[l.status] : 'No case yet')],
      [
        'Owner',
        (l) =>
          l.ownerName
            ? `${l.ownerName}${l.assignment === 'handoff_pending' ? ' (not accepted)' : ''}`
            : 'Unassigned',
      ],
      ['Do not contact', (l) => (l.doNotContact ? 'Yes' : '')],
      [
        'Flags',
        (l) =>
          [
            l.flags.overdue && 'Overdue follow-up',
            l.flags.missingNextAction && 'No next action',
            l.flags.openDuplicates &&
              (l.flags.exactDuplicate ? 'Existing contact' : 'Possible duplicate'),
          ]
            .filter(Boolean)
            .join('; '),
      ],
      ['Received', (l) => fmtDateTime(l.receivedAt)],
      SAMPLE,
    ]);
  },

  async collections(db, actor, p) {
    const { range } = rangeOf(p);
    const status = FEE_RECORD_STATUSES.find((s) => s === p.status);
    const rows = await allPages((page) => listCollections(db, actor, { ...range, status, page }));
    return sheet(rows, [
      ['Student', (f) => f.studentName],
      ['Payment date', (f) => f.paymentDate],
      ['Entry', (f) => `${FEE_KIND_LABELS[f.kind]} · ${FEE_CHARGE_LABELS[f.chargeCategory]}`],
      ['Amount (₹)', (f) => rupees(f.amountPaise)],
      ['Receipt ref.', (f) => f.receiptReference ?? 'Not given'],
      ['Entry no.', (f) => f.code],
      ['Status', (f) => (f.reversed ? 'Reversed, not counted' : FEE_STATUS_LABELS[f.status])],
      SAMPLE,
    ]);
  },

  async outstanding(db, actor, p) {
    const status = (Object.keys(OUTSTANDING_VIEWS) as OutstandingView[]).find(
      (v) => v === p.status,
    );
    // One computation, not listOutstanding page by page (it recomputes everything per page of 25).
    const rows = filterOutstanding(await outstandingInstalments(db, actor), { ...p, status });
    assertCap(rows.length);
    return sheet(rows, [
      ['Student', (i) => i.studentName ?? 'Not linked'],
      [
        'Instalment',
        (i) => (i.sequence === null ? 'Above the instalments' : `${i.sequence} of ${i.of}`),
      ],
      ['Fee agreement', (i) => i.plan],
      ['Due date', (i) => i.dueDate ?? 'No due date'],
      ['Amount (₹)', (i) => rupees(i.amountPaise)],
      ['Still owed (₹)', (i) => rupees(i.remainingPaise)],
      ['Status', (i) => INSTALMENT_STATUS_LABELS[i.status]],
      SAMPLE,
    ]);
  },

  async staff(db, actor, p) {
    const view = p.view === 'organisation' ? 'organisation' : 'hr';
    const rows = await allPages(async (page) => {
      const d = await getDirectory(db, actor, { ...p, page: String(page) }, view);
      return { rows: d.staff, total: d.total };
    });
    return sheet(rows, [
      ['Name', (s) => s.displayName],
      ['Employee ID', (s) => s.staffCode ?? 'Not recorded'],
      ['Job title', (s) => s.title ?? 'Not recorded'],
      ['Department', (s) => s.departmentName ?? 'None'],
      ['Reports to', (s) => s.managerName ?? 'Nobody'],
      ['Branch', (s) => s.branchName ?? 'Not recorded'],
      [
        'Roles',
        (s) => s.roles.map((k) => ROLES[k].label).join(', ') || (s.hasLogin ? 'None' : 'No login'),
      ],
      ['Employment', (s) => humanise(s.employmentStatus)],
    ]);
  },

  async tasks(db, actor, p) {
    const q = parse(taskListQuery, p);
    const rows = await allPages((page) => listTasks(db, actor, { ...q, page }, PAGE));
    return sheet(rows, [
      ['Task', (t) => t.title],
      ['Owner', (t) => t.staffName],
      ['Priority', (t) => humanise(t.priority)],
      ['Due (IST)', (t) => `${t.dueOn}${t.dueTime ? ` ${t.dueTime.slice(0, 5)}` : ''}`],
      ['Status', (t) => taskStatusLabel(t.status, t.reviewRequired)],
      ['Acknowledged', (t) => (t.acknowledgedAt ? fmtDateTime(t.acknowledgedAt) : 'Not yet')],
      ['% done (self-reported)', (t) => t.progressPercent],
      ['Reason', (t) => t.blockedReason ?? t.reason ?? ''],
      SAMPLE,
    ]);
  },

  attendance: attendanceSheet,
  'leave-allowances': leaveAllowanceExport,
};

const DAY_CODES: Record<ShownStatus, string> = {
  present: 'P',
  half_day: 'HD',
  absent: 'A',
  unmarked: '',
  on_leave: 'L',
  half_day_leave: 'HL',
  holiday: 'H',
  weekly_off: 'WO',
  no_schedule: 'NS',
};

/**
 * Staff attendance register: one month, rows = staff, a column per day (up to today), cells from
 * the same deriveDays result the attendance pages show. Unmarked stays blank, never absent.
 * Own scope (and `mine=1` from My attendance) = the reader's own row only.
 */
async function attendanceSheet(db: Database, actor: Actor, p: Params): Promise<Sheet> {
  const today = istToday(new Date());
  const month = p.month ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0, 7))
    throw new ValidationError('Choose this month or an earlier one (YYYY-MM).');
  const { from, to } = monthRange(month);
  const f = parse(
    attendanceListQuery.pick({ q: true, who: true, department: true, branch: true }),
    { q: p.q, who: p.who, department: p.department, branch: p.branch },
  );
  const staffId =
    p.mine === '1' ? ((await staffIdForUser(db, actor.id)) ?? notFound('Staff member')) : undefined;
  const staff = await readableStaff(db, actor, { ...f, staffId });
  const days = await deriveDays(db, staff, from, to);
  const dates = datesBetween(from, to < today ? to : today);
  const rows = staff.map((s) => {
    const mine = days.get(s.id) ?? [];
    const on = new Map(mine.map((d) => [d.date, d]));
    const t = monthTotals(mine);
    const cells = dates.map((d) => {
      const day = on.get(d);
      return day ? DAY_CODES[shownStatus(day)] : '';
    });
    return [
      s.name,
      s.staffCode,
      s.departmentName,
      ...cells,
      t.scheduledWorkdays,
      t.present,
      t.halfDays,
      t.leave,
      t.confirmedAbsences,
      t.unmarked,
      t.holidays,
      t.weeklyOff,
      t.unjudged,
    ];
  });
  return {
    filename: `staff-attendance-${month}.csv`,
    header: [
      'Staff member',
      'Staff code',
      'Department',
      ...dates,
      'Working days',
      'Present',
      'Half days',
      'On leave',
      'Absent (confirmed by HR)',
      'Unmarked',
      'Holidays',
      'Weekly offs',
      'No schedule',
    ],
    rows,
    footer: [
      [],
      [`Staff attendance · ${month} · days up to ${dates.at(-1) ?? from}`],
      [
        'Legend: P present, HD half day, A absent (confirmed by HR), L on leave, HL half day leave (counted in On leave), H holiday, WO weekly off, NS no work schedule known, blank = unmarked (not an absence).',
      ],
      [
        'Working days = the days the schedule says the person works, without holidays; blank = no work schedule known. Days after today are not listed. Separate from classes taught.',
      ],
    ],
  };
}

/** The CSV download of one list or register (route `GET /ops/api/v1/exports/:list`); audited. */
export async function exportList(
  db: Database,
  actor: Actor,
  list: ExportList,
  params: Params,
): Promise<Response> {
  const s = await LISTS[list](db, actor, params);
  await opsAudit('export')(db, actor, null, 'export.downloaded', {
    metadata: {
      list,
      filters: Object.keys(params)
        .filter((k) => params[k])
        .sort(),
      rows: s.rows.length,
    },
  });
  return csvResponse(
    toCsv(s.header, [...s.rows, ...(s.footer ?? [])]),
    s.filename ?? `${list}-${istToday(new Date())}.csv`,
  );
}
