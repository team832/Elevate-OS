/** Placements of a content item with scheduling and publishing actions (server component). */
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Select,
  TextInput,
} from '@elevate/shared-ui';
import { formatIst } from '../domain';
import type { ContentItemDetail } from '../server';
import { createPlacementAction } from '../app/actions/content';
import {
  cancelPlacementAction,
  manualPublicationAction,
  publishAction,
  scheduleAction,
  unscheduleAction,
} from '../app/actions/placements';
import { PlacementBadge } from './badges';

export interface PlacementPermissions {
  write: boolean;
  schedule: boolean;
  publish: boolean;
}

export function PlacementPanel({
  d,
  accounts,
  can,
}: {
  d: ContentItemDetail;
  accounts: { code: string; platform: string; status: string }[];
  can: PlacementPermissions;
}) {
  const returnTo = `content/${d.item.id}`;
  const hidden = (id: string) => (
    <>
      <input type="hidden" name="placementId" value={id} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );
  return (
    <Card
      title={`Placements (${d.placements.length})`}
      description="One placement per account (code <IDEA>-<ACCOUNT>). Only approved, scheduled placements can publish; the mock adapter posts nothing."
    >
      <Alert tone="info">
        Publishing uses the mock adapter: a “sandbox” result means nothing was posted and there is
        no URL. Record a real post with its live link instead.
      </Alert>
      <DataTable
        rows={d.placements}
        rowKey={(p) => p.id}
        empty={<EmptyState title="Not placed on any account yet" />}
        columns={[
          { key: 'code', header: 'Placement', render: (p) => p.code ?? p.legacyCode },
          {
            key: 'status',
            header: 'Status',
            render: (p) => <PlacementBadge status={p.status} mode={p.publicationMode} />,
          },
          {
            key: 'time',
            header: 'Time (IST)',
            render: (p) => (
              <>
                {formatIst(p.publishedAt ?? p.scheduledAt)}
                {p.originalPublishAt ? (
                  <div className="el-field-hint">original: {formatIst(p.originalPublishAt)}</div>
                ) : null}
                {p.publishedUrl ? (
                  <div>
                    <a href={p.publishedUrl}>live link</a>
                  </div>
                ) : null}
              </>
            ),
          },
          {
            key: 'records',
            header: 'Publishing records',
            render: (p) =>
              p.publishingRecords.length === 0 ? (
                '—'
              ) : (
                <ul>
                  {p.publishingRecords.map((r) => (
                    <li key={r.id}>
                      {r.adapter} · {r.status} · attempts {r.attempts}/{r.maxAttempts}
                      {r.isSandbox ? ' · sandbox (no post, no URL)' : ''}
                      {r.lastError ? <div className="el-field-error">{r.lastError}</div> : null}
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (p) => (
              <div className="el-stack">
                {can.schedule && (p.status === 'planned' || p.status === 'scheduled') ? (
                  <form action={scheduleAction}>
                    {hidden(p.id)}
                    <TextInput
                      type="datetime-local"
                      name="publishAt"
                      aria-label="Publish at (IST)"
                      required
                    />
                    <Button type="submit" variant="secondary">
                      {p.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
                    </Button>
                  </form>
                ) : null}
                {can.schedule && p.status === 'scheduled' ? (
                  <form action={unscheduleAction}>
                    {hidden(p.id)}
                    <Button type="submit" variant="ghost">
                      Unschedule
                    </Button>
                  </form>
                ) : null}
                {can.publish && p.status === 'scheduled' ? (
                  <>
                    <form action={publishAction}>
                      {hidden(p.id)}
                      <Button type="submit">Publish (sandbox)</Button>
                    </form>
                    <form action={manualPublicationAction}>
                      {hidden(p.id)}
                      <TextInput
                        type="datetime-local"
                        name="publishedAt"
                        aria-label="Actual publish time (IST)"
                        required
                      />
                      <TextInput
                        type="url"
                        name="url"
                        placeholder="Live link"
                        aria-label="Live link"
                        required
                      />
                      <Button type="submit" variant="secondary">
                        Record real publication
                      </Button>
                    </form>
                  </>
                ) : null}
                {(p.status === 'planned' && can.write) ||
                (p.status === 'scheduled' && can.schedule) ? (
                  <form action={cancelPlacementAction}>
                    {hidden(p.id)}
                    <TextInput
                      name="reason"
                      placeholder="Reason"
                      aria-label="Cancel reason"
                      required
                    />
                    <Button type="submit" variant="danger">
                      Cancel
                    </Button>
                  </form>
                ) : null}
              </div>
            ),
          },
        ]}
      />
      {can.write && d.item.state !== 'archived' ? (
        <form action={createPlacementAction} className="el-grid">
          <input type="hidden" name="itemId" value={d.item.id} />
          <Field id="pl-account" label="Place on account">
            <Select id="pl-account" name="accountCode">
              {accounts
                .filter((a) => a.status === 'live' || a.status === 'starting')
                .map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} ({a.platform})
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="pl-variant" label="YouTube variant">
            <Select id="pl-variant" name="variant">
              <option value="">none</option>
              <option value="short">Short (S)</option>
              <option value="long">Long (L)</option>
            </Select>
          </Field>
          <div>
            <Button type="submit" variant="secondary">
              Plan placement
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
