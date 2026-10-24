import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, ButtonLink, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { addDays, istToday } from '../../../../domain';
import { DOCUMENT_STATE_LABELS } from '../../../../domain/admission-form';
import { formatPaise } from '../../../../domain/fees';
import {
  REPORT_HEADINGS,
  REPORT_KIND_LABELS,
  REPORT_SECTIONS,
  reportKinds,
} from '../../../../domain/student-report';
import { aiBlocked } from '../../../../server/ai-drafts';
import { loadSettings } from '../../../../server/settings';
import { getStudentReport, reportsOf } from '../../../../server/student-report';
import { getStudent } from '../../../../server/students';
import { ActionForm, type FieldSpec } from '../../../../ui/action-form';
import { AiDraft } from '../../../../ui/ai-draft';
import { fmtDate, fmtDateTime, humanise } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../ui/sections';
import { AcademicEvidenceView } from '../../_components/academic-sections';
import { PrintButton } from '../../_components/print-button';
import { ReportList, REPORT_STATUS_TONES } from '../../_components/report-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student report' };

/** Print: only the report body, black on white, every table ruled; tokens stay untouched. */
const PRINT_CSS = `@media print {
  .el-sidebar, .el-topbar, .el-skip-link, .ops-no-print, details { display: none !important; }
  .el-shell-body, .el-main { margin: 0 !important; padding: 0 !important; }
  body, .el-main, .el-main * { background: #fff !important; color: #000 !important; box-shadow: none !important; border-color: #777 !important; }
  .el-card, .el-table-wrap, .ops-detail, .el-badge { border: 1px solid #777 !important; }
  .el-table th, .el-table td, .ops-detail th, .ops-detail td { border: 1px solid #777 !important; }
  .el-card, tr { break-inside: avoid; }
  a { text-decoration: none !important; }
}`;

const SECTION_LABELS: Record<(typeof REPORT_SECTIONS)[number], string> = {
  overview: 'Overview (internal report: with status history)',
  kyc: 'KYC and student details (internal report; needs private-data access)',
  programmes: 'Programmes and batches (administration dossier)',
  results: 'Marks as bars, with trends',
  attendance: 'Attendance',
  feedback: 'Teacher reviews (PTM report: shareable notes only)',
  fees: 'Fee totals (PTM report: only when ticked)',
  guardians: 'Guardians (administration dossier)',
  summary: 'Summary (PTM: affirmative wording; internal: neutral)',
};

export default async function StudentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ export?: string }>;
}) {
  const { id } = await params;
  const { export: exportKey } = await searchParams;
  const access = await gate('ops:student_reports:generate', `/ops/students/${id}/report`);
  return (
    <Frame access={access} active="students">
      <Section label="Loading report…">
        {exportKey ? (
          <Report user={access.user} id={id} exportKey={exportKey} />
        ) : (
          <Generate user={access.user} id={id} />
        )}
      </Section>
      <style>{PRINT_CSS}</style>
    </Frame>
  );
}

