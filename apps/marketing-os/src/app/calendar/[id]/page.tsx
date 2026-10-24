import { Fragment, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { can, scopeFor } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Button, Card, ErrorState, Field, TextArea, TextInput } from '@elevate/shared-ui';
import {
  CALENDAR_ACTION_TEXT,
  CHANNEL_LABELS,
  ITEM_TYPE_LABELS,
  calendarActionsFrom,
  calendarEditable,
  calendarMovable,
  calendarStates,
  type CalendarAction,
} from '../../../domain/calendar';
import { formatIst, modulePath } from '../../../domain';
import {
  CALENDAR_ACTION_PERMISSION,
  calendarOptions,
  getCalendarItem,
  isCreatorOrOwner,
  isOwnCalendarItem,
} from '../../../server/calendar';
import { MarketingPage, Section, type SearchParams } from '../../../ui/shell';
import { createTaskAction, itemStepAction, moveItemAction, updateItemAction } from '../actions';
import { CalendarStatusBadge, ItemFields, SampleBadge, istInput } from '../item-ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Calendar item' };

/** Inputs a step needs besides the button. */
const STEP_FIELDS: Partial<Record<CalendarAction, ReactNode>> = {
  request_changes: (
    <Field id="note" label="What needs to change">
      <TextArea id="note" name="note" rows={2} required minLength={3} maxLength={1000} />
    </Field>
  ),
  publish: (
    <>
      <Field
        id="url"
        label="Live link"
        hint="Or describe the evidence below when there is no link."
      >
        <TextInput id="url" name="url" type="url" placeholder="https://" />
      </Field>
      <Field id="evidence" label="Evidence of publication">
        <TextArea id="evidence" name="evidence" rows={2} maxLength={2000} />
      </Field>
      <Field id="publishedAt" label="Published at (IST)" hint="Leave empty for now.">
        <TextInput id="publishedAt" name="publishedAt" type="datetime-local" />
      </Field>
    </>
  ),
  cancel: (
    <Field id="reason" label="Reason for cancelling">
      <TextInput id="reason" name="reason" required minLength={3} maxLength={500} />
    </Field>
  ),
};

