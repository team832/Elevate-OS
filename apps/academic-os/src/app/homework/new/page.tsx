import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import type { PageAccess } from '@elevate/server-kit/next';
import { Button, ButtonLink, Card, DataTable, EmptyState, fmtDay, PageHeader } from '@elevate/shared-ui';
import { homeworkForm, listBatches, todayIst } from '../../../server';
import { ApiForm, type FormField } from '../../../ui/api-form';
import { Filter } from '../../../ui/filters';
import { HOMEWORK_PATHS } from '../../../ui/homework';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Set homework' };

type Search = Promise<Record<string, string | string[] | undefined>>;
type Form = Awaited<ReturnType<typeof homeworkForm>>;

/** /academic/homework/new?batchId&record — set homework for a batch, optionally copied from a teaching-log entry (F4-05). */
export default async function NewHomeworkPage({ searchParams }: { searchParams: Search }) {
  const access = await gate('academic:classes:record', HOMEWORK_PATHS.create);
  return (
    <AcademicShell access={access} active="homework" loading="Loading…">
      {access.status === 'allowed' ? <Body access={access} searchParams={searchParams} /> : null}
    </AcademicShell>
  );
}

const header = (description: string) => (
  <PageHeader title="Set homework" description={description} actions={<ButtonLink href={HOMEWORK_PATHS.list}>All homework</ButtonLink>} />
);

async function Body({ access, searchParams }: { access: PageAccess; searchParams: Search }) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const actor = actorFor(access.user);
  const batches = await load(() => listBatches(getDb(), actor));
  if (!batches.ok) return <>{header('Choose the batch first.')}<LoadError error={batches.error} /></>;
  const batchId = pick('batchId') ?? (batches.data.length === 1 ? batches.data[0]!.id : undefined);
  if (!batchId)
    return (
      <>
        {header('Choose the batch first.')}
        {batches.data.length ? (
          <form method="get" className="el-inline-form">
            <Filter id="hw-new-batch" name="batchId" label="Batch" type="select" all={null} options={batches.data.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
            <Button type="submit">Continue</Button>
          </form>
        ) : (
          <EmptyState title="No batch to set homework for" description="Homework is set for a batch you teach. Ask the academic coordinator to assign you to a batch." />
        )}
      </>
    );
  const form = await load(() => homeworkForm(getDb(), actor, batchId, pick('record')));
  if (!form.ok) return <>{header('Choose the batch first.')}<LoadError error={form.error} /></>;
  const f = form.data;
  return (
    <>
      {header(`For ${f.batch.code} · ${f.batch.name}. Students are the ones placed in the batch between the set date and the due date.`)}
      <div className="el-stack">
        <Card title="Copy from a teaching log (optional)">
          <DataTable
            rows={f.logged}
            rowKey={(l) => l.id}
            empty={<EmptyState title="No teaching-log homework in the last 30 days" description="Homework written in a submitted class log shows here so you can copy it." />}
            columns={[
              { key: 'date', header: 'Class', render: (l) => `${fmtDay(l.date)} · ${l.chapterTitle}` },
              { key: 'homework', header: 'Homework written in the log', render: (l) => l.homework },
              {
                key: 'use',
                header: '',
                render: (l) =>
                  l.id === f.copied?.id ? (
                    'Copied below'
                  ) : (
                    <a href={`${HOMEWORK_PATHS.create}?${new URLSearchParams({ batchId, record: l.id })}`}>
                      Copy this<span className="el-visually-hidden"> homework from {fmtDay(l.date)}</span>
                    </a>
                  ),
              },
            ]}
          />
        </Card>
        <Card title="Homework">
          <ApiForm
            key={f.copied?.id ?? 'blank'}
            action={HOMEWORK_PATHS.api()}
            fields={fields(f)}
            extra={{ batchId, ...(f.copied ? { classRecordId: f.copied.id } : {}) }}
            submitLabel="Set homework"
            successMessage="Homework set."
            goTo="/homework/{id}"
          />
        </Card>
      </div>
    </>
  );
}

function fields(f: Form): FormField[] {
  const c = f.copied;
  return [
    { name: 'title', label: 'Title', required: true, maxLength: 200, defaultValue: c ? `Homework: ${c.chapterTitle}` : undefined },
    { name: 'subjectId', label: 'Subject (optional)', type: 'select', options: f.subjects.map((s) => ({ value: s.id, label: s.name })), defaultValue: c?.subjectId },
    { name: 'chapterId', label: 'Chapter (optional)', type: 'select', options: f.chapters.map((ch) => ({ value: ch.id, label: `${ch.code} ${ch.title}` })), defaultValue: c?.chapterId },
    { name: 'setOn', label: 'Set on', type: 'date', required: true, defaultValue: c?.date ?? todayIst() },
    { name: 'dueOn', label: 'Due on', type: 'date', required: true, defaultValue: c?.homeworkDueOn ?? undefined },
    { name: 'instructions', label: 'Instructions', type: 'textarea', maxLength: 4000, defaultValue: c?.homework ?? undefined },
    ...(f.teachers.length
      ? [{ name: 'teacherStaffId', label: 'Set by (teacher of the batch)', type: 'select' as const, required: true, options: f.teachers.map((t) => ({ value: t.id, label: t.fullName })) }]
      : []),
  ];
}
