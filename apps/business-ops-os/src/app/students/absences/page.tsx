import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, ButtonLink, PageHeader, SampleBadge } from '@elevate/shared-ui';
import { istInstant } from '../../../domain/dates';
import {
  ABSENCE_CALL_LABELS,
  absencesQuery,
  absentStudents,
  type AbsencesQuery,
} from '../../../server/absences';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, plural } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { FilterForm, listHref } from '../../../ui/list-controls';
import { openHref } from '../../../ui/open-link';
import { RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Absent students' };

const BASE = '/ops/students/absences';
const OUTCOMES = Object.entries(ABSENCE_CALL_LABELS).map(([value, label]) => ({ value, label }));

/** /ops/students/absences — students marked absent in class, for a follow-up call (F4-06). */
export default async function AbsentStudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:student_private:read', BASE);
  const q = absencesQuery.parse(await searchParams);
  return (
    <Frame access={access} active="absences">
      <PageHeader
        title="Absent students"
        description="Students their teachers marked absent in class in Academic OS, for a call to the family. Late, excused and classes not marked yet are not absences. Counsellors see the students of their own cases."
        actions={
          <ButtonLink href={listHref('/ops/api/v1/students/absences', { from: q.from, to: q.to })}>
            Download spreadsheet (CSV)
          </ButtonLink>
        }
      />
      <Section label="Loading absences…">
        <Absences user={access.user} q={q} />
      </Section>
    </Frame>
  );
}

const classTime = (a: { date: string; startTime: string }) =>
  fmtDateTime(istInstant(a.date, a.startTime));

async function Absences({ user, q }: { user: AuthenticatedUser; q: AbsencesQuery }) {
  const r = await load((db) => absentStudents(db, user, q));
  if (!r.ok) return r.view;
  const d = r.data;
  const params = { from: d.window.from, to: d.window.to };
  const filters = (
    <FilterForm
      action={BASE}
      submitLabel="Show absences"
      resetHref={BASE}
      fields={[
        { name: 'from', label: 'From', type: 'date', value: d.window.from },
        { name: 'to', label: 'To', type: 'date', value: d.window.to },
      ]}
    />
  );
  if (!d.available)
    return (
      <div className="el-stack">
        {filters}
        <Alert tone="warning" title="Academic OS could not be reached">
          Absences cannot be shown right now (checked {fmtDateTime(d.fetchedAt)}). This is not an
          empty list: try again in a few minutes.
        </Alert>
      </div>
    );
  const open = d.rows.find((s) => s.id === q.open);
  const canLog = can(user, 'ops:guardians:write');
  return (
    <div className="el-stack">
      {filters}
      <RecordTable
        caption={`${plural(d.rows.length, 'student')} absent from ${fmtDate(d.window.from)} to ${fmtDate(d.window.to)}`}
        rows={d.rows}
        rowKey={(s) => s.id}
        rowHref={(s) => listHref(BASE, params, { open: s.id })}
        linkColumn="student"
        sampleOf={(s) => s.isSample}
        empty="No student you follow up on was marked absent in these dates."
        columns={[
          { key: 'student', header: 'Student', render: (s) => s.fullName },
          { key: 'absences', header: 'Absences', numeric: true, render: (s) => s.absences.length },
          { key: 'latest', header: 'Last absent', render: (s) => classTime(s.absences[0]!) },
          {
            key: 'call',
            header: 'Last call',
            render: (s) =>
              s.lastCall
                ? `${ABSENCE_CALL_LABELS[s.lastCall.outcome]} · ${fmtDateTime(s.lastCall.calledAt)}`
                : 'No call logged',
          },
        ]}
      />
      {open ? (
        <RecordModal
          id="absent-student"
          title={open.fullName}
          meta={open.isSample ? <SampleBadge /> : undefined}
          fullHref={openHref(user, `/ops/students/${open.id}`)}
          closeHref={listHref(BASE, params)}
          returnId={open.id}
        >
          <Segment title={`Absences (${open.absences.length})`} level={3} flush>
            <RecordTable
              rows={open.absences}
              rowKey={(a) => `${a.sessionId}`}
              columns={[
                { key: 'when', header: 'Class', render: classTime },
                { key: 'batch', header: 'Batch', render: (a) => `${a.batchCode} · ${a.batchName}` },
                { key: 'subject', header: 'Subject', render: (a) => a.subjectName ?? 'No subject' },
              ]}
            />
          </Segment>
          <Segment title="Calls to the family" level={3} flush>
            <RecordTable
              rows={open.calls}
              rowKey={(c) => `${c.calledAt.toISOString()}`}
              empty="No call logged yet."
              columns={[
                { key: 'at', header: 'When', render: (c) => fmtDateTime(c.calledAt) },
                {
                  key: 'outcome',
                  header: 'Outcome',
                  render: (c) => ABSENCE_CALL_LABELS[c.outcome],
                },
                { key: 'note', header: 'Note', render: (c) => c.note ?? '—' },
                { key: 'by', header: 'Called by', render: (c) => c.calledBy },
              ]}
            />
          </Segment>
          {canLog ? (
            <ActionForm
              action="/ops/api/v1/students/absences"
              submitLabel="Log the call"
              successText="Call logged."
              extra={{ studentId: open.id }}
              resetOnSuccess
              fields={[
                {
                  name: 'outcome',
                  label: 'Outcome',
                  type: 'select',
                  required: true,
                  options: OUTCOMES,
                  section: 'Log a call',
                },
                { name: 'note', label: 'Note (optional)', type: 'textarea', section: 'Log a call' },
              ]}
            />
          ) : null}
        </RecordModal>
      ) : null}
    </div>
  );
}
