/**
 * Facts a work report reads from other sources, kept as received: Academic teaching activity,
 * HR attendance and the Marketing monthly snapshot. Missing stays missing (null), never 0. Pure.
 */
import type {
  AcademicTeacherActivityV1,
  MarketingMonthlySnapshotV1,
  SourceResult,
} from '@elevate/shared-contracts';
import type { AttendanceSummary } from './attendance';

type Metric = number | null;
export type AcademicFacts =
  | { status: 'unavailable'; reason: string; checkedAt: string }
  | {
      status: 'available';
      checkedAt: string;
      planned: Metric;
      delivered: Metric;
      cancelled: Metric;
      substituted: Metric;
      logsPending: Metric;
      markingPending: Metric;
      reviewsSubmitted: Metric;
      /** Optional in the contract (23 Oct 2026): absent = Academic did not report it. */
      topicsCovered?: AcademicTeacherActivityV1['topicsCovered'];
      assessmentsPrepared?: Metric;
      assessmentsMarked?: Metric;
    };

/** HR attendance for the period (domain/attendance.ts); never derived from tasks or classes. */
export type AttendanceFacts =
  { status: 'unavailable'; reason: string } | ({ status: 'available' } & AttendanceSummary);
/** Marketing facts of a monthly report (Marketing OS internal route); missing when unreadable. */
export type MarketingFacts =
  | { status: 'missing'; reason: string; checkedAt: string }
  | { status: 'available'; checkedAt: string; snapshot: MarketingMonthlySnapshotV1 };
export const marketingFacts = (r: SourceResult<MarketingMonthlySnapshotV1>): MarketingFacts =>
  r.status === 'available'
    ? { status: 'available', checkedAt: r.fetchedAt, snapshot: r.data }
    : { status: 'missing', reason: r.reason, checkedAt: r.fetchedAt };
const metric = (m: { status: string; value: number | null }): Metric =>
  m.status === 'missing' ? null : m.value;

export function academicFacts(r: SourceResult<AcademicTeacherActivityV1>): AcademicFacts {
  if (r.status === 'unavailable')
    return { status: 'unavailable', reason: r.reason, checkedAt: r.fetchedAt };
  const d = r.data;
  return {
    status: 'available',
    checkedAt: r.fetchedAt,
    planned: metric(d.sessions.planned),
    delivered: metric(d.sessions.delivered),
    cancelled: metric(d.sessions.cancelled),
    substituted: metric(d.sessions.substituted),
    logsPending: metric(d.logsPending),
    markingPending: metric(d.markingPending),
    reviewsSubmitted: metric(d.reviews.submitted),
    ...(d.topicsCovered ? { topicsCovered: d.topicsCovered } : {}),
    ...(d.assessments
      ? {
          assessmentsPrepared: metric(d.assessments.prepared),
          assessmentsMarked: metric(d.assessments.marked),
        }
      : {}),
  };
}
