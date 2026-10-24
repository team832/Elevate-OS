import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ButtonLink, PageHeader, StatCard, StatusBadge } from '@elevate/shared-ui';
import { aiBlocked } from '../../../server/ai-drafts';
import { addableStudents, testDetail, type TestDetail } from '../../../server/assessments';
import { testFiles } from '../../../server/assessments-files';
import { testImports } from '../../../server/score-import';
import { Unavailable } from '../../../ui/cross-module';
import { fmtDateTime, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import {
  BASE,
  KIND_LABELS,
  PublicationBadge,
  rosterText,
  SOURCE_LABELS,
  STATUS_LABELS,
  when,
} from '../_components/labels';
import { ScoreUpload } from '../_components/score-upload';
import { CancelTest, Papers, Publications, Roster } from '../_components/test-panels';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Test' };

type Props = { params: Promise<{ id: string }> };

export default async function TestPage({ params }: Props) {
  const { id } = await params;
  const access = await gate('ops:assessments:read', `${BASE}/${id}`);
  return (
    <Frame access={access} active="tests">
      <Section>
        <Body user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Body({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    detail: await testDetail(user, id),
    files: await testFiles(db, user, id),
    imports: await testImports(db, id),
    ai: can(user, 'ops:assessments:manage') ? await aiBlocked(db, user, 'scoreSheet') : null,
  }));
  if (!r.ok) return r.view;
  const { detail, files, imports, ai } = r.data;
  if (detail.status !== 'available')
    return (
      <>
        <PageHeader title="Test" />
        <Unavailable name="Academic OS" result={detail} />
      </>
    );
  const d = detail.data;
  const t = d.assessment;
  const manage = can(user, 'ops:assessments:manage');
  const addable = manage ? await load((db) => addableStudents(db, d)) : null;
  const c = t.rosterCounts;
  return (
    <>
      <PageHeader
        title={`${t.code} · ${t.title}`}
        description={`${KIND_LABELS[t.kind]} for ${t.courseName}, ${when(t)}.`}
        meta={
          <>
            <StatusBadge>{STATUS_LABELS[t.status]}</StatusBadge>
            <PublicationBadge state={d.publication.state} />
            {t.isSample ? <span className="el-badge el-badge-sample">SAMPLE DATA</span> : null}
          </>
        }
        actions={
          manage && t.status !== 'cancelled' && t.status !== 'finalised' ? (
            <ButtonLink href={`${BASE}/${id}/edit`}>Edit test</ButtonLink>
          ) : null
        }
      />
      <ul className="el-grid ops-kpis">
        {(
          [
            ['Present', c?.present],
            ['Absent', c?.absent],
            ['Unmarked', c?.unmarked],
            ['Marks verified', c?.verified],
          ] as const
        ).map(([label, value]) => (
          <li key={label}>
            <StatCard label={label} value={value ?? null} missingLabel="Roster not taken" />
          </li>
        ))}
      </ul>
      <div className="ops-panels">
        <Segment title="Test details" flush>
          <DetailTable rows={detailRows(d)} />
        </Segment>
        <Roster d={d} manage={manage} addable={addable?.ok ? addable.data : []} />
        <Papers id={id} files={files} manage={manage} />
        <Segment
          title="Score imports"
          description="Marks reach Academic OS only after someone reviews and saves an import."
        >
          <RecordTable
            rows={imports}
            rowKey={(i) => i.id}
            rowHref={(i) => `${BASE}/${id}/imports/${i.id}`}
            empty={
              manage
                ? 'No score files read yet. Upload a CSV or PDF score sheet below once the roster is taken.'
                : 'No score files read yet.'
            }
            columns={[
              { key: 'file', header: 'File', render: (i) => i.fileName ?? 'Manual' },
              { key: 'source', header: 'Source', render: (i) => SOURCE_LABELS[i.source] },
              { key: 'status', header: 'Status', render: (i) => humanise(i.status) },
              { key: 'rows', header: 'Rows', numeric: true, render: (i) => i.rowsTotal },
              { key: 'at', header: 'Read', render: (i) => fmtDateTime(i.createdAt) },
            ]}
          />
          {manage && t.rosterSnapshotAt ? (
            <ScoreUpload
              action={`/ops/api/v1/assessments/${id}/score-imports`}
              reviewHref={`${BASE}/${id}/imports/{id}`}
              sections={t.sections.map((s) => ({ code: s.code, name: s.name }))}
              ai={ai}
            />
          ) : null}
        </Segment>
        <Publications d={d} publish={can(user, 'ops:assessments:publish')} />
        {manage && t.status !== 'cancelled' && t.status !== 'finalised' ? (
          <CancelTest id={id} />
        ) : null}
      </div>
    </>
  );
}

function detailRows(d: TestDetail) {
  const t = d.assessment;
  const m = t.marking;
  return [
    { label: 'Assessment ID', value: t.code },
    { label: 'Type', value: KIND_LABELS[t.kind] },
    { label: 'Course', value: t.courseName },
    { label: 'Academic year', value: t.academicYear ?? 'Not recorded' },
    {
      label: 'Eligible batches',
      value: t.batches.map((b) => `${b.code}${b.primary ? ' (primary)' : ''}`).join(', '),
    },
    { label: 'Date and time', value: when(t) },
    { label: 'Maximum marks', value: t.maxMarks ?? 'Not known' },
    {
      label: 'Sections',
      value: t.sections.length
        ? t.sections
            .map((s) => `${s.name}: ${s.questionCount} questions, max ${s.maxMarks ?? 'not known'}`)
            .join('; ')
        : 'One total',
    },
    {
      label: 'Marking',
      value: m.marksPerCorrect
        ? `${m.marksPerCorrect} per correct, ${m.marksPerWrong ?? '0'} per wrong (negative marking when below 0), ${m.marksUnattempted ?? '0'} unattempted`
        : 'Not recorded',
    },
    { label: 'Responsible teacher', value: t.responsibleTeacher?.name ?? 'Not assigned' },
    { label: 'Evaluator', value: t.evaluator?.name ?? 'Not assigned' },
    { label: 'Roster', value: rosterText(t.rosterCounts) },
    { label: 'Result publication', value: <PublicationBadge state={d.publication.state} /> },
  ];
}
