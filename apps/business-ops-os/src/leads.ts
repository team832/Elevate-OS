/**
 * `@elevate/business-ops-os/leads` (D-073): leads, lead sources, follow-ups and Marketing lead
 * handoffs, for Marketing OS to show in its own shell (same pattern as `./work`). What a lead
 * shows depends on the caller's permissions, decided on the server: contacts need
 * ops:student_private:read, admission cases beyond their stage and their history need
 * ops:admissions:read. Events and webinars are not exported (no permission Marketing holds
 * covers them yet).
 */
import * as followUp from './app/api/v1/follow-ups/[id]/route';
import * as followUps from './app/api/v1/follow-ups/route';
import * as leadSources from './app/api/v1/lead-sources/route';
import * as lead from './app/api/v1/leads/[id]/route';
import * as leadAccept from './app/api/v1/leads/[id]/accept/route';
import * as leadActivities from './app/api/v1/leads/[id]/activities/route';
import * as leadAssign from './app/api/v1/leads/[id]/assign/route';
import * as leadEnquiries from './app/api/v1/leads/[id]/enquiries/route';
import * as leadHistory from './app/api/v1/leads/[id]/history/route';
import * as leadMerge from './app/api/v1/leads/[id]/merge/route';
import * as leadCheckDuplicates from './app/api/v1/leads/check-duplicates/route';
import * as leadDuplicate from './app/api/v1/leads/duplicates/[id]/route';
import * as leadDuplicates from './app/api/v1/leads/duplicates/route';
import * as leadHandoffRetry from './app/api/v1/leads/handoffs/[id]/retry/route';
import * as leadHandoffs from './app/api/v1/leads/handoffs/route';
import * as leads from './app/api/v1/leads/route';
import type { NavRow } from './work';

export { FollowUpsBody } from './app/leads/follow-ups-body';
export { LeadBody, LeadsBody, type LeadsBodyProps } from './app/leads/leads-body';
export { followUpDaySummary } from './server/follow-ups';

/** Route handlers by path under `<base>/api/v1/`. */
export const leadsRoutes = {
  leads,
  'leads/[id]': lead,
  'leads/[id]/accept': leadAccept,
  'leads/[id]/activities': leadActivities,
  'leads/[id]/assign': leadAssign,
  'leads/[id]/enquiries': leadEnquiries,
  'leads/[id]/history': leadHistory,
  'leads/[id]/merge': leadMerge,
  'leads/check-duplicates': leadCheckDuplicates,
  'leads/duplicates': leadDuplicates,
  'leads/duplicates/[id]': leadDuplicate,
  'leads/handoffs': leadHandoffs,
  'leads/handoffs/[id]/retry': leadHandoffRetry,
  'lead-sources': leadSources,
  'follow-ups': followUps,
  'follow-ups/[id]': followUp,
};

export const leadsNav = (base: string): NavRow[] => [
  { key: 'leads', label: 'Leads', href: `${base}/leads`, permission: 'ops:leads:read' },
  {
    key: 'follow-ups',
    label: 'Follow-ups',
    href: `${base}/follow-ups`,
    permission: 'ops:leads:read',
  },
];
