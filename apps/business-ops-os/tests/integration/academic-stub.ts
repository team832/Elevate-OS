/**
 * Academic OS simulated for Ops tests: `stubAcademic` answers each internal route Ops calls with a
 * contract payload ('down' or a missing route = unreachable). Fictional data only.
 */
import { vi } from 'vitest';
import type { AcademicStudentReviewsV1 } from '@elevate/shared-contracts';

type Review = AcademicStudentReviewsV1['reviews'][number];
type Route = 'reviews' | 'summary' | 'demo-attendance' | 'activity';
const ROUTES: [Route, RegExp][] = [
  ['reviews', /\/internal\/v1\/reviews\?/],
  ['demo-attendance', /\/internal\/v1\/demo-attendance\?/],
  ['activity', /\/internal\/v1\/teachers\/[^/]+\/activity\?/],
  ['summary', /\/internal\/v1\/students\/[^/]+\/summary/],
];

/** Every fetch goes to the matching handler; returns the mock so tests can read the URLs called. */
export function stubAcademic(handlers: Partial<Record<Route, unknown | ((url: URL) => unknown)>>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const route = ROUTES.find(([, re]) => re.test(url.href))?.[0];
    const h = route ? handlers[route] : undefined;
    if (h === undefined || h === 'down') throw new TypeError('fetch failed');
    return Response.json({ data: typeof h === 'function' ? h(url) : h });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const review = (over: Partial<Review> & Pick<Review, 'authorStaffId'>): Review => ({
  reviewKey: crypto.randomUUID(),
  version: 1,
  coreStudentId: null,
  academicStudentId: null,
  studentName: 'Sample Student',
  status: 'submitted',
  superseded: false,
  authorName: 'Sample Teacher',
  subjectName: 'Quant',
  reviewType: 'periodic_progress',
  sessionDate: null,
  opsDemoSessionId: null,
  periodFrom: '2026-09-01' as never,
  periodTo: '2026-09-15' as never,
  strengths: null,
  areasForSupport: null,
  attendanceEvidence: null,
  homeworkEvidence: null,
  academicConcerns: null,
  suggestedAction: null,
  followUpOn: null,
  visibility: 'internal',
  submittedAt: '2026-09-16T05:00:00.000Z' as never,
  withdrawnAt: null,
  sourcePath: '/academic/reviews/sample',
  ...over,
});

/** The contract payload for a list of reviews (queried by author when `coreStudentId` is null). */
export const reviewsPayload = (
  reviews: Review[],
  coreStudentId: string | null = null,
): AcademicStudentReviewsV1 => ({
  contract: 'academic.student_reviews',
  version: 1,
  generatedAt: '2026-10-21T05:00:00.000Z' as never,
  student: coreStudentId
    ? { coreStudentId: coreStudentId as never, academicStudentId: null }
    : null,
  reviews,
});
