import type { EodReportView } from '../../../server/eod-reports';
import { REVIEW_LABELS } from '../../../server/eod-review';
import { fmtDateTime } from '../../../ui/format';
import { Segment, Timeline } from '../../../ui/sections';

/** An EOD's facts are a day-period work report's facts (REP). */
export { WorkReportFacts as EodFactsView } from '../reports/_components/report-facts';

/** Submitted versions and the manager's responses, newest first. */
export function EodHistory({
  r,
  base,
  level = 2,
}: {
  r: EodReportView;
  base: string;
  level?: 2 | 3;
}) {
  const items = [
    ...r.versions.map((v) => ({
      key: v.id,
      at: v.submittedAt,
      when: fmtDateTime(v.submittedAt),
      title: `Version ${v.version} submitted${v.recipientName ? ` to ${v.recipientName}` : ''}`,
      detail: v.revisionOfVersionId ? `Revision of version ${v.version - 1}` : undefined,
    })),
    ...r.trail.map((t) => ({
      key: t.id,
      at: t.createdAt,
      when: fmtDateTime(t.createdAt),
      title: `${REVIEW_LABELS[t.kind]}${t.actorName ? ` by ${t.actorName}` : ''}`,
      detail:
        t.text ??
        (t.taskId ? <a href={`${base}/tasks/${t.taskId}`}>Open the follow-up task</a> : undefined),
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <Segment title="Versions and responses" level={level}>
      {items.length ? (
        <Timeline label="Versions and responses" items={items} />
      ) : (
        <p>Not submitted yet.</p>
      )}
    </Segment>
  );
}
