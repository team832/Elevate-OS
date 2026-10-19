/**
 * Business Ops OS server layer — services (transactions, permission checks, audit),
 * repositories and adapters. Exported as `@elevate/business-ops-os/server` for the platform
 * app and wave-3 integration tests. Other MODULES must never import it (D-011.3).
 */
export { MODULE_PATHS } from './paths';
export { authOptions } from './auth';
export { ENROLMENT_REPLIES_CONSUMER, processEnrolmentReplies, requestEnrolment } from './enrolment';
export { runFollowUpReminders } from './follow-ups';
export { runTaskEscalations } from './escalations';
export { buildDashboard } from './dashboard';
export { fetchCrossModuleSummaries } from './summaries';
export { getCrmAdapter, MockCrmAdapter, type CrmAdapter } from './adapters/crm';
