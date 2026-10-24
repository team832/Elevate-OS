/** Sections of a test page: roster and corrections, papers and keys, publications, cancelling. */
import { Alert, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { completenessIssues, type TestDetail } from '../../../server/assessments';
import type { TestFiles } from '../../../server/assessments-files';
import { ActionForm } from '../../../ui/action-form';
import { AttachmentUpload } from '../../../ui/attachments';
import { fmtDateTime } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';

const ATTENDANCE = {
  unmarked: 'Unmarked',
  present: 'Present',
  absent: 'Absent',
  excused: 'Excused',
};
const MARKS = { not_entered: 'Not entered', imported: 'Imported for review', verified: 'Verified' };

export function Roster({
  d,
  manage,
  addable,
}: {
  d: TestDetail;
  manage: boolean;
  /** Students Ops placed in the test's batches, not on the roster yet. */
  addable: { value: string; label: string }[];
}) {
  const t = d.assessment;
  const max = d.results?.maxScore ?? t.maxMarks;
  const rows = [...d.roster].sort(
    (a, b) =>
      Number(!!a.removedAt) - Number(!!b.removedAt) ||
      (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
      a.displayName.localeCompare(b.displayName),
  );
  return (
    <Segment
      title="Roster and marks"
      flush
      description={
        t.rosterSnapshotAt
          ? `Taken ${fmtDateTime(t.rosterSnapshotAt)} from the eligible batches; later batch changes do not alter it. Missing marks are not absence.`
          : undefined
      }
    >
      {t.rosterSnapshotAt ? (
        <RecordTable
          rows={rows}
          rowKey={(x) => x.rosterId}
          columns={[
            {
              key: 'name',
              header: 'Student',
              render: (x) =>
                x.removedAt ? `${x.displayName} (removed: ${x.removedReason})` : x.displayName,
            },
            {
              key: 'adm',
              header: 'Admission no.',
              render: (x) => x.admissionNumber ?? 'Not recorded',
            },
            { key: 'batch', header: 'Batch', render: (x) => x.batchCode },
            { key: 'att', header: 'Attendance', render: (x) => ATTENDANCE[x.attendance] },
            { key: 'state', header: 'Marks', render: (x) => MARKS[x.marksState] },
            {
              key: 'score',
              header: 'Score',
              numeric: true,
              render: (x) => (x.score === null ? '—' : `${x.score} / ${max ?? '?'}`),
            },
            {
              key: 'rank',
              header: 'Rank',
              numeric: true,
              render: (x) =>
                !d.publication.rankVisible ? 'Hidden' : x.rank === null ? 'Not ranked' : x.rank,
            },
          ]}
        />
      ) : (
        <EmptyState
          title="Roster not taken"
          description="The roster is taken from the eligible batches once the test is scheduled with a date."
        />
      )}
      {manage && !t.rosterSnapshotAt && t.status === 'scheduled' ? (
        <ActionForm
          action={`/ops/api/v1/assessments/${t.id}/roster`}
          submitLabel="Take the roster now"
          successText="Roster taken."
        />
      ) : null}
      {manage && t.rosterSnapshotAt ? (
        <details className="el-explain">
          <summary>Correct the roster</summary>
          <ActionForm
            action={`/ops/api/v1/assessments/${t.id}/roster/corrections`}
            submitLabel="Save the correction"
            successText="Roster corrected."
            fields={[
              {
                name: 'action',
                label: 'Change',
                type: 'select',
                required: true,
                options: [
                  { value: 'remove', label: 'Remove from this test' },
                  { value: 'restore', label: 'Put back on this test' },
                ],
              },
              {
                name: 'studentId',
                label: 'Student',
                type: 'select',
                required: true,
                options: d.roster.map((x) => ({ value: x.studentId, label: x.displayName })),
              },
              { name: 'reason', label: 'Reason', type: 'textarea', required: true },
            ]}
          />
          <ActionForm
            action={`/ops/api/v1/assessments/${t.id}/roster/corrections`}
            submitLabel="Add the student"
            successText="Student added."
            extra={{ action: 'add' }}
            fields={[
              {
                name: 'studentId',
                label: 'Add a student placed in this test’s batches',
                type: 'select',
                required: true,
                options: addable,
                hint: addable.length
                  ? undefined
                  : 'Everyone placed in these batches is on the roster.',
              },
              { name: 'reason', label: 'Reason', type: 'textarea', required: true },
            ]}
          />
        </details>
      ) : null}
    </Segment>
  );
}

export function Papers({ id, files, manage }: { id: string; files: TestFiles; manage: boolean }) {
  const kinds = [
    ['assessment_paper', 'Question paper', files.paper],
    ['assessment_key', 'Answer key', files.key],
  ] as const;
  return (
    <Segment
      title="Question paper and answer key"
      description="Until released, these open only for people who manage tests. Each new file is kept as a new version."
    >
      {kinds.map(([kind, label, rows]) => (
        <div key={kind} className="el-stack">
          <RecordTable
            caption={label}
            rows={rows}
            rowKey={(f) => f.id}
            empty={`No ${label.toLowerCase()} ${manage ? 'uploaded yet' : 'released yet'}.`}
            columns={[
              {
                key: 'file',
                header: 'File',
                render: (f) => (
                  <a href={`/ops/api/v1/attachments/${f.id}`} download>
                    {f.name}
                  </a>
                ),
              },
              { key: 'v', header: 'Version', numeric: true, render: (f) => f.version },
              { key: 'at', header: 'Added', render: (f) => fmtDateTime(f.createdAt) },
              {
                key: 'released',
                header: 'Released',
                render: (f) =>
                  f.supersededByVersion ? (
                    `Replaced by version ${f.supersededByVersion}`
                  ) : f.releasedAt ? (
                    fmtDateTime(f.releasedAt)
                  ) : manage ? (
                    <ActionForm
                      action={`/ops/api/v1/assessments/${id}/files/${f.id}/release`}
                      submitLabel="Release"
                      labelSuffix={` ${label} version ${f.version}`}
                      variant="secondary"
                      compact
                      successText="Released."
                    />
                  ) : (
                    'Not released'
                  ),
              },
            ]}
          />
          {manage ? (
            <AttachmentUpload
              apiBase="/ops/api/v1"
              ownerKind={kind}
              ownerId={id}
              purpose="reference"
              label={`Upload a ${label.toLowerCase()} (PDF)`}
              accept=".pdf,application/pdf"
              hint="PDF, up to 8 MB."
            />
          ) : null}
        </div>
      ))}
    </Segment>
  );
}

const PUBLICATION_STATUS = { current: 'Current', superseded: 'Replaced', withdrawn: 'Withdrawn' };

/** Publication history (withdrawn ones with their reason, also Academic's own), publish, withdraw. */
export function Publications({ d, publish }: { d: TestDetail; publish: boolean }) {
  const issues = completenessIssues(d);
  const current = d.publication.current;
  return (
    <Segment
      title="Results publication"
      description="Ranks: competition ranking (1, 2, 2, 4) of present students with verified marks; absent, excused, unmarked and unverified students are not ranked."
    >
      <RecordTable
        caption="Publication history"
        rows={[...d.publication.history].reverse()}
        rowKey={(p) => String(p.version)}
        empty="Not published yet."
        columns={[
          { key: 'v', header: 'Version', numeric: true, render: (p) => p.version },
          {
            key: 'status',
            header: 'Status',
            render: (p) => (
              <StatusBadge
                tone={
                  p.status === 'withdrawn'
                    ? 'danger'
                    : p.status === 'current'
                      ? 'success'
                      : 'neutral'
                }
              >
                {PUBLICATION_STATUS[p.status]}
                {p.provisional ? ', provisional' : ''}
              </StatusBadge>
            ),
          },
          {
            key: 'when',
            header: 'Published',
            render: (p) => `${fmtDateTime(p.publishedAt)} by ${p.publishedByName}`,
          },
          {
            key: 'scope',
            header: 'Ranked within',
            render: (p) => (p.rankingScope === 'cohort' ? 'Selected batches' : 'Whole roster'),
          },
          {
            key: 'note',
            header: 'Note',
            render: (p) =>
              p.withdrawnAt
                ? `Withdrawn ${fmtDateTime(p.withdrawnAt)}: ${p.withdrawnReason ?? 'no reason recorded'}`
                : (p.note ?? ''),
          },
        ]}
      />
      {publish && current ? (
        <details className="el-explain">
          <summary>Withdraw version {current.version}</summary>
          <ActionForm
            action={`/ops/api/v1/assessments/${d.assessment.id}/publications/${current.version}/withdraw`}
            submitLabel={`Withdraw version ${current.version}`}
            variant="danger"
            successText="Withdrawn. Ranks are no longer shown."
            fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
          />
        </details>
      ) : null}
      {publish ? <PublishForm d={d} issues={issues} /> : null}
    </Segment>
  );
}

function PublishForm({ d, issues }: { d: TestDetail; issues: string[] }) {
  const current = d.publication.current;
  return (
    <>
      {issues.length ? (
        <Alert tone="warning" title="Not complete yet">
          <ul>
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          A final publication waits for these. A provisional one can go now if the setting allows
          it, labelled provisional.
        </Alert>
      ) : (
        <p>Every student on the roster has attendance and verified marks.</p>
      )}
      <ActionForm
        action={`/ops/api/v1/assessments/${d.assessment.id}/publications`}
        submitLabel={current ? 'Publish a new version' : 'Publish results'}
        successText="Published."
        fields={[
          { name: 'provisional', label: 'Publish as provisional', type: 'checkbox' },
          ...d.assessment.batches.map((b, i) => ({
            name: `cohort.${b.batchId}`,
            label: `Rank within ${b.code} only`,
            type: 'checkbox' as const,
            hint: i === 0 ? 'Leave all unticked to rank the whole roster together.' : undefined,
          })),
          { name: 'note', label: 'Note', type: 'textarea' },
        ]}
      />
    </>
  );
}

/** Cancel the test in Academic (a reason is required). */
export function CancelTest({ id }: { id: string }) {
  return (
    <Segment
      title="Cancel this test"
      description="Teachers see it as cancelled in Academic OS; nothing is deleted."
    >
      <ActionForm
        action={`/ops/api/v1/assessments/${id}`}
        method="PATCH"
        submitLabel="Cancel the test"
        variant="danger"
        successText="Test cancelled."
        extra={{ status: 'cancelled' }}
        fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
      />
    </Segment>
  );
}
