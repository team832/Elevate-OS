import { Alert, PageHeader } from '@elevate/shared-ui';
import { ASSESSMENT_KINDS } from '@elevate/shared-contracts';
import { istToday } from '../../../domain/dates';
import { testOptions } from '../../../server/assessments';
import { ActionForm } from '../../../ui/action-form';
import { Frame, gate, Section } from '../../../ui/frame';
import { BASE, KIND_LABELS } from '../_components/labels';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Schedule a test' };

/** The academic year of a date: April to March, e.g. 2026-27. */
const academicYear = (d: string) => {
  const y = Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 4 ? 1 : 0);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

export default async function NewTestPage() {
  const access = await gate('ops:assessments:manage', `${BASE}/new`);
  return (
    <Frame access={access} active="tests">
      <PageHeader
        title="Schedule a test"
        description="Saved in Academic OS. With a date it is scheduled and its roster is taken from the eligible batches at once; without one it stays a draft."
      />
      <Section>
        <NewTestForm />
      </Section>
    </Frame>
  );
}

async function NewTestForm() {
  const options = await testOptions();
  if (!options)
    return (
      <Alert tone="warning" title="Source unavailable">
        Batches and teachers come from Academic OS, which could not be read. Try again in a minute.
      </Alert>
    );
  if (!options.batches.length)
    return (
      <Alert tone="warning" title="No batches to choose">
        Academic OS has no active batch with a teacher assigned. Coordinators set up batches and
        teaching assignments in Academic OS first.
      </Alert>
    );
  const people = options.teachers;
  return (
    <ActionForm
      action="/ops/api/v1/assessments"
      submitLabel="Save test"
      redirectTo={`${BASE}/{id}`}
      secondary={<a href={BASE}>Cancel</a>}
      fields={[
        {
          name: 'code',
          label: 'Assessment ID',
          required: true,
          hint: 'e.g. IPMAT-MOCK-07',
          section: 'Test',
        },
        { name: 'title', label: 'Title', required: true, section: 'Test' },
        {
          name: 'kind',
          label: 'Type',
          type: 'select',
          required: true,
          options: ASSESSMENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
          section: 'Test',
        },
        {
          name: 'academicYear',
          label: 'Academic year',
          required: true,
          defaultValue: academicYear(istToday(new Date())),
          hint: 'YYYY-YY',
          section: 'Test',
        },
        ...options.batches.map((b, i) => ({
          name: `batches.${b.value}`,
          label: b.label,
          type: 'checkbox' as const,
          hint:
            i === 0
              ? 'Tick every eligible batch; the first ticked is the primary batch. All must be of one course.'
              : undefined,
          section: 'Eligible batches',
        })),
        { name: 'scheduledDate', label: 'Date', type: 'date', section: 'When' },
        { name: 'startTime', label: 'Start time (IST)', hint: 'HH:MM, 24-hour', section: 'When' },
        { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', section: 'When' },
        {
          name: 'maxMarks',
          label: 'Maximum marks',
          hint: 'For tests marked as one total. With sections, each section’s maximum counts.',
          section: 'Marks',
        },
        {
          name: 'marksPerCorrect',
          label: 'Marks per correct answer',
          hint: 'e.g. 4',
          section: 'Marks',
        },
        {
          name: 'marksPerWrong',
          label: 'Marks per wrong answer',
          hint: 'Negative marking as a negative number, e.g. -1. Leave empty for none.',
          section: 'Marks',
        },
        {
          name: 'marksUnattempted',
          label: 'Marks per unattempted question',
          hint: 'Usually 0',
          section: 'Marks',
        },
        {
          name: 'sections',
          label: 'Sections',
          type: 'textarea',
          hint: 'One per line: Code, Name, Questions, Maximum marks. e.g. QA, Quantitative Aptitude, 40, 160',
          section: 'Marks',
        },
        {
          name: 'responsibleTeacherStaffId',
          label: 'Responsible teacher',
          type: 'select',
          options: people,
          section: 'People',
        },
        {
          name: 'evaluatorStaffId',
          label: 'Evaluator',
          type: 'select',
          options: people,
          section: 'People',
        },
      ]}
    />
  );
}
