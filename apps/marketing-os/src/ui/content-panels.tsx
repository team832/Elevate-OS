/** Panels for the content item screen (server components). */
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
} from '@elevate/shared-ui';
import { ASSIGNEE_ROLES, RIGHTS_STATES, formatIst } from '../domain';
import type { ContentItemDetail } from '../server';
import {
  addVersionAction,
  assignAction,
  commentAction,
  decideAction,
} from '../app/actions/content';
import { RuleCheckSummary } from './badges';

type D = ContentItemDetail;

export function VersionsPanel({ d }: { d: D }) {
  return (
    <Card
      title={`Versions (${d.versions.length})`}
      description="Versions are immutable; an edit is always a new version with its own hash."
    >
      {d.versions.length === 0 ? (
        <EmptyState title="No copy yet" description="Add the first version below." />
      ) : (
        d.versions.map((v) => (
          <details key={v.id} open={v.id === d.item.currentVersionId}>
            <summary>
              v{v.versionNumber} — {v.title}{' '}
              {v.id === d.item.currentVersionId ? (
                <StatusBadge tone="info">current</StatusBadge>
              ) : null}{' '}
              {v.isApproved ? <StatusBadge tone="success">approved</StatusBadge> : null}{' '}
              <span className="el-field-hint">
                {v.authorName ?? 'unknown'} · {formatIst(v.createdAt)} ·{' '}
                {v.contentHash.slice(0, 12)}
              </span>
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{v.body || '(empty)'}</pre>
            {v.changeNote ? <p className="el-field-hint">Change: {v.changeNote}</p> : null}
            <p className="el-field-hint">
              Shows students: {v.showsStudents ? 'yes' : 'no'} · Consent reference:{' '}
              {v.consentReference ?? 'none'}
            </p>
            {v.assets.length ? (
              <ul>
                {v.assets.map((a) => (
                  <li key={a.id}>
                    {a.fileName} ({a.mimeType}
                    {a.sizeBytes !== null ? `, ${a.sizeBytes} bytes` : ''}) · rights{' '}
                    {a.rightsState.replaceAll('_', ' ')}
                    {a.showsStudents ? ' · shows students' : ''}
                    {a.externalUrl ? (
                      <>
                        {' '}
                        · <a href={a.externalUrl}>link</a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        ))
      )}
    </Card>
  );
}

export function EditPanel({ d }: { d: D }) {
  if (d.editEffect === 'blocked') return null;
  return (
    <Card
      title="Save a new version"
      description={
        d.editEffect === 'revise'
          ? 'This item is approved: saving voids the approval, unschedules its placements and sends it back to review.'
          : undefined
      }
    >
      <form action={addVersionAction} className="el-stack">
        <input type="hidden" name="itemId" value={d.item.id} />
        <Field id="v-title" label="Title">
          <TextInput
            id="v-title"
            name="title"
            defaultValue={d.currentVersion?.title ?? d.item.title}
          />
        </Field>
        <Field id="v-body" label="Copy / script / caption">
          <TextArea id="v-body" name="body" rows={8} defaultValue={d.currentVersion?.body ?? ''} />
        </Field>
        <Checkbox
          name="showsStudents"
          label="Shows students on camera"
          defaultChecked={d.currentVersion?.showsStudents ?? false}
        />
        <Field
          id="v-consent"
          label="Consent reference"
          hint="Evidence reference only (e.g. a form number) — never personal data (OD-008)."
        >
          <TextInput
            id="v-consent"
            name="consentReference"
            defaultValue={d.currentVersion?.consentReference ?? ''}
          />
        </Field>
        <fieldset>
          <legend>Asset reference (file metadata only; nothing is uploaded)</legend>
          <Field id="a-name" label="File name">
            <TextInput id="a-name" name="assetFileName" />
          </Field>
          <Field id="a-mime" label="MIME type">
            <TextInput id="a-mime" name="assetMimeType" placeholder="video/mp4" />
          </Field>
          <Field id="a-url" label="External URL">
            <TextInput id="a-url" name="assetUrl" type="url" />
          </Field>
          <Field id="a-rights" label="Rights">
            <Select id="a-rights" name="assetRights">
              {RIGHTS_STATES.map((r) => (
                <option key={r} value={r}>
                  {r.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox name="assetShowsStudents" label="Asset shows students" />
        </fieldset>
        <Field id="v-note" label="Change note">
          <TextInput id="v-note" name="changeNote" />
        </Field>
        <div>
          <Button type="submit">Save version</Button>
        </div>
      </form>
    </Card>
  );
}

export function RuleCheckPanel({ d, canApprove }: { d: D; canApprove: boolean }) {
  const check = d.ruleCheck;
  if (!check)
    return (
      <Card title="Brand-rule check">
        <EmptyState title="No version to check yet" />
      </Card>
    );
  const reviewing = d.item.state === 'in_review' && d.pendingReview;
  return (
    <Card
      title="Brand-rule check (current version)"
      description="Blocking flags stop approval. Every checklist item must be confirmed by the approver."
    >
      <RuleCheckSummary check={check} />
      {check.blocking.length ? (
        <Alert tone="danger" title="Blocking">
          <ul>
            {check.blocking.map((b) => (
              <li key={b.ruleCode}>
                <strong>{b.ruleCode}</strong> {b.description} — {b.reason}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {check.review.length ? (
        <Alert tone="warning" title="Flagged for review">
          <ul>
            {check.review.map((b) => (
              <li key={b.ruleCode}>
                <strong>{b.ruleCode}</strong> {b.description} — {b.reason}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {reviewing && canApprove ? (
        <form action={decideAction} className="el-stack">
          <input type="hidden" name="itemId" value={d.item.id} />
          <fieldset>
            <legend>Approver checklist</legend>
            {check.checklist.map((c) => (
              <Checkbox
                key={c.ruleCode}
                name="ack"
                value={c.ruleCode}
                label={`${c.ruleCode} — ${c.description}${c.ruleStatus !== 'approved' ? ` (${c.ruleStatus})` : ''}`}
              />
            ))}
          </fieldset>
          <Field id="d-comment" label="Comment (required to request changes)">
            <TextArea id="d-comment" name="comment" rows={2} />
          </Field>
          <div className="el-page-actions">
            <Button type="submit" name="decision" value="approve">
              Approve this version
            </Button>
            <Button type="submit" name="decision" value="request_changes" variant="secondary">
              Request changes
            </Button>
          </div>
        </form>
      ) : (
        <details>
          <summary>Checklist ({check.checklist.length})</summary>
          <ul>
            {check.checklist.map((c) => (
              <li key={c.ruleCode}>
                {c.ruleCode} — {c.description}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export function HistoryPanel({ d }: { d: D }) {
  return (
    <Card
      title="Approval history"
      description="Every request and decision is kept (core approvals); each is bound to a version hash."
    >
      <DataTable
        rows={d.approvals}
        rowKey={(a) => a.id}
        empty={<EmptyState title="No approval requests yet" />}
        columns={[
          {
            key: 'req',
            header: 'Requested',
            render: (a) => `${a.requestedByName ?? '?'} · ${formatIst(a.requestedAt)}`,
          },
          {
            key: 'ver',
            header: 'Version',
            render: (a) =>
              a.review
                ? `${d.versions.find((v) => v.id === a.review!.versionId)?.versionNumber ?? '?'} (${a.review.versionHash.slice(0, 10)})`
                : '—',
          },
          {
            key: 'status',
            header: 'Decision',
            render: (a) => (
              <StatusBadge
                tone={
                  a.status === 'approved'
                    ? 'success'
                    : a.status === 'rejected'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {a.status === 'rejected' ? 'changes requested' : a.status}
              </StatusBadge>
            ),
          },
          {
            key: 'by',
            header: 'By',
            render: (a) =>
              a.decidedByName ? `${a.decidedByName} · ${formatIst(a.decidedAt)}` : '—',
          },
          {
            key: 'comment',
            header: 'Comment',
            render: (a) => a.comment ?? a.requestComment ?? '—',
          },
          {
            key: 'ack',
            header: 'Confirmed checks',
            render: (a) => a.review?.acknowledgedRuleCodes?.join(', ') ?? '—',
          },
        ]}
      />
    </Card>
  );
}

export function PeoplePanel({ d, canWrite }: { d: D; canWrite: boolean }) {
  return (
    <Card title="Assignees and comments">
      <ul>
        {ASSIGNEE_ROLES.map((r) => {
          const a = d.assignments.find((x) => x.role === r);
          return (
            <li key={r}>
              {r}:{' '}
              {a ? (
                (a.userName ?? a.staffName ?? 'assigned')
              ) : (
                <span className="el-field-hint">unassigned</span>
              )}
            </li>
          );
        })}
      </ul>
      {canWrite ? (
        <form action={assignAction} className="el-grid">
          <input type="hidden" name="itemId" value={d.item.id} />
          <Field id="as-role" label="Role">
            <Select id="as-role" name="role">
              {ASSIGNEE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="as-user" label="User id (blank clears)">
            <TextInput id="as-user" name="userId" />
          </Field>
          <div>
            <Button type="submit" variant="secondary">
              Assign
            </Button>
          </div>
        </form>
      ) : null}
      <h3>Comments</h3>
      {d.comments.length === 0 ? (
        <p className="el-field-hint">No comments yet.</p>
      ) : (
        <ul>
          {d.comments.map((c) => (
            <li key={c.id}>
              <strong>{c.authorName ?? '?'}</strong> · {formatIst(c.createdAt)}: {c.body}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form action={commentAction} className="el-stack">
          <input type="hidden" name="itemId" value={d.item.id} />
          <Field id="c-body" label="Add a comment">
            <TextArea id="c-body" name="body" rows={2} required />
          </Field>
          <div>
            <Button type="submit" variant="secondary">
              Comment
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
