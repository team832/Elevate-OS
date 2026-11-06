import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { ButtonLink, Card, DataTable, EmptyState, fmtDay, PageHeader, SampleBadge, StatusBadge } from '@elevate/shared-ui';
import { getHomework } from '../../../server';
import { ApiForm } from '../../../ui/api-form';
import { fmtDateTime } from '../../../ui/badges';
import { COMPLETION_RULE, countColumns, HOMEWORK_PATHS } from '../../../ui/homework';
import { HomeworkMarks } from '../../../ui/homework-marks';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Homework' };

/** /academic/homework/:id — one homework: details, the marking grid and cancel (F4-05). */
export default async function HomeworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:classes:read', HOMEWORK_PATHS.one(id));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="homework">{null}</AcademicShell>;
  const data = await load(() => getHomework(getDb(), actorFor(access.user), id));
  if (!data.ok) return <AcademicShell access={access} active="homework"><LoadError level={1} back="homework" error={data.error} /></AcademicShell>;
  const h = data.data;
  const open = !h.cancelledAt;
  const canMark = open && can(access.user, 'academic:classes:record');
  const part = [h.subjectName, h.chapterCode ? `${h.chapterCode} ${h.chapterTitle}` : null].filter(Boolean).join(' · ');
  return (
    <AcademicShell access={access} active="homework">
      <PageHeader
        title={h.title}
        meta={
          <>
            {open ? null : <StatusBadge tone="neutral">Cancelled</StatusBadge>}
            {h.isSample ? <SampleBadge /> : null}
          </>
        }
        description={`${h.batchCode} · ${h.batchName}${part ? ` · ${part}` : ''} · set ${fmtDay(h.setOn)}, due ${fmtDay(h.dueOn)} · ${h.teacherName}`}
        actions={
          <>
            <ButtonLink href={`${HOMEWORK_PATHS.api(`/${h.id}`)}?format=csv`}>Download spreadsheet (CSV)</ButtonLink>
            <ButtonLink href={HOMEWORK_PATHS.list}>All homework</ButtonLink>
          </>
        }
      />
      <div className="el-stack">
        {open ? null : (
          <p className="el-field-hint">
            Cancelled {fmtDateTime(h.cancelledAt)}: {h.cancelReason}. Marks are kept and can no longer change.
          </p>
        )}
        {h.instructions ? (
          <Card title="Instructions">
            <p style={{ whiteSpace: 'pre-wrap' }}>{h.instructions}</p>
          </Card>
        ) : null}
        <Card title="Summary">
          <DataTable rows={[h]} rowKey={(r) => r.id} columns={countColumns<typeof h>()} />
          <details className="el-explain">
            <summary>How completion is counted</summary>
            <p>{COMPLETION_RULE}</p>
          </details>
        </Card>
        <Card title={`Students (${h.students.length})`}>
          {h.students.length ? (
            <HomeworkMarks action={HOMEWORK_PATHS.api(`/${h.id}/marks`)} rows={h.students} canMark={canMark} />
          ) : (
            <EmptyState title="No students in this batch for these dates" description="Students placed in the batch between the set date and the due date appear here." />
          )}
        </Card>
        {canMark ? (
          <Card title="Cancel this homework">
            <ApiForm
              action={HOMEWORK_PATHS.api(`/${h.id}/cancel`)}
              fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true, maxLength: 500, hint: 'Kept with the homework; it is not deleted.' }]}
              submitLabel="Cancel homework"
              successMessage="Homework cancelled."
              variant="danger"
              idPrefix="cancel"
            />
          </Card>
        ) : null}
      </div>
    </AcademicShell>
  );
}
