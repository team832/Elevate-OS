/**
 * Business Ops OS server layer — services (transactions, permission checks, audit),
 * repositories and adapters. Exported as `@elevate/business-ops-os/server` for the platform
 * app and wave-3 integration tests. Other MODULES must never import it (D-011.3).
 */
export { MODULE_PATHS } from './paths';
export { authOptions } from './auth';
export {
  ENROLMENT_REPLIES_CONSUMER,
  knownStudentIdForPerson,
  processEnrolmentReplies,
  requestEnrolment,
  retryEnrolmentHandoff,
} from './enrolment';
export { changeStudentLifecycle } from './student-lifecycle';
export { applyForLeave, cancelLeaveApplication, decideLeave } from './leave-applications';
export { activeCoverFor, type CoverKind } from './approval-cover';
export { generateStudentReport, setStudentReportStatus, studentReportPdf } from './student-report';
export { generateTeacherReport, teacherReportPdf } from './teacher-report';
export { getStudent } from './student-profile';
export { plansWithLedger } from './fee-agreements';
export { receiptFor, renderReceiptPdf } from './receipts';
export { runFollowUpReminders } from './follow-ups';
export { APPROVAL_SOURCES, listApprovalInbox, type ApprovalSource } from './approvals';
export { updateStaff } from './organisation';
export {
  countAdmissionsByStatus,
  countOpenLeads,
  openFollowUpsForOverview,
} from './reports/overview';
export { buildDashboard } from './dashboard';
export { fetchCrossModuleSummaries } from './summaries';
export { getCrmAdapter, MockCrmAdapter, type CrmAdapter } from './adapters/crm';
export { createHrRequest } from './hr-requests';
export { hrQueue, inHrReach } from './hr-requests-read';
export { hrRequestListQuery } from './hr-requests-schemas';
export { createLead, updateLead } from './leads';
export { createLeadBody } from './schemas';
export { listTeachers, updateTeacher } from './teachers';
export { attendanceStaff, deriveDays, listRange } from './attendance';
export { hrAttendanceCounts } from './attendance-hr';
export { myFeedback } from './feedback-teacher';
export { loadSettings } from './settings';
export { feeRecordStudentId, portalFees } from './portal-fees';
export { isAdultStudent } from './portal-access';
export { feeYear } from './fee-year';
export { outstandingInstalments } from './fee-collections';
export { buildAdmissionsOverview } from './admissions-overview';
export { buildAdmissionsFunnel } from './reports/admissions-funnel';
export { listDemos } from './demos';
export { demoListQuery } from './demos-schemas';
export { hrTabCounts, hrTaskCounts } from './staff-tasks-hr';
export { periodReport } from './task-period-report';
