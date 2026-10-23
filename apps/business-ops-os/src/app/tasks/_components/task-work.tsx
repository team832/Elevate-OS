/**
 * Task detail sections for the brief of 23 Oct 2026 §9–§11: checklist, reference files and
 * deliverables, the submit form, submission history with review decisions (and the reviewer's
 * form), the discussion and the work log (updates and corrections, brief 2 §6). Every form posts to the host's API; the server checks again.
 */
import { StatusBadge } from '@elevate/shared-ui';
import { istToday } from '../../../domain/dates';
import { istClock, istWhen } from '../../../domain/staff-tasks';
import { minutesOf } from '../../../domain/task-lifecycle';
import { fmtDuration, updateDetail } from '../../../domain/task-report';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import type { AttachmentListRow } from '../../../server/attachments';
import type { TaskDetail } from '../../../server/task-detail';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { AttachmentList, AttachmentUpload } from '../../../ui/attachments';
import { Segment, Timeline } from '../../../ui/sections';
import { taskPaths } from './task-common';

type Files = readonly AttachmentListRow[];
const apiBase = (base: string) => `${base}/api/v1`;

export function Checklist({ d, base }: { d: TaskDetail; base: string }) {
  if (!d.checklist.length) return null;
  const done = d.checklist.filter((i) => i.doneAt).length;
  const { api } = taskPaths(base);
  return (
    <Segment title={`Checklist (${done} of ${d.checklist.length} done)`}>
      <ul className="el-stack">
        {d.checklist.map((i) => (
          <li key={i.id} className="el-card-actions">
            <span>
              {i.doneAt ? <StatusBadge tone="success">Done</StatusBadge> : null} {i.text}
            </span>
            {d.canEdit ? (
              <ActionForm
                compact
                variant="secondary"
                action={`${api}/${d.id}/checklist`}
                submitLabel={i.doneAt ? 'Undo' : 'Mark done'}
                labelSuffix={` — ${i.text}`}
                extra={{ itemId: i.id, done: !i.doneAt }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Segment>
  );
}

/**
 * Reference files from the assigner, and deliverables waiting for the next submission (submitting
 * moves them onto that version, where they stay).
 */
export function TaskFiles({ d, base, files }: { d: TaskDetail; base: string; files: Files }) {
  const owner = d.selfStaffId === d.staffId;
  const of = (purpose: string) => files.filter((f) => f.purpose === purpose);
  return (
    <Segment title="Files">
      <div className="el-stack">
        <h3>Reference files</h3>
        <AttachmentList
          rows={of('reference')}
          apiBase={apiBase(base)}
          empty="No reference files."
        />
        {d.canEdit && !owner ? (
          <AttachmentUpload
            apiBase={apiBase(base)}
            ownerKind="task"
            ownerId={d.id}
            purpose="reference"
            label="Add a reference file"
          />
        ) : null}
        <h3>Deliverables</h3>
        <AttachmentList
          rows={of('deliverable')}
          apiBase={apiBase(base)}
          empty="No deliverable waiting. Handed-in files are listed with their version."
        />
        {owner && d.status !== 'done' && d.status !== 'cancelled' ? (
          <AttachmentUpload
            apiBase={apiBase(base)}
            ownerKind="task"
            ownerId={d.id}
            purpose="deliverable"
            label="Attach a deliverable"
          />
        ) : null}
      </div>
    </Segment>
  );
}

export function SubmitWork({ d, base }: { d: TaskDetail; base: string }) {
  if (!d.allowed.includes('submit')) return null;
  const again = d.submissions.length > 0;
  return (
    <div id="submit">
      <Segment
        title={
          again ? `Respond to changes (version ${d.submissions.length + 1})` : 'Submit for review'
        }
        description={
          d.expectedDeliverable
            ? `Expected: ${d.expectedDeliverable}. Attach the file under Files, or say where it is.`
            : 'Say what you did. Submitting is not approval: the reviewer decides.'
        }
      >
        <ActionForm
          action={`${taskPaths(base).api}/${d.id}/submit-for-review`}
          submitLabel={again ? 'Submit the revised work' : 'Submit for review'}
          extra={{ expectedVersion: d.version }}
          successText="Submitted. The reviewer has been told."
          fields={[
            { name: 'completionNote', label: 'What you did', type: 'textarea', required: true },
            {
              name: 'evidence',
              label: 'Link or where to find the deliverable',
              hint: d.pendingFiles.length
                ? `${d.pendingFiles.length} attached file(s) go with this version and stay with it.`
                : 'Optional when a deliverable file is attached.',
            },
          ]}
        />
      </Segment>
    </div>
  );
}

const DECISION_WORDS = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  comment: 'Comment',
} as const;

/** v1, v2… with what was handed in and each review decision, phrased as sentences. */
export function Submissions({ d, base }: { d: TaskDetail; base: string }) {
  const review = d.allowed.includes('approve');
  const items = [
    ...d.submissions.map((s) => ({
      key: s.id,
      at: s.submittedAt,
      when: `Version ${s.version} · ${istWhen(s.submittedAt)}`,
      title: `Submitted by ${s.submittedBy} at ${istClock(s.submittedAt)}.`,
      detail: (
        <>
          {[s.completionNote, s.evidence && `Evidence: ${s.evidence}`].filter(Boolean).join(' · ')}
          {s.files.length ? ' · Files: ' : null}
          {s.files.map((f, i) => (
            <span key={f.id}>
              {i ? ', ' : null}
              <a href={`${apiBase(base)}/attachments/${f.id}`} download>
                {f.name}
              </a>
            </span>
          ))}
        </>
      ),
    })),
    ...d.reviews.map((r) => ({
      key: r.id,
      at: r.createdAt,
      when: istWhen(r.createdAt),
      title: `${DECISION_WORDS[r.decision]} by ${r.reviewer}${r.note ? `: ${r.note}` : '.'}`,
      detail: undefined,
    })),
  ].sort((a, b) => +b.at - +a.at);
  if (!items.length && !review) return null;
  return (
    <Segment title={`Submissions and review (${d.submissions.length})`} description="Newest first.">
      <div className="el-stack">
        {review ? (
          <div className="el-card-actions">
            <ActionForm
              compact
              action={`${taskPaths(base).api}/${d.id}/approve`}
              submitLabel={`Approve version ${d.submissions.length}`}
              extra={{ expectedVersion: d.version }}
              fields={[{ name: 'note', label: 'Review note (optional)' }]}
              successText="Approved. The assignee has been told."
            />
            <ActionForm
              compact
              variant="secondary"
              action={`${taskPaths(base).api}/${d.id}/request-changes`}
              submitLabel="Request changes"
              extra={{ expectedVersion: d.version }}
              fields={[{ name: 'reason', label: 'What needs to change', required: true }]}
              successText="Changes requested. The assignee has been told."
            />
          </div>
        ) : null}
        {items.length ? (
          <Timeline label="Submissions and review decisions" items={items} />
        ) : (
          <p className="el-field-hint">Nothing submitted yet.</p>
        )}
      </div>
    </Segment>
  );
}

/** Comments and clarification questions, newest first, with the comment box. */
export function Discussion({ d, base }: { d: TaskDetail; base: string }) {
  const notes = d.events
    .filter((e) => e.kind === 'comment' || e.kind === 'clarification_requested')
    .reverse();
  return (
    <Segment title={`Discussion (${notes.length})`}>
      <div className="el-stack">
        {d.allowed.includes('comment') ? (
          <ActionForm
            action={`${taskPaths(base).api}/${d.id}/comment`}
            submitLabel="Post comment"
            extra={{ expectedVersion: d.version }}
            fields={[{ name: 'reason', label: 'Comment', type: 'textarea', required: true }]}
            resetOnSuccess
          />
        ) : null}
        {notes.length ? (
          <Timeline
            label="Discussion"
            items={notes.map((e) => ({
              key: e.id,
              when: istWhen(e.occurredAt),
              title: `${e.kind === 'comment' ? 'Comment' : 'Question'} from ${e.actorName}`,
              detail: e.reason ?? undefined,
            }))}
          />
        ) : (
          <p className="el-field-hint">No comments yet.</p>
        )}
      </div>
    </Segment>
  );
}

const UPDATE_FIELDS: FieldSpec[] = [
  {
    name: 'workPerformed',
    label: 'Work performed',
    type: 'textarea',
    required: true,
    section: 'Work',
  },
  { name: 'result', label: 'Result', section: 'Work' },
  { name: 'remainingWork', label: 'Remaining', section: 'Work' },
  { name: 'blocker', label: 'Blocker', section: 'Work' },
  { name: 'nextStep', label: 'Next step', section: 'Work' },
  { name: 'evidence', label: 'Evidence', hint: 'A link or where to find it.', section: 'Work' },
  {
    name: 'occurredOn',
    label: 'Work date',
    type: 'date',
    hint: 'IST. A late entry keeps this date and the time you record it.',
    section: 'Time (optional)',
  },
  { name: 'durationMinutes', label: 'Minutes spent', type: 'number', section: 'Time (optional)' },
  { name: 'startedAt', label: 'Started (IST)', type: 'datetime', section: 'Time (optional)' },
  { name: 'endedAt', label: 'Stopped (IST)', type: 'datetime', section: 'Time (optional)' },
];

const local = (at: Date | null) =>
  at ? new Date(+at + 330 * 60000).toISOString().slice(0, 16) : '';

export function WorkUpdates({ d, base }: { d: TaskDetail; base: string }) {
  const { api } = taskPaths(base);
  const items = [...d.updates].reverse().map((u) => {
    const minutes = minutesOf(u);
    const late = istToday(u.recordedAt) > u.occurredOn;
    return {
      key: u.id,
      when: `Work date ${fmtDate(u.occurredOn)} · recorded ${fmtDateTime(u.recordedAt)}${late ? ' (later)' : ''}`,
      title: `${u.authorName}${minutes !== null ? ` · ${fmtDuration(minutes)}` : ''}${u.corrected ? ' · replaced by a correction' : ''}`,
      detail: (
        <>
          {updateDetail(u)}
          {u.warnings.map((w) => (
            <StatusBadge key={w} tone="warning">
              {w}
            </StatusBadge>
          ))}
          {u.authorStaffId === d.selfStaffId && !u.corrected ? (
            <details className="el-explain">
              <summary>Correct this entry…</summary>
              <ActionForm
                action={`${api}/${d.id}/updates`}
                submitLabel="Save correction"
                extra={{ correctsUpdateId: u.id }}
                fields={[
                  {
                    name: 'correctionReason',
                    label: 'What was wrong',
                    required: true,
                    section: 'Correction',
                  },
                  ...UPDATE_FIELDS.map((f) => ({
                    ...f,
                    defaultValue:
                      f.name === 'startedAt' || f.name === 'endedAt'
                        ? local(u[f.name])
                        : String(u[f.name as keyof typeof u] ?? ''),
                  })),
                ]}
              />
            </details>
          ) : null}
        </>
      ),
    };
  });
  return (
    <Segment
      title={`Work updates (${d.updates.length})`}
      description="Newest first. Entries are never edited: a correction is a new entry with a reason."
    >
      <div className="el-stack">
        {d.canLogWork ? (
          <details className="el-explain" open={!d.updates.length}>
            <summary>Log work</summary>
            <ActionForm
              action={`${api}/${d.id}/updates`}
              submitLabel="Log work"
              successText="Work logged."
              fields={UPDATE_FIELDS}
            />
          </details>
        ) : null}
        {items.length ? (
          <Timeline label="Work updates" items={items} />
        ) : (
          <p className="el-field-hint">No work logged yet.</p>
        )}
      </div>
    </Segment>
  );
}
