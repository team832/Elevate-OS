/**
 * Feedback and development (brief 23 Oct 2026 §15): a teacher's approved feedback summaries and
 * agreed follow-ups, shown in Academic OS at /academic/my-feedback (D-073 body) and as HR's
 * "what the teacher will see" preview. Built only from `teacherFacing` summaries: no raw rows,
 * no student names, no figures or comments below the minimum group size.
 */
import { PageHeader, StatusBadge } from '@elevate/shared-ui';
import type { TeacherFacingSummary } from '../domain/feedback';
import { meanLabel } from '../domain/feedback';
import type { BodyProps } from '../app/tasks/_components/bodies';
import { myFeedback } from '../server/feedback-teacher';
import { fmtDate } from './format';
import { load, Section } from './frame';
import { RecordTable } from './record-table';
import { DetailTable, Segment } from './sections';
import '../app/ops.css';

type Category = { code: string; label: string };
type Mine = Awaited<ReturnType<typeof myFeedback>>;

export const ACTION_STATUS = { open: 'Open', done: 'Done', dropped: 'Dropped' } as const;
const period = (s: { periodStart: string; periodEnd: string }) =>
  `${fmtDate(s.periodStart)} to ${fmtDate(s.periodEnd)}`;
const mean = (v: number, max: number) => `${v.toFixed(1)} of ${max}`;

/** One summary as the teacher sees it. */
export function SummaryView({
  s,
  categories,
  level = 2,
}: {
  s: TeacherFacingSummary;
  categories: readonly Category[];
  level?: 2 | 3;
}) {
  const responses =
    s.responseCount === null
      ? null
      : s.eligiblePopulation
        ? `${s.responseCount} of ${s.eligiblePopulation} students (${Math.round((s.responseCount / s.eligiblePopulation) * 100)}%)`
        : `${s.responseCount} (number of students asked: not recorded)`;
  return (
    <Segment
      title={`Feedback for ${period(s)}`}
      level={level}
      flush={s.enough}
      description={
        s.approvedAt
          ? `Approved by HR on ${fmtDate(s.approvedAt.toISOString().slice(0, 10))}.`
          : undefined
      }
    >
      {!s.enough ? (
        <p>
          Not enough responses to show. Fewer than {s.minGroupSize} students answered for this
          period, so figures and comments are held back.
        </p>
      ) : (
        <DetailTable
          caption={`Feedback for ${period(s)}`}
          rows={[
            { label: 'Responses', value: responses },
            { label: 'Rating scale', value: `1 to ${s.ratingScaleMax}` },
            typeof s.categoryMeans?.overall === 'number' && {
              label: meanLabel(null, categories),
              value: mean(s.categoryMeans.overall, s.ratingScaleMax),
            },
            ...Object.entries(s.categoryMeans?.categories ?? {}).map(([k, v]) => ({
              label: meanLabel(k, categories),
              value: mean(v, s.ratingScaleMax),
            })),
            { label: 'Strengths', value: s.strengths ?? 'Not written' },
            { label: 'Areas to improve', value: s.areasToImprove ?? 'Not written' },
            s.summaryText && { label: 'What students said (edited by HR)', value: s.summaryText },
          ]}
        />
      )}
    </Segment>
  );
}

/** Agreed development actions. */
export function ActionsTable({ rows }: { rows: Mine['actions'] }) {
  return (
    <RecordTable
      rows={rows}
      rowKey={(a) => a.id}
      caption="Development actions"
      empty="No development actions recorded."
      columns={[
        { key: 'action', header: 'Action' },
        { key: 'due', header: 'Due', render: (a) => (a.dueOn ? fmtDate(a.dueOn) : 'No date') },
        { key: 'owner', header: 'With', render: (a) => a.ownerName ?? 'Not named' },
        {
          key: 'status',
          header: 'Status',
          render: (a) => (
            <StatusBadge tone={a.status === 'done' ? 'success' : 'neutral'}>
              {ACTION_STATUS[a.status]}
            </StatusBadge>
          ),
        },
        {
          key: 'agreed',
          header: 'Agreed',
          render: (a) => (a.agreedAt ? fmtDate(a.agreedAt.toISOString().slice(0, 10)) : 'Not yet'),
        },
      ]}
    />
  );
}

export function FeedbackDevelopmentBody(props: BodyProps) {
  return (
    <Section label="Loading your feedback…">
      <Body {...props} />
    </Section>
  );
}

async function Body({ user }: BodyProps) {
  const result = await load((db) => myFeedback(db, user));
  if (!result.ok) return result.view;
  const d = result.data;
  return (
    <>
      <PageHeader
        title="Feedback and development"
        description="What students said about your classes, summarised and approved by HR, and the follow-ups agreed with you."
      />
      <details className="el-explain">
        <summary>Where this comes from</summary>
        <p>
          HR collects feedback from students on forms, on paper, in interviews or in files, reads
          every response and writes these summaries. You see the summary, not individual responses
          or who gave them. When fewer than {d.minGroupSize} students answered for a period, figures
          and comments are held back.
        </p>
      </details>
      {d.visibility === 'nothing' ? (
        <p>Feedback summaries are not shared with teachers at present.</p>
      ) : (
        <>
          {d.summaries.length ? (
            d.summaries.map((s) => <SummaryView key={s.id} s={s} categories={d.categories} />)
          ) : (
            <p>No approved feedback summary yet. One appears here once HR approves it.</p>
          )}
          <Segment title="Development actions" flush>
            <ActionsTable rows={d.actions} />
          </Segment>
        </>
      )}
    </>
  );
}
