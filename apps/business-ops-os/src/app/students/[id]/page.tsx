/**
 * Student profile (owner brief §8): a header with the name, status, admission number, active
 * programmes and batches, primary contact (masked unless permitted), the journey and one next
 * step; the ten record sections are pill tabs kept in `?tab=` (deep links and refresh keep
 * the section). Only the selected section loads.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader, StatusBadge } from '@elevate/shared-ui';
import { fetchAcademicStudentSummary } from '../../../server/academic-summary';
import { getStudent } from '../../../server/students';
import { fmtDateTime, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { StudentFeedbackSection } from '../../../ui/student-feedback-section';
import { StudentFeesSection } from '../../../ui/student-fees-section';
import { KycTab } from '../_components/profile-kyc';
import { OnboardingTab } from '../_components/profile-onboarding';
import { AcademicSections } from '../_components/academic-sections';
import {
  ActivityTimeline,
  AdmissionFacts,
  ExitRecords,
  HistoryTable,
  lifecycleLinks,
  NO_LIFECYCLE,
  PrimaryAction,
  ReportButtons,
  ProfileForm,
  programmesLine,
  ProgrammesTable,
  StudentJourney,
  StudentMeta,
  UpcomingTable,
  type Profile,
} from '../_components/profile-sections';
import { SectionNav } from '../_components/section-nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student record' };

const TABS = [
  ['overview', 'Overview'],
  ['kyc', 'KYC & guardians'],
  ['enrolments', 'Enrolments'],
  ['onboarding', 'Onboarding'],
  ['fees', 'Fees'],
  ['attendance', 'Attendance'],
  ['assessments', 'Assessments'],
  ['feedback', 'Feedback'],
  ['reports', 'Documents'],
  ['timeline', 'Timeline'],
] as const;
type TabKey = (typeof TABS)[number][0];
type Query = { action?: string; tab?: string; item?: string; doc?: string };

export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Query>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const access = await gate('ops:students:read', listHref(`/ops/students/${id}`, query));
  // Loaded before the frame so a former student's record highlights "Past students".
  const r = await load((db) => getStudent(db, access.user, id));
  return (
    <Frame access={access} active={r.ok && r.data.population === 'former' ? 'past' : 'students'}>
      {r.ok ? (
        <Section label="Loading section…">
          <StudentProfile user={access.user} d={r.data} id={id} query={query} />
        </Section>
      ) : (
        r.view
      )}
    </Frame>
  );
}

async function StudentProfile({
  user,
  d,
  id,
  query,
}: {
  user: AuthenticatedUser;
  d: Profile;
  id: string;
  query: Query;
}) {
  const a = d.admission;
  const base = `/ops/students/${id}`;
  const tab: TabKey = TABS.some(([k]) => k === query.tab) ? (query.tab as TabKey) : 'overview';
  const pc = d.primaryContact;
  const [content, academic] = await Promise.all([
    panel(tab, d, user, query, base),
    d.academic.studentId ? fetchAcademicStudentSummary(d.academic.studentId) : null,
  ]);
  const placed = new Map(
    academic?.status === 'available'
      ? academic.data.enrolments.flatMap((e) =>
          e.batchName ? [[e.enrolmentId as string, e.batchName] as const] : [],
        )
      : [],
  );
  return (
    <>
      <PageHeader
        title={d.person.fullName}
        meta={<StudentMeta d={d} />}
        description={[
          programmesLine(d, placed),
          a.academicYear ? `Academic year ${a.academicYear}` : 'Academic year not recorded',
          pc ? `${pc.label}: ${pc.phone ?? 'no phone'}` : 'No contact recorded',
        ].join(' · ')}
        actions={
          <>
            <PrimaryAction d={d} base={base} />
            <ReportButtons d={d} />
          </>
        }
        tabs={
          <SectionNav label={`${d.person.fullName}: record sections`}>
            {TABS.map(([key, label]) => (
              <a
                key={key}
                href={listHref(base, { tab: key })}
                aria-current={key === tab ? 'page' : undefined}
              >
                {label}
              </a>
            ))}
          </SectionNav>
        }
      />
      <div className="el-stack">
        <StudentJourney d={d} />
        {content}
      </div>
      <ProfileForm d={d} action={query.action} base={listHref(base, { tab })} />
    </>
  );
}

/** The selected tab's content (only that tab's data is loaded). */
async function panel(
  tab: TabKey,
  d: Profile,
  user: AuthenticatedUser,
  query: Query,
  base: string,
): Promise<ReactNode> {
  const links = lifecycleLinks(d, base);
  const studentId = d.identity?.id;
  const noIdentity = (title: string) => (
    <Segment title={title}>
      <p>This student has no canonical record yet, so nothing can be linked here.</p>
    </Segment>
  );
  switch (tab) {
    case 'overview':
      return (
        <>
          <div className="ops-panels">
            <Segment
              title="Admission"
              flush
              description={links.length ? undefined : NO_LIFECYCLE}
              actions={links.length ? links : null}
            >
              <AdmissionFacts d={d} />
            </Segment>
            <Segment title="Coming up" flush description="Follow-ups and meetings from today on.">
              <UpcomingTable d={d} />
            </Segment>
          </div>
          <ExitRecords d={d} />
        </>
      );
    case 'kyc':
      return <KycTab d={d} user={user} action={query.action} documentId={query.doc} base={base} />;
    case 'enrolments':
      return (
        <>
          <Segment
            title="Programmes and batches"
            flush
            description="A class cohort and an entrance programme are separate cases. Batches are assigned in Academic OS."
          >
            <ProgrammesTable d={d} />
          </Segment>
          <HandoffSegment d={d} />
          <Segment title="Status history" flush>
            <HistoryTable d={d} />
          </Segment>
          {d.numberChanges.length ? <NumberHistory d={d} /> : null}
        </>
      );
    case 'onboarding':
      return studentId ? (
        <OnboardingTab
          identityId={studentId}
          admissionId={d.admission.id}
          user={user}
          action={query.action}
          itemId={query.item}
          base={base}
        />
      ) : (
        noIdentity('Onboarding')
      );
    case 'fees':
      return studentId ? (
        <StudentFeesSection studentId={studentId} user={user} />
      ) : (
        noIdentity('Fees and instalments')
      );
    case 'attendance':
    case 'assessments':
      return (
        <div className="ops-panels">
          <Section label="Loading Academic OS data…">
            <AcademicSections d={d} show={tab} />
          </Section>
        </div>
      );
    case 'feedback':
      return studentId ? (
        <StudentFeedbackSection
          studentId={studentId}
          academicStudentId={d.academic.studentId}
          user={user}
        />
      ) : (
        noIdentity('Feedback')
      );
    case 'reports':
      return (
        <Segment title="Reports and documents" flush>
          <DetailTable
            rows={[
              {
                label: 'Student report',
                value: d.actions.report ? (
                  <a href={`/ops/students/${studentId}/report`}>
                    Open or generate the student report
                  </a>
                ) : (
                  'Needs permission to generate student reports and a linked student record.'
                ),
              },
              {
                label: 'Admission form and acknowledgement',
                value: <a href={`/ops/admissions/${d.admission.id}`}>On the admission record</a>,
              },
              {
                label: 'Identity documents',
                value: 'Masked references only, under KYC and guardians (no scans are stored).',
              },
            ]}
          />
        </Segment>
      );
    case 'timeline':
      return (
        <Segment
          title="Timeline"
          description="From the audit trail, newest first (latest 100). KYC details are in the KYC history."
        >
          <ActivityTimeline rows={d.timeline} />
        </Segment>
      );
  }
}

