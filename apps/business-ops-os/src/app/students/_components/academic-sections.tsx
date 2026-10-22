/**
 * Results, attendance and teachers from Academic OS (owner brief §10): raw score / max always
 * visible beside the percentage, absent never a score, comparisons only inside one assessment
 * and its cohort, trends need two scored results, "Source unavailable (checked <time>)" when
 * Academic cannot be read. Used by the profile (live; `show` picks the Attendance or Assessments
 * tab) and the report (frozen snapshot, everything).
 */
import { attendanceRateText } from '../../../domain/student-report';
import { academicEvidence, type AcademicEvidence } from '../../../server/academic-summary';
import { Unavailable } from '../../../ui/cross-module';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';

/** `attendance` = attendance + teachers; `assessments` = marks + trends. */
type Show = { level?: 2 | 3; show?: 'all' | 'attendance' | 'assessments' };

export async function AcademicSections({
  d,
  ...show
}: { d: { academic: { studentId: string | null } } } & Show) {
  const r = await load((db) => academicEvidence(db, d.academic.studentId));
  return r.ok ? <AcademicEvidenceView evidence={r.data} {...show} /> : r.view;
}

export function AcademicEvidenceView({
  evidence: e,
  level = 2,
  show = 'all',
}: { evidence: AcademicEvidence } & Show) {
  if (e.status !== 'available')
    return (
      <Segment level={level} title="Results and attendance" description="From Academic OS.">
        {e.status === 'unavailable' ? (
          <Unavailable name="Academic OS" result={{ reason: e.reason, fetchedAt: e.checkedAt }} />
        ) : (
          <p>Not enrolled in Academic OS yet, so there are no results or attendance to show.</p>
        )}
      </Segment>
    );
  const a = e.attendance;
  const period = `${fmtDate(e.window.from)} to ${fmtDate(e.window.to)}`;
  return (
    <>
      {show !== 'attendance' ? (
        <Segment
          level={level}
          flush
          title="Results"
          description={`From Academic OS for ${period}, checked ${fmtDateTime(e.checkedAt)}. Final results only.`}
        >
          <RecordTable
            rows={e.results}
            rowKey={(x) => x.assessmentId}
            empty="No results recorded in this period."
            columns={[
              { key: 'date', header: 'Date', render: (x) => fmtDate(x.heldOn) },
              {
                key: 'test',
                header: 'Assessment',
                render: (x) =>
                  `${x.code} (${humanise(x.examType)})${x.rescored ? `, re-scored v${x.resultVersion}` : ''}`,
              },
              { key: 'subject', header: 'Subject', render: (x) => x.subject ?? 'Not recorded' },
              {
                key: 'score',
                header: 'Score',
                numeric: true,
                render: (x) =>
                  x.score === null ? 'Absent' : `${x.score} / ${x.maxScore} (${x.percent}%)`,
              },
              { key: 'cohort', header: 'Compared with', render: (x) => x.comparison },
            ]}
          />
          {e.trends.length ? (
            <DetailTable
              caption="Trend by subject and exam type (scored results only, as percentages)"
              rows={e.trends.map((t) => ({ label: humanise(t.label), value: t.text }))}
            />
          ) : null}
        </Segment>
      ) : null}
      {show !== 'assessments' ? (
        <>
          <Segment level={level} flush title="Attendance" description={`Held classes, ${period}.`}>
            <DetailTable
              rows={[
                { label: 'Attendance rate', value: attendanceRateText(a) },
                { label: 'Attended', value: `${a.attended} of ${a.recorded} recorded` },
                {
                  label: 'Recorded',
                  value: `${a.present} present, ${a.late} late, ${a.partial} partial, ${a.absent} absent, ${a.excused} excused`,
                },
                { label: 'Held, not recorded', value: String(a.notRecorded) },
              ]}
            />
          </Segment>
          <Segment
            level={level}
            flush
            title="Teachers"
            description="Who taught the classes held in the period (substitutes included)."
          >
            <RecordTable
              rows={e.enrolments.flatMap((en) =>
                en.teachers.map((t) => ({
                  ...t,
                  key: `${en.enrolmentId}-${t.name}-${t.subject}`,
                  en,
                })),
              )}
              rowKey={(t) => t.key}
              empty="No classes held in this period."
              columns={[
                { key: 'subject', header: 'Subject', render: (t) => t.subject },
                { key: 'name', header: 'Teacher', render: (t) => t.name },
                {
                  key: 'batch',
                  header: 'Programme / batch',
                  render: (t) => `${t.en.programmeCode} · ${t.en.batchName ?? 'No batch'}`,
                },
              ]}
            />
          </Segment>
        </>
      ) : null}
    </>
  );
}
