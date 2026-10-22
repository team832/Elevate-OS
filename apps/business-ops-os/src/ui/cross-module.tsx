/**
 * Academic delivery and Marketing panels (D-011.2) for the Overview and the Academic/Marketing
 * summary pages. A source that could not be fetched shows "Source unavailable (checked …)" with
 * the reason; metrics render through StatTile, so `missing` shows as "Missing", never as 0.
 */
import type {
  AcademicDeliverySummaryV1,
  MarketingSummaryV1,
  Metric,
  SourceResult,
} from '@elevate/shared-contracts';
import type { ReactNode } from 'react';
import { Alert, Card, StatTile } from '@elevate/shared-ui';
import { fmtDateTime } from './format';

/** Tiles shown; `studentsAtRisk` has no source yet (ACD-022), so it gets no tile rather than "Missing". */
export const ACADEMIC_LABELS = {
  activeStudents: 'Active enrolments (now)',
  activeBatches: 'Active batches (now)',
  classesPlanned: 'Classes planned',
  classesDelivered: 'Classes delivered',
  classesCancelled: 'Classes cancelled',
  attendanceRate: 'Attendance rate',
  assessmentsPlanned: 'Assessments planned',
  assessmentsConducted: 'Assessments conducted',
  syllabusCompletionRate: 'Syllabus completion',
} satisfies Partial<Record<keyof AcademicDeliverySummaryV1['metrics'], string>>;

/** Engagement, follower growth and attributed leads are measured by no source, so they get no tile. */
export const MARKETING_LABELS = {
  ideasCaptured: 'Ideas captured',
  contentApproved: 'Content approved',
  postsScheduled: 'Posts scheduled',
  postsPublished: 'Posts published',
  totalReach: 'Total reach',
} satisfies Partial<Record<keyof MarketingSummaryV1['metrics'], string>>;

/** "Source unavailable (checked <time>)" with the reason; no numbers rather than zeros. */
export function Unavailable({
  name,
  result,
}: {
  name: string;
  result: { reason: string; fetchedAt: string };
}) {
  return (
    <Alert tone="warning" title="Source unavailable">
      {name} could not be read ({result.reason}); checked {fmtDateTime(result.fetchedAt)}. No
      numbers are shown rather than zeros.
    </Alert>
  );
}

function Tiles<K extends string>({
  metrics,
  labels,
}: {
  metrics: Record<NoInfer<K>, Metric>;
  labels: Record<K, string>;
}) {
  return (
    <div className="el-grid">
      {(Object.entries(labels) as [K, string][]).map(([k, label]) => (
        <StatTile key={k} label={label} metric={metrics[k]} />
      ))}
    </div>
  );
}

/** One source's card: its tiles and freshness, or "source unavailable". */
function SourcePanel<T extends { generatedAt: string }>({
  title,
  source,
  result,
  children,
}: {
  title: string;
  source: string;
  result: SourceResult<T>;
  children: (data: T) => ReactNode;
}) {
  return (
    <Card
      title={title}
      description={`From ${source}${result.status === 'available' ? `, as of ${fmtDateTime(result.data.generatedAt)}` : ''}.`}
    >
      {result.status === 'available' ? (
        children(result.data)
      ) : (
        <Unavailable name={source} result={result} />
      )}
    </Card>
  );
}

export const AcademicPanel = ({ result }: { result: SourceResult<AcademicDeliverySummaryV1> }) => (
  <SourcePanel
    title="Academic delivery"
    source="Academic OS (academic.delivery_summary v1)"
    result={result}
  >
    {(d) => <Tiles metrics={d.metrics} labels={ACADEMIC_LABELS} />}
  </SourcePanel>
);

export const MarketingPanel = ({ result }: { result: SourceResult<MarketingSummaryV1> }) => (
  <SourcePanel title="Marketing" source="Marketing OS (marketing.summary v1)" result={result}>
    {(d) => (
      <>
        <Tiles metrics={d.metrics} labels={MARKETING_LABELS} />
        <p className="el-field-hint">
          Data sources:{' '}
          {d.dataSources.map((s) => `${s.name} (${s.connection})`).join(', ') || 'none listed'}
        </p>
      </>
    )}
  </SourcePanel>
);

export function CrossModulePanels({
  summaries,
}: {
  summaries: {
    academic: SourceResult<AcademicDeliverySummaryV1>;
    marketing: SourceResult<MarketingSummaryV1>;
  };
}) {
  return (
    <>
      <AcademicPanel result={summaries.academic} />
      <MarketingPanel result={summaries.marketing} />
    </>
  );
}
