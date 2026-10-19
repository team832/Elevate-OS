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
export { runFollowUpReminders } from './follow-ups';
export { runTaskEscalations, runTaskReminders } from './escalations';
export { APPROVAL_SOURCES, listApprovalInbox, type ApprovalSource } from './approvals';
export { updateStaff } from './organisation';
export {
  changeEmploymentStatus,
  insertEmployee,
  registerDeactivationHandler,
} from './hr/employee-core';
export { runMissingClockOutCheck } from './hr/attendance';
export { runLifecycleReminders } from './hr/onboarding';
export { publishSeparation, runSeparations } from './hr/offboarding';
export { buildOperationsReport } from './reports/operations';
export {
  activeEmployeesMetric,
  employeesByDepartmentMetric,
  upcomingJoiningDates,
} from './reports/hr-records-metrics';
export { hrLifecycleMetrics } from './reports/hr-lifecycle-metrics';
export { hrTimeMetrics } from './reports/hr-time-metrics';
export { buildDashboard } from './dashboard';
export { fetchCrossModuleSummaries } from './summaries';
export { getCrmAdapter, MockCrmAdapter, type CrmAdapter } from './adapters/crm';
export { getAttendanceProvider, MockAttendanceProvider } from './adapters/attendance-provider';
