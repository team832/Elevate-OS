/**
 * `@elevate/business-ops-os/work` (D-073): the one staff task and end-of-day report
 * implementation, for Academic OS and Marketing OS to show in their own shells. A host page
 * checks access (its own gate) and renders its shell around a body given its basePath; a host
 * route file re-exports the same handlers, so the permission checks are the same everywhere.
 *
 *   export const { GET, POST } = workRoutes['staff-tasks'];
 */
import type { Permission } from '@elevate/authorization';
import * as attachment from './app/api/v1/attachments/[id]/route'; // ATTACH
import * as attachments from './app/api/v1/attachments/route'; // ATTACH
import * as aiReportDraft from './app/api/v1/ai/report-draft/route'; // AI
import * as attendance from './app/api/v1/attendance/route'; // ATT
import * as attendanceCorrections from './app/api/v1/attendance/corrections/route'; // ATT
import * as eodReport from './app/api/v1/eod-reports/[id]/route';
import * as eodReportCsv from './app/api/v1/eod-reports/[id]/csv/route';
import * as eodReportFollowUp from './app/api/v1/eod-reports/[id]/follow-up/route';
import * as eodReportPdf from './app/api/v1/eod-reports/[id]/pdf/route';
import * as eodReportReview from './app/api/v1/eod-reports/[id]/review/route';
import * as eodReportSubmit from './app/api/v1/eod-reports/[id]/submit/route';
import * as eodReports from './app/api/v1/eod-reports/route';
import * as feedbackMine from './app/api/v1/feedback/mine/route'; // FB
import * as feedbackMineOne from './app/api/v1/feedback/mine/[id]/route'; // FB
import * as hrRequest from './app/api/v1/hr-requests/[id]/route'; // HR-REQ
import * as hrRequestAction from './app/api/v1/hr-requests/[id]/[action]/route'; // HR-REQ
import * as hrRequests from './app/api/v1/hr-requests/route'; // HR-REQ
import * as notifications from './app/api/v1/notifications/route';
import * as notificationOpen from './app/notifications/[id]/open/route'; // NOTIFY
import * as staffTask from './app/api/v1/staff-tasks/[id]/route';
import * as staffTaskAction from './app/api/v1/staff-tasks/[id]/[action]/route';
import * as staffTaskChecklist from './app/api/v1/staff-tasks/[id]/checklist/route';
import * as staffTaskDependencies from './app/api/v1/staff-tasks/[id]/dependencies/route';
import * as staffTaskReassign from './app/api/v1/staff-tasks/[id]/reassign/route';
import * as staffTaskReport from './app/api/v1/staff-tasks/[id]/report/route';
import * as staffTaskUpdates from './app/api/v1/staff-tasks/[id]/updates/route';
import * as staffTasks from './app/api/v1/staff-tasks/route';
import * as taskReports from './app/api/v1/task-reports/route';

export { MeetingsBody } from './app/meetings/meetings-body';
export { MyAttendanceBody } from './app/my-attendance/my-attendance-body'; // ATT
export { NotificationsBody } from './app/notifications/notifications-body';
export { DueWork } from './ui/task-notices'; // NOTIFY
export { TaskBody, TasksBody, type BodyProps } from './app/tasks/_components/bodies';
export { InboxBody } from './app/tasks/inbox/inbox-body';
export { TaskReportsBody } from './app/tasks/reports/reports-body';
export { MyReportsBody } from './app/tasks/reports/my-reports-body';
export { listMyMeetings } from './server/appointments';
export { hasInbox } from './server/eod-review';
export { taskDaySummary } from './server/staff-tasks';
export { listTasks } from './server/staff-tasks'; // MKT: Deliverables + My Day lists
export { taskListQuery } from './server/staff-tasks-schemas'; // MKT
export { myReports } from './server/work-reports'; // MKT-PERF: monthly report status for a period
export { STANDING_LABELS } from './domain/work-report';
export { taskStatusLabel } from './domain/staff-tasks'; // MKT (TASKS: do not add a second copy)
export { linkUrl } from './server/task-links';
export { listAttachments } from './server/attachments'; // ATTACH
export { AttachmentList, AttachmentUpload } from './ui/attachments'; // ATTACH
export { FeedbackDevelopmentBody } from './ui/feedback-development'; // FB
export { HrRequestsBody } from './app/hr-requests/hr-requests-body'; // HR-REQ

/** GET <base>/notifications/{id}/open (a page route, not under api/v1): `export const { GET } = notificationOpen;` */
export { notificationOpen }; // NOTIFY

/** Route handlers by path under `<base>/api/v1/` (tracker imports stay in Ops). */
export const workRoutes = {
  'staff-tasks': staffTasks,
  'staff-tasks/[id]': staffTask,
  'staff-tasks/[id]/[action]': staffTaskAction,
  'staff-tasks/[id]/checklist': staffTaskChecklist,
  'staff-tasks/[id]/dependencies': staffTaskDependencies,
  'staff-tasks/[id]/reassign': staffTaskReassign,
  'staff-tasks/[id]/report': staffTaskReport,
  'staff-tasks/[id]/updates': staffTaskUpdates,
  'eod-reports': eodReports,
  'eod-reports/[id]': eodReport,
  'eod-reports/[id]/csv': eodReportCsv,
  'eod-reports/[id]/follow-up': eodReportFollowUp,
  'eod-reports/[id]/pdf': eodReportPdf,
  'eod-reports/[id]/review': eodReportReview,
  'eod-reports/[id]/submit': eodReportSubmit,
  'task-reports': taskReports,
  notifications,
  attachments, // ATTACH
  'attachments/[id]': attachment, // ATTACH
  'feedback/mine': feedbackMine, // FB
  'feedback/mine/[id]': feedbackMineOne, // FB
  attendance, // ATT
  'attendance/corrections': attendanceCorrections, // ATT
  'ai/report-draft': aiReportDraft, // AI
  'hr-requests': hrRequests, // HR-REQ
  'hr-requests/[id]': hrRequest, // HR-REQ
  'hr-requests/[id]/[action]': hrRequestAction, // HR-REQ
};

export interface NavRow {
  key: string;
  label: string;
  href: string;
  permission: Permission;
}

/** Sidebar rows for a host; show "tasks-inbox" only when `hasInbox(db, user)` is true. */
export const workNav = (base: string): NavRow[] => [
  { key: 'tasks', label: 'My tasks', href: `${base}/tasks`, permission: 'ops:tasks:read' },
  {
    key: 'eod',
    label: 'My EOD report',
    href: `${base}/tasks?tab=eod`,
    permission: 'ops:tasks:read',
  },
  {
    key: 'tasks-inbox',
    label: 'Report inbox',
    href: `${base}/tasks/inbox`,
    permission: 'ops:tasks:read',
  },
  {
    key: 'tasks-reports',
    label: 'Task reports',
    href: `${base}/tasks/reports`,
    permission: 'ops:tasks:read',
  },
];
export { createTask } from './server/staff-tasks'; // MKT-PLAN: calendar item → Ops task
export { taskBody } from './server/staff-tasks-schemas'; // MKT-PLAN