/** Kind, period and sections; generating stores a draft snapshot and an audit row. */
async function Generate({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => {
    const student = await getStudent(db, user, id);
    return {
      student,
      audiences: (await loadSettings(db))['reports.audiences'],
      reports: student.identity ? await reportsOf(db, student.identity.id) : [],
      ai: await aiBlocked(db, user, 'reportDraft'),
    };
  });
  if (!r.ok) return r.view;
  const today = istToday(new Date());
  const kinds = reportKinds(r.data.audiences.value.enabled);
  const fields: FieldSpec[] = [
    {
      name: 'audience',
      label: 'Kind of report',
      type: 'select',
      required: true,
      defaultValue: kinds[0],
      options: kinds.map((a) => ({ value: a, label: REPORT_KIND_LABELS[a] })),
      hint: `PTM: as little as possible, in affirmative words, never KYC or guardians. Internal: KYC, student details, every score and review. Kinds offered come from the setting “${r.data.audiences.label}” (${humanise(r.data.audiences.decisionState)}).`,
      section: 'Kind',
    },
    {
      name: 'from',
      label: 'From',
      type: 'date',
      required: true,
      defaultValue: addDays(today, -365),
      section: 'Reporting period',
    },
    {
      name: 'to',
      label: 'To',
      type: 'date',
      required: true,
      defaultValue: today,
      section: 'Reporting period',
    },
    {
      name: 'acknowledgement',
      label: 'Add an acknowledgement space for signature',
      type: 'checkbox',
      section: 'Sections (only those the kind and your role allow are kept)',
    },
    ...REPORT_SECTIONS.map((s) => ({
      name: `sections.${s}`,
      label: SECTION_LABELS[s],
      type: 'checkbox' as const,
      defaultValue: s === 'fees' ? 'false' : 'true',
      section: 'Sections (only those the kind and your role allow are kept)',
    })),
    {
      name: 'comment',
      label: 'Overall comment (optional)',
      type: 'textarea',
      hint: 'Printed on the report as written and checked by the reviewer. An AI draft uses only the summary facts for this kind and period, without names; check and edit it before generating.',
      section: 'Comment',
    },
  ];
  return (
    <>
      <PageHeader
        title={`Student report: ${r.data.student.person.fullName}`}
        description="Build a draft from the records for a period; a second person reviews it before it is final."
        actions={<ButtonLink href={`/ops/students/${id}`}>Back to the student</ButtonLink>}
      />
      <div className="el-stack">
        <details className="el-explain">
          <summary>What goes into a report</summary>
          <p>
            A draft is built once from the records for the period and stored. A second person
            reviews it, then it is made final and never changes. The PTM report never contains KYC,
            guardians, internal remarks, history or payment details. Nothing is emailed.
          </p>
        </details>
        <Segment title="Make a report">
          <AiDraft
            api="/ops/api/v1/ai/student-report"
            body={{ studentId: id }}
            fields={['audience', 'from', 'to']}
            blocked={r.data.ai}
            buttonLabel="Draft the comment with AI"
          >
            <ActionForm
              action={`/ops/api/v1/students/${id}/report`}
              submitLabel="Generate report"
              redirectTo={`/students/${id}/report?export={id}`}
              fields={fields}
            />
          </AiDraft>
        </Segment>
        <Segment title="Generated reports" flush>
          <ReportList rows={r.data.reports} studentId={id} />
        </Segment>
      </div>
    </>
  );
}

async function Report({
  user,
  id,
  exportKey,
}: {
  user: AuthenticatedUser;
  id: string;
  exportKey: string;
}) {
  const r = await load((db) => getStudentReport(db, user, id, exportKey));
  if (!r.ok) return r.view;
  const { export: e, view: s, actions, blocked, notice } = r.data;
  const statusAction = (to: 'reviewed' | 'final', label: string) => (
    <ActionForm
      action={`/ops/api/v1/students/${id}/report/${e.referenceCode}/status`}
      submitLabel={label}
      extra={{ to }}
      variant={to === 'final' ? 'primary' : 'secondary'}
      compact
    />
  );
  return (
    <>
      <PageHeader
        title={s ? `Student report: ${s.student.name}` : 'Student report'}
        description={`Reference ${e.referenceCode} · ${REPORT_KIND_LABELS[e.audience]} · ${fmtDate(e.periodFrom)} to ${fmtDate(e.periodTo)}`}
        actions={
          <span className="ops-no-print el-inline-form">
            <a href={`/ops/students/${id}`}>Back to the student</a>
            {s && !blocked ? (
              <a href={`/ops/api/v1/students/${id}/report/${e.referenceCode}/pdf`}>Download PDF</a>
            ) : null}
            {blocked ? null : <PrintButton />}
          </span>
        }
      />
      <div className="el-stack">
        {notice ? (
          <Alert tone="warning" title="Source reviews changed">
            {notice}
          </Alert>
        ) : null}
        {s?.student.isSample ? (
          <Alert tone="info" title="Sample data">
            This report is about a fictional sample student.
          </Alert>
        ) : null}
        {e.status !== 'final' ? (
          <Alert
            tone="warning"
            title={e.status === 'draft' ? 'Draft — not reviewed' : 'Reviewed — not final'}
          >
            Do not share until it is final. The content below is the stored snapshot from{' '}
            {fmtDateTime(e.at)}; to include newer records, make a new report.
          </Alert>
        ) : null}
        <Segment
          title="About this report"
          flush
          actions={
            actions.review || actions.finalise ? (
              <span className="ops-no-print el-inline-form">
                {actions.review ? statusAction('reviewed', 'Mark as reviewed') : null}
                {actions.finalise ? statusAction('final', 'Make final') : null}
              </span>
            ) : undefined
          }
        >
          <DetailTable
            rows={[
              {
                label: 'Status',
                value: (
                  <StatusBadge tone={REPORT_STATUS_TONES[e.status]}>
                    {humanise(e.status)}
                  </StatusBadge>
                ),
              },
              { label: 'Created', value: fmtDateTime(e.at) },
              { label: 'Reviewed', value: e.reviewedAt ? fmtDateTime(e.reviewedAt) : 'Not yet' },
              { label: 'Final', value: e.finalisedAt ? fmtDateTime(e.finalisedAt) : 'Not yet' },
              { label: 'Template', value: e.templateVersion ?? 'Before report snapshots' },
              {
                label: 'Sections for your role',
                value: r.data.fields.map(humanise).join(', ') || 'None',
              },
              {
                label: 'Missing data',
                value: 'Shown as not recorded or unavailable, never as zero',
              },
            ]}
          />
        </Segment>
        {s ? (
          <Snapshot s={s} />
        ) : (
          <Alert tone="info" title="Made before report snapshots">
            This report was generated before report content was stored, so only its reference,
            period and sections are kept.
          </Alert>
        )}
      </div>
    </>
  );
}

