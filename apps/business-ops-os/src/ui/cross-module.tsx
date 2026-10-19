/**
 * Academic delivery and Marketing panels on the Ops dashboard (D-011.2).
 * A source that could not be fetched shows "Source unavailable" with the
 * reason; individual metrics render through StatTile, so `missing` shows as
 * "Missing" and never as 0.
 */
import type {
  AcademicDeliverySummaryV1,
  MarketingSummaryV1,
  Metric,
  SourceResult,
} from '@elevate/shared-contracts';
import { Alert, Card, StatTile } from '@elevate/shared-ui';

const ACADEMIC_LABELS: Record<keyof AcademicDeliverySummaryV1['metrics'], string> = {
  activeStudents: 'Active students',
  activeBatches: 'Active batches',
  classesPlanned: 'Classes planned',
  classesDelivered: 'Classes delivered',
  classesCancelled: 'Classes cancelled',
  attendanceRate: 'Attendance rate',
  assessmentsPlanned: 'Assessments planned',
  assessmentsConducted: 'Assessments conducted',
  studentsAtRisk: 'Students at risk',
  syllabusCompletionRate: 'Syllabus completion',
};

const MARKETING_LABELS: Record<keyof MarketingSummaryV1['metrics'], string> = {
  ideasCaptured: 'Ideas captured',
  contentApproved: 'Content approved',
  postsScheduled: 'Posts scheduled',
  postsPublished: 'Posts published',
  totalReach: 'Total reach',
  engagementRate: 'Engagement rate',
  followerGrowth: 'Follower growth',
  leadsAttributed: 'Leads attributed',
};

function Unavailable({
  name,
  reason,
  fetchedAt,
}: {
  name: string;
  reason: string;
  fetchedAt: string;
}) {
  return (
    <Alert tone="warning" title="Source unavailable">
      {name} could not be read ({reason}) at {fetchedAt}. No numbers are shown rather than zeros.
    </Alert>
  );
}

function Tiles<K extends string>({
  metrics,
  labels,
}: {
  metrics: Record<K, Metric>;
  labels: Record<K, string>;
}) {
  return (
    <div className="el-grid">
      {(Object.keys(labels) as K[]).map((k) => (
        <StatTile key={k} label={labels[k]} metric={metrics[k]} />
      ))}
    </div>
  );
}

export function CrossModulePanels({
  summaries,
}: {
  summaries: {
    academic: SourceResult<AcademicDeliverySummaryV1>;
    marketing: SourceResult<MarketingSummaryV1>;
  };
}) {
  const { academic, marketing } = summaries;
  return (
    <>
      <Card
        title="Academic delivery"
        description="From Academic OS (academic.delivery_summary v1)."
      >
        {academic.status === 'available' ? (
          <Tiles metrics={academic.data.metrics} labels={ACADEMIC_LABELS} />
        ) : (
          <Unavailable
            name="Academic OS summary"
            reason={academic.reason}
            fetchedAt={academic.fetchedAt}
          />
        )}
      </Card>
      <Card title="Marketing" description="From Marketing OS (marketing.summary v1).">
        {marketing.status === 'available' ? (
          <>
            <Tiles metrics={marketing.data.metrics} labels={MARKETING_LABELS} />
            <p className="el-field-hint">
              Data sources:{' '}
              {marketing.data.dataSources.map((s) => `${s.name} (${s.connection})`).join(', ') ||
                'none listed'}
            </p>
          </>
        ) : (
          <Unavailable
            name="Marketing OS summary"
            reason={marketing.reason}
            fetchedAt={marketing.fetchedAt}
          />
        )}
      </Card>
    </>
  );
}