export default async function CalendarItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  return (
    <MarketingPage
      permission="marketing:calendar:read"
      path={modulePath(`calendar/${id}`)}
      active="calendar"
      title="Calendar item"
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            if (!/^[0-9a-f-]{36}$/i.test(id))
              return (
                <ErrorState
                  title="Calendar item not found"
                  description="That address is not a valid item."
                />
              );
            const db = getDb();
            const item = await getCalendarItem(db, id);
            const own = await isOwnCalendarItem(db, user, item);
            const involved = await isCreatorOrOwner(db, user, item);
            const writable =
              can(user, 'marketing:calendar:write') &&
              (own || scopeFor(user, 'marketing:calendar:write') === 'all');
            const steps = calendarActionsFrom(item.status).filter((a) => {
              const perm = CALENDAR_ACTION_PERMISSION[a];
              if (!can(user, perm)) return false;
              if (perm === 'marketing:calendar:write') return writable;
              return !(involved && (a === 'approve' || a === 'request_changes'));
            });
            const states = calendarStates(item.status);
            const hidden = <input type="hidden" name="itemId" value={item.id} />;
            const facts: [string, ReactNode][] = [
              ['Type', ITEM_TYPE_LABELS[item.itemType]],
              ['Status', <CalendarStatusBadge key="s" status={item.status} />],
              ['Review', states.review],
              ['Publication', states.publication],
              ['Planned for', formatIst(item.plannedAt)],
              ['Originally planned', formatIst(item.originalPlannedAt)],
              ['Course', item.programmeName ?? 'Not tied to one course'],
              ['Audience', item.audience ?? 'Not recorded'],
              ['Channel', item.channel ? CHANNEL_LABELS[item.channel] : 'Not decided'],
              [
                'Campaign',
                item.campaignCode ? `${item.campaignCode} · ${item.campaignName}` : 'No campaign',
              ],
              ['Owner', item.ownerName ?? 'No owner'],
              ['Brief', item.brief ?? 'Not written yet'],
              [
                'Asset links',
                item.assetLinks.length ? (
                  <ul key="a">
                    {item.assetLinks.map((l) => (
                      <li key={l}>
                        <a href={l} rel="noreferrer noopener" target="_blank">
                          {l}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  'None'
                ),
              ],
              [
                'Related HR task',
                item.relatedTaskId ? (
                  <a key="t" href={modulePath(`tasks/${item.relatedTaskId}`)}>
                    Open the task
                  </a>
                ) : (
                  'None'
                ),
              ],
              [
                'From idea',
                item.ideaId ? (
                  <a key="i" href={modulePath(`ideas/${item.ideaId}`)}>
                    {item.ideaCode ?? 'Open the idea'}
                  </a>
                ) : (
                  'Not from an idea'
                ),
              ],
              ['Review note', item.reviewNote ?? '—'],
              ['Approved', item.approvedAt ? formatIst(item.approvedAt) : 'Not approved'],
              ['Published at', item.publishedAt ? formatIst(item.publishedAt) : 'Not published'],
              [
                'Live link',
                item.publishedUrl ? (
                  <a key="u" href={item.publishedUrl} rel="noreferrer noopener" target="_blank">
                    {item.publishedUrl}
                  </a>
                ) : (
                  '—'
                ),
              ],
              ['Evidence', item.publicationEvidence ?? '—'],
              ...(item.cancelledReason
                ? [['Cancelled because', item.cancelledReason] as [string, ReactNode]]
                : []),
            ];
            return (
              <div className="el-stack">
                <Card title={item.title} meta={<SampleBadge sample={item.isSample} />}>
                  <dl className="mkt-facts">
                    {facts.map(([k, v]) => (
                      <Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </Card>
                {steps.length ? (
                  <Card
                    title="Next steps"
                    description="Approving does not publish. Marking published records a publication that already happened; nothing is posted from here."
                  >
                    <div className="el-stack">
                      {steps.map((step, i) => (
                        <form key={step} action={itemStepAction} className="el-stack">
                          {hidden}
                          <input type="hidden" name="step" value={step} />
                          {step === 'plan' && !item.plannedAt ? (
                            <Field id="plan-at" label="Planned date and time (IST)">
                              <TextInput
                                id="plan-at"
                                name="plannedAt"
                                type="datetime-local"
                                required
                              />
                            </Field>
                          ) : null}
                          {STEP_FIELDS[step] ?? null}
                          <div>
                            <Button type="submit" variant={i === 0 ? 'primary' : 'secondary'}>
                              {CALENDAR_ACTION_TEXT[step].button}
                            </Button>
                          </div>
                        </form>
                      ))}
                    </div>
                  </Card>
                ) : null}
                {can(user, 'marketing:schedule:manage') && calendarMovable(item.status) ? (
                  <Card
                    title="Move to another date"
                    description="The original planned date stays on the item and the move is recorded."
                  >
                    <form action={moveItemAction} className="el-inline-form">
                      {hidden}
                      <Field id="move-at" label="New date and time (IST)">
                        <TextInput
                          id="move-at"
                          name="plannedAt"
                          type="datetime-local"
                          required
                          defaultValue={istInput(item.plannedAt)}
                        />
                      </Field>
                      <Button type="submit" variant="secondary">
                        Move item
                      </Button>
                    </form>
                  </Card>
                ) : null}
                {writable &&
                !item.relatedTaskId &&
                calendarMovable(item.status) &&
                can(user, 'ops:tasks:write') ? (
                  <form action={createTaskAction}>
                    {hidden}
                    <Button type="submit" variant="secondary">
                      Create a task for the owner
                    </Button>
                  </form>
                ) : null}
                {writable && calendarEditable(item.status) ? (
                  <details className="el-explain">
                    <summary>Edit details</summary>
                    <form action={updateItemAction} className="el-stack">
                      {hidden}
                      <ItemFields options={await calendarOptions(db)} item={item} />
                      <div>
                        <Button type="submit">Save changes</Button>
                      </div>
                    </form>
                  </details>
                ) : null}
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