function Snapshot({ s }: { s: NonNullable<Awaited<ReturnType<typeof getStudentReport>>['view']> }) {
  const has = (x: (typeof s.sections)[number]) => s.sections.includes(x);
  // progress-report/1 snapshots carry no tone: today's neutral wording.
  const h = REPORT_HEADINGS[s.template === 'progress-report/1' ? 'neutral' : s.tone];
  const bullets = (items: readonly string[]) => (
    <ul>
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
  const internalReview = s.feedback?.some((f) => 'academicConcerns' in f);
  return (
    <>
      <Segment title="Programmes and batches" flush>
        <DetailTable
          rows={[
            { label: 'Admission number', value: s.student.admissionNumber ?? 'Not assigned' },
            s.student.counsellor ? { label: 'Counsellor', value: s.student.counsellor } : null,
            ...(has('programmes') || has('overview') ? s.programmes : []).map((p) => ({
              label: p.programme,
              value: `${p.batch} · ${p.status}`,
            })),
          ]}
        />
      </Segment>
      {s.kyc ? (
        <Segment
          title="KYC and student details"
          description="Private — internal report only. Document references are never stored or printed."
          flush
        >
          <DetailTable
            rows={[
              {
                label: 'Date of birth',
                value: s.kyc.dateOfBirth
                  ? `${fmtDate(s.kyc.dateOfBirth)} (age ${s.kyc.age})`
                  : 'Not recorded',
              },
              {
                label: 'Class / board',
                value:
                  [s.kyc.class && humanise(s.kyc.class), s.kyc.board].filter(Boolean).join(' · ') ||
                  'Not recorded',
              },
              { label: 'School', value: s.kyc.school ?? 'Not recorded' },
              { label: 'City', value: s.kyc.city ?? 'Not recorded' },
            ]}
          />
          <RecordTable
            caption="Guardians"
            rows={s.kyc.guardians}
            rowKey={(g) => g.name}
            empty="No guardians recorded."
            columns={[
              { key: 'name', header: 'Name', render: (g) => g.name },
              { key: 'rel', header: 'Relationship', render: (g) => humanise(g.relationship) },
              { key: 'phone', header: 'Phone', render: (g) => g.phone ?? 'Not recorded' },
              { key: 'email', header: 'Email', render: (g) => g.email ?? 'Not recorded' },
              { key: 'consent', header: 'Consent', render: (g) => humanise(g.consent) },
            ]}
          />
          <RecordTable
            caption="Documents"
            rows={s.kyc.documents}
            rowKey={(d) => d.key}
            columns={[
              { key: 'doc', header: 'Document', render: (d) => d.label },
              { key: 'state', header: 'State', render: (d) => DOCUMENT_STATE_LABELS[d.state] },
            ]}
          />
        </Segment>
      ) : null}
      {s.academic && (has('results') || has('attendance')) ? (
        <div className="ops-panels">
          <AcademicEvidenceView
            evidence={s.academic}
            show={!has('results') ? 'attendance' : !has('attendance') ? 'assessments' : 'all'}
          />
        </div>
      ) : null}
      {s.feedback ? (
        <Segment
          title={internalReview ? 'Teacher reviews' : 'Teachers’ reviews (shareable notes)'}
          description={
            internalReview
              ? 'Submitted in Academic OS, as they stood when this report was made. Internal: never shared with families.'
              : 'The teachers’ shareable notes, as they stood when this report was made.'
          }
          flush
        >
          <RecordTable
            rows={s.feedback}
            rowKey={(f) => f.id}
            empty={
              s.reviewsSource?.status === 'unavailable'
                ? `Source unavailable — Academic OS could not be reached (checked ${fmtDateTime(s.reviewsSource.checkedAt)}).`
                : 'No submitted reviews in this period.'
            }
            columns={[
              {
                key: 'who',
                header: 'Teacher, subject, date',
                render: (f) =>
                  `${f.teacher} · ${f.subject} · ${fmtDate(f.observedOn)} · v${f.version}`,
              },
              ...(internalReview
                ? [
                    {
                      key: 'att',
                      header: 'Attendance and engagement',
                      render: (f: NonNullable<typeof s.feedback>[number]) =>
                        f.attendanceEvidence ?? 'None recorded',
                    },
                    {
                      key: 'hw',
                      header: 'Homework and practice',
                      render: (f: NonNullable<typeof s.feedback>[number]) =>
                        f.homeworkEvidence ?? 'None recorded',
                    },
                    {
                      key: 'concerns',
                      header: 'Academic concerns',
                      render: (f: NonNullable<typeof s.feedback>[number]) =>
                        f.academicConcerns ?? 'None recorded',
                    },
                  ]
                : []),
              { key: 'str', header: h.strengths, render: (f) => f.strengths ?? 'None recorded' },
              {
                key: 'area',
                header: h.reviewAreas,
                render: (f) => f.areasToImprove ?? 'None recorded',
              },
              { key: 'next', header: h.reviewNext, render: (f) => f.actionPlan ?? 'None recorded' },
            ]}
          />
        </Segment>
      ) : null}
      {s.summary ? (
        <Segment
          title="Summary"
          description="Built from the records and the teachers’ shareable notes; marks are unchanged."
        >
          <DetailTable
            rows={[
              { label: 'What the records show', value: bullets(s.summary.evidence) },
              { label: h.strengths, value: bullets(s.summary.strengths) },
              { label: h.areas, value: bullets(s.summary.areas) },
              { label: h.nextSteps, value: bullets(s.summary.nextSteps) },
            ]}
          />
        </Segment>
      ) : null}
      {s.comment ? (
        <Segment title="Overall comment">
          <p>{s.comment}</p>
        </Segment>
      ) : null}
      {s.history ? (
        <Segment title="Status changes in the period" flush>
          <RecordTable
            rows={s.history.changes}
            rowKey={(h) => `${h.at}-${h.status}`}
            empty="No status changes in this period."
            columns={[
              { key: 'at', header: 'When', render: (h) => fmtDateTime(h.at) },
              { key: 'status', header: 'Status', render: (h) => h.status },
              { key: 'reason', header: 'Reason', render: (h) => h.reason ?? 'Not recorded' },
            ]}
          />
          {s.history.exits.length ? (
            <RecordTable
              caption="Exit records"
              rows={s.history.exits}
              rowKey={(x) => `${x.date}-${x.status}`}
              columns={[
                { key: 'status', header: 'Exit', render: (x) => x.status },
                { key: 'date', header: 'Date', render: (x) => fmtDate(x.date) },
                { key: 'reason', header: 'Reason', render: (x) => x.reason },
              ]}
            />
          ) : null}
        </Segment>
      ) : null}
      {s.guardians ? (
        <Segment title="Guardians" flush>
          <RecordTable
            rows={s.guardians}
            rowKey={(g) => g.name}
            empty="No guardians recorded."
            columns={[
              { key: 'name', header: 'Name', render: (g) => g.name },
              { key: 'rel', header: 'Relationship', render: (g) => humanise(g.relationship) },
              { key: 'consent', header: 'Consent', render: (g) => humanise(g.consent) },
            ]}
          />
        </Segment>
      ) : null}
      {s.fees ? (
        <Segment title="Fee statement" description={s.fees.disclaimer} flush>
          <DetailTable
            rows={[
              { label: 'Amount due', value: formatPaise(s.fees.duePaise) },
              { label: 'Received (net)', value: formatPaise(s.fees.netReceivedPaise) },
              {
                label: 'Balance',
                value: `${formatPaise(s.fees.balancePaise)} (${s.fees.balance})`,
              },
            ]}
          />
        </Segment>
      ) : null}
    </>
  );
}
