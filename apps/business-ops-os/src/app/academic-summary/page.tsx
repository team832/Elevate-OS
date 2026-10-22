import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { Metric } from '@elevate/shared-contracts';
import { formatMetricValue, PageHeader } from '@elevate/shared-ui';
import { rangeOf, reviewsInRange } from '../../server/overview';
import { fetchAcademicSummary } from '../../server/summaries';
import { HR_UNAVAILABLE } from '../../server/teacher-ops';
import { AcademicPanel, Unavailable } from '../../ui/cross-module';
import { fmtDateTime } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { RangeFilter } from '../_components/range-filter';
import { WorkspaceLink } from '../_components/workspace-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Academic summary' };

type Params = { from?: string; to?: string };
const BASE = '/ops/academic-summary';
const shown = (m: Metric) => (m.status === 'missing' ? 'Missing' : formatMetricValue(m));

/**
 * /ops/academic-summary — what Business Ops may see of Academic OS (owner brief 22 Oct 2026 §5,
 * §9) through its summary contracts: delivery per programme and teacher reviews published in the
 * period. Read only; Academic OS is the source. The link into Academic shows only to its members.
 */
export default async function AcademicSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('ops:dashboard:read', BASE);
  const at = rangeOf(await searchParams);
  return (
    <Frame access={access} active="academic-summary">
      <PageHeader
        title="Academic summary"
        description="Class delivery, attendance, syllabus progress and teacher reviews from Academic OS for the period. Read only: corrections are made in Academic OS."
        actions={
          <WorkspaceLink user={access.user} workspace="academic">
            Open Academic OS
          </WorkspaceLink>
        }
      />
      <div className="el-stack">
        <RangeFilter base={BASE} at={at} />
        <Section label="Loading from Academic OS…">
          <Summary user={access.user} range={at.range} />
        </Section>
      </div>
    </Frame>
  );
}

async function Summary({
  user,
  range,
}: {
  user: AuthenticatedUser;
  range: ReturnType<typeof rangeOf>['range'];
}) {
  const reviewsAllowed = can(user, 'ops:feedback:read') && can(user, 'ops:teachers:read');
  const r = await load((db) =>
    Promise.all([
      fetchAcademicSummary(range),
      reviewsAllowed ? reviewsInRange(db, user, range) : null,
    ]),
  );
  if (!r.ok) return r.view;
  const [academic, reviews] = r.data;
  return (
    <>
      <AcademicPanel result={academic} />
      {academic.status === 'available' ? (
        <Segment
          title="By programme"
          description="The same figures per programme. Planned classes are never counted as delivered."
          flush
        >
          <RecordTable
            rows={academic.data.programmes}
            rowKey={(p) => p.programmeCode}
            empty="Academic OS reported no programme figures for this period."
            columns={[
              { key: 'programmeCode', header: 'Programme' },
              ...(
                [
                  ['classesPlanned', 'Planned'],
                  ['classesDelivered', 'Delivered'],
                  ['classesCancelled', 'Cancelled'],
                  ['attendanceRate', 'Attendance'],
                  ['syllabusCompletionRate', 'Syllabus'],
                ] as const
              ).map(([key, header]) => ({
                key,
                header,
                numeric: true,
                render: (p: (typeof academic.data.programmes)[number]) => shown(p.metrics[key]),
              })),
            ]}
          />
        </Segment>
      ) : null}
      <Segment title="Teacher attendance">
        <p className="el-field-hint">
          {HR_UNAVAILABLE}. Missing teaching logs are not treated as absence.
        </p>
      </Segment>
      <Segment
        id="reviews"
        title="Teacher reviews published"
        description="Reviews of students whose latest version was submitted in the period, by teacher. Withdrawn reviews are hidden. Open a teacher to read them."
        flush
      >
        {!reviews ? (
          <p className="el-field-hint">Reading teacher reviews needs review and teacher access.</p>
        ) : reviews.status === 'unavailable' ? (
          <Unavailable
            name="Academic OS reviews"
            result={{ reason: reviews.reason, fetchedAt: reviews.checkedAt }}
          />
        ) : (
          <RecordTable
            caption={`${reviews.total} review(s) · checked ${fmtDateTime(reviews.checkedAt)}`}
            rows={reviews.rows}
            rowKey={(t) => t.staffId}
            rowHref={(t) => `/ops/teachers/${t.staffId}`}
            linkColumn="name"
            empty="No teacher you may see is on the directory."
            columns={[
              { key: 'name', header: 'Teacher' },
              { key: 'count', header: 'Reviews in the period', numeric: true },
            ]}
          />
        )}
      </Segment>
    </>
  );
}
