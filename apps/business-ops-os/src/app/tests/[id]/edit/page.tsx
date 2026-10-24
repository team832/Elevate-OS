import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { requireTest, testOptions } from '../../../../server/assessments';
import { ActionForm } from '../../../../ui/action-form';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { BASE } from '../../_components/labels';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit test' };

type Props = { params: Promise<{ id: string }> };

export default async function EditTestPage({ params }: Props) {
  const { id } = await params;
  const access = await gate('ops:assessments:manage', `${BASE}/${id}/edit`);
  return (
    <Frame access={access} active="tests">
      <PageHeader
        title="Edit test"
        description="Saved in Academic OS. Batches and sections are set when the test is created; an empty field keeps its saved value."
      />
      <Section>
        <EditForm user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function EditForm({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async () => ({
    d: await requireTest(user, id),
    options: await testOptions(),
  }));
  if (!r.ok) return r.view;
  const t = r.data.d.assessment;
  const people = r.data.options?.teachers ?? [];
  const m = t.marking;
  const text = (v: string | number | null | undefined) =>
    v === null || v === undefined ? undefined : String(v);
  return (
    <ActionForm
      action={`/ops/api/v1/assessments/${id}`}
      method="PATCH"
      submitLabel="Save changes"
      redirectTo={`${BASE}/${id}`}
      secondary={<a href={`${BASE}/${id}`}>Back to the test</a>}
      fields={[
        { name: 'title', label: 'Title', defaultValue: t.title, section: 'Test' },
        {
          name: 'academicYear',
          label: 'Academic year',
          defaultValue: text(t.academicYear),
          hint: 'YYYY-YY',
          section: 'Test',
        },
        {
          name: 'scheduledDate',
          label: 'Date',
          type: 'date',
          defaultValue: text(t.scheduledDate),
          section: 'When',
        },
        {
          name: 'startTime',
          label: 'Start time (IST)',
          defaultValue: text(t.startTime),
          hint: 'HH:MM, 24-hour',
          section: 'When',
        },
        {
          name: 'durationMinutes',
          label: 'Duration (minutes)',
          type: 'number',
          defaultValue: text(t.durationMinutes),
          section: 'When',
        },
        {
          name: 'maxMarks',
          label: 'Maximum marks',
          defaultValue: text(t.maxMarks),
          section: 'Marks',
        },
        {
          name: 'marksPerCorrect',
          label: 'Marks per correct answer',
          defaultValue: text(m.marksPerCorrect),
          section: 'Marks',
        },
        {
          name: 'marksPerWrong',
          label: 'Marks per wrong answer',
          defaultValue: text(m.marksPerWrong),
          hint: 'Negative marking as a negative number, e.g. -1.',
          section: 'Marks',
        },
        {
          name: 'marksUnattempted',
          label: 'Marks per unattempted question',
          defaultValue: text(m.marksUnattempted),
          section: 'Marks',
        },
        {
          name: 'responsibleTeacherStaffId',
          label: 'Responsible teacher',
          type: 'select',
          options: people,
          defaultValue: text(t.responsibleTeacher?.staffId),
          section: 'People',
        },
        {
          name: 'evaluatorStaffId',
          label: 'Evaluator',
          type: 'select',
          options: people,
          defaultValue: text(t.evaluator?.staffId),
          section: 'People',
        },
      ]}
    />
  );
}
