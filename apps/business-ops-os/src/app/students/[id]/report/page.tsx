import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, ButtonLink, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { addDays, istToday } from '../../../../domain';
import { formatPaise } from '../../../../domain/fees';
import { NEXT_STEP_LABEL, REPORT_SECTIONS } from '../../../../domain/student-report';
import { loadSettings } from '../../../../server/settings';
import { getStudentReport } from '../../../../server/student-report';
import { getStudent } from '../../../../server/students';
import { ActionForm, type FieldSpec } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../ui/sections';
import { AcademicEvidenceView } from '../../_components/academic-sections';
import { PrintButton } from '../../_components/print-button';

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

const AUDIENCE_LABELS = {
  internal: 'Internal (staff)',
  guardian: 'Parents and guardians',
  student: 'Student',
  admin_dossier: 'Administration dossier',
} as const;

const SECTION_LABELS: Record<(typeof REPORT_SECTIONS)[number], string> = {
  overview: 'Overview and status history (status history: staff reports only)',
  programmes: 'Programmes and batches',
  results: 'Marks and trends',
  attendance: 'Attendance',
  feedback: 'Raw teacher reviews (staff reports only)',
  fees: 'Fee totals (for parents/students only when ticked)',
  guardians: 'Guardians (staff reports only)',
  summary: 'Constructive summary (parent and student reports)',
};

const STATUS_TONES = { draft: 'neutral', reviewed: 'info', final: 'success' } as const;

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

/** Period, audience and sections; generating stores a draft snapshot and an audit row. */
async function Generate({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    student: await getStudent(db, user, id),
    audiences: (await loadSettings(db))['reports.audiences'],
  }));
  if (!r.ok) return r.view;
  const today = istToday(new Date());
  const { enabled } = r.data.audiences.value;
  const fields: FieldSpec[] = [
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
      name: 'audience',
      label: 'Who it is for',
      type: 'select',
      required: true,
      defaultValue: enabled[0],
      options: enabled.map((a) => ({ value: a, label: AUDIENCE_LABELS[a] })),
      hint: `Audiences offered come from the setting “${r.data.audiences.label}” (${humanise(r.data.audiences.decisionState)}).`,
      section: 'Audience',
    },
    {
      name: 'acknowledgement',
      label: 'Add an acknowledgement space for signature',
      type: 'checkbox',
      section: 'Audience',
    },
    ...REPORT_SECTIONS.map((s) => ({
      name: `sections.${s}`,
      label: SECTION_LABELS[s],
      type: 'checkbox' as const,
      defaultValue: s === 'fees' ? 'false' : 'true',
      section: 'Sections (only those your role may include are kept)',
    })),
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
            reviews it, then it is made final and never changes. Parent and student reports never
            contain raw teacher reviews, identity documents, history or payment details. Nothing is
            emailed.
          </p>
        </details>
        <Segment title="Make a report">
          <ActionForm
            action={`/ops/api/v1/students/${id}/report`}
            submitLabel="Create draft report"
            redirectTo={`/students/${id}/report?export={id}`}
            fields={fields}
          />
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
  const { export: e, view: s, actions } = r.data;
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
        description={`Reference ${e.referenceCode} · ${AUDIENCE_LABELS[e.audience]} · ${fmtDate(e.periodFrom)} to ${fmtDate(e.periodTo)}`}
        actions={
          <span className="ops-no-print el-inline-form">
            <a href={`/ops/students/${id}`}>Back to the student</a>
            {s ? (
              <a href={`/ops/api/v1/students/${id}/report/${e.referenceCode}/pdf`}>Download PDF</a>
            ) : null}
            <PrintButton />
          </span>
        }
      />
      <div className="el-stack">
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
                  <StatusBadge tone={STATUS_TONES[e.status]}>{humanise(e.status)}</StatusBadge>
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
  const bullets = (items: readonly string[]) => (
    <ul>
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
  return (
    <>
      <Segment title="Programmes and batches" flush>
        <DetailTable
          rows={[
            { label: 'Admission number', value: s.student.admissionNumber ?? 'Not assigned' },
            ...(has('programmes') || has('overview') ? s.programmes : []).map((p) => ({
              label: p.programme,
              value: `${p.batch} · ${p.status}`,
            })),
          ]}
        />
      </Segment>
      {s.academic && (has('results') || has('attendance')) ? (
        <div className="ops-panels">
          <AcademicEvidenceView
            evidence={s.academic}
            show={!has('results') ? 'attendance' : !has('attendance') ? 'assessments' : 'all'}
          />
        </div>
      ) : null}
      {s.summary ? (
        <Segment
          title="Summary"
          description="Built from the records and the teachers’ shareable notes; marks are unchanged."
        >
          <DetailTable
            rows={[
              { label: 'What the records show', value: bullets(s.summary.evidence) },
              { label: 'Strengths', value: bullets(s.summary.strengths) },
              { label: 'Areas for improvement', value: bullets(s.summary.areas) },
              { label: NEXT_STEP_LABEL, value: bullets(s.summary.nextSteps) },
            ]}
          />
        </Segment>
      ) : null}
      {s.feedback ? (
        <Segment
          title="Teacher reviews"
          description="Submitted reviews in the period. Internal: never shared with families."
          flush
        >
          <RecordTable
            rows={s.feedback}
            rowKey={(f) => f.id}
            empty="No submitted reviews in this period."
            columns={[
              {
                key: 'who',
                header: 'Teacher, subject, date',
                render: (f) =>
                  `${f.teacher} · ${f.subject} · ${fmtDate(f.observedOn)} · v${f.version}`,
              },
              { key: 'obs', header: 'Observation', render: (f) => f.observations },
              { key: 'str', header: 'Strengths', render: (f) => f.strengths ?? 'None recorded' },
              {
                key: 'area',
                header: 'Areas needing support',
                render: (f) => f.areasToImprove ?? 'None recorded',
              },
              {
                key: 'next',
                header: 'Suggested next step',
                render: (f) => f.actionPlan ?? 'None recorded',
              },
            ]}
          />
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