function NumberHistory({ d }: { d: Profile }) {
  return (
    <Segment title="Admission number history" flush>
      <RecordTable
        rows={d.numberChanges}
        rowKey={(c) => c.id}
        columns={[
          { key: 'at', header: 'When', render: (c) => fmtDateTime(c.at) },
          { key: 'from', header: 'From', render: (c) => c.previousNumber ?? 'None' },
          { key: 'to', header: 'To', render: (c) => c.newNumber },
          {
            key: 'how',
            header: 'How',
            render: (c) => (c.kind === 'auto' ? 'Automatic' : 'Entered by hand'),
          },
          { key: 'by', header: 'By', render: (c) => c.actorName },
          { key: 'reason', header: 'Reason', render: (c) => c.reason ?? '—' },
        ]}
      />
    </Segment>
  );
}

/** Enrolment handoff to Academic OS (requests, replies, attempts). */
function HandoffSegment({ d }: { d: Profile }) {
  const h = d.handoff;
  return (
    <Segment
      title="Enrolment handoff"
      flush
      description="Requests to Academic OS; enrolled only after Academic confirms."
      actions={
        h.retry.allowed ? (
          <a href={`/ops/admissions/${d.admission.id}`}>Request enrolment again</a>
        ) : null
      }
    >
      <DetailTable
        rows={[
          {
            label: 'Status',
            value: (
              <>
                <StatusBadge tone={h.view.tone}>{h.view.label}</StatusBadge>
                {h.view.detail ? ` ${h.view.detail}` : ''}
              </>
            ),
          },
          !!d.academic.path && {
            label: 'Academic OS',
            value: <a href={d.academic.path}>Open the student in Academic OS</a>,
          },
        ]}
      />
      <RecordTable
        caption="Requests"
        rows={h.attempts}
        rowKey={(x) => x.id}
        empty="Enrolment not requested yet."
        columns={[
          { key: 'n', header: 'Attempt', numeric: true, render: (x) => x.attempt },
          {
            key: 'by',
            header: 'Requested',
            render: (x) => `${fmtDateTime(x.requestedAt)} by ${x.requestedByName ?? 'unknown'}`,
          },
          { key: 'outcome', header: 'Outcome', render: (x) => humanise(x.outcome) },
        ]}
      />
    </Segment>
  );
}
