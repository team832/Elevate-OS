import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Button, Card, ErrorState, Field, TextInput } from '@elevate/shared-ui';
import { modulePath } from '../../../domain';
import { getContentItemDetail, listAccounts } from '../../../server';
import { archiveAction, submitAction, withdrawAction } from '../../actions/content';
import { ContentStateBadge } from '../../../ui/badges';
import {
  EditPanel,
  HistoryPanel,
  PeoplePanel,
  RuleCheckPanel,
  VersionsPanel,
} from '../../../ui/content-panels';
import { PlacementPanel } from '../../../ui/placement-panel';
import { MarketingPage, Section, type SearchParams } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Content item' };

export default async function ContentItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  return (
    <MarketingPage
      permission="marketing:content:read"
      path={modulePath(`content/${id}`)}
      active="calendar"
      title="Content item"
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            if (!/^[0-9a-f-]{36}$/i.test(id)) return <ErrorState title="Content item not found" />;
            const db = getDb();
            const d = await getContentItemDetail(db, id);
            const accounts = await listAccounts(db);
            const write = can(user, 'marketing:content:write');
            const approve = can(user, 'marketing:content:approve');
            const { item } = d;
            return (
              <div className="el-stack">
                <Card
                  title={item.title}
                  description={
                    <>
                      Idea{' '}
                      {d.idea ? (
                        <a href={modulePath(`ideas/${d.idea.id}`)}>
                          {d.idea.code ?? d.idea.legacyCode}
                        </a>
                      ) : (
                        '—'
                      )}{' '}
                      · {item.format.replace('_', ' ')} · <ContentStateBadge state={item.state} />
                    </>
                  }
                >
                  {item.holdReason ? (
                    <Alert tone="warning" title="On hold">
                      {item.holdReason}
                    </Alert>
                  ) : null}
                  {item.legacyStatus ? (
                    <Alert tone="info" title="Imported from the legacy tracker">
                      Legacy status “{item.legacyStatus}”, format “{item.legacyFormat}”. There is no
                      approval record in Elevate OS for imported states; anything still to be
                      scheduled or published must be approved here first.
                    </Alert>
                  ) : null}
                  {item.state === 'in_review' && !d.pendingReview ? (
                    <Alert tone="warning">
                      No open approval request (imported state). Withdraw to draft and submit again.
                    </Alert>
                  ) : null}
                  <div className="el-page-actions">
                    {write && d.allowedActions.includes('submit') ? (
                      <form action={submitAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <Button type="submit">Submit for review</Button>
                      </form>
                    ) : null}
                    {write && d.allowedActions.includes('withdraw') ? (
                      <form action={withdrawAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <Button type="submit" variant="secondary">
                          Withdraw to draft
                        </Button>
                      </form>
                    ) : null}
                    {write && d.allowedActions.includes('archive') ? (
                      <form action={archiveAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <Field id="arch" label="Archive reason">
                          <TextInput id="arch" name="reason" required minLength={3} />
                        </Field>
                        <Button type="submit" variant="danger">
                          Archive
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </Card>
                <RuleCheckPanel d={d} canApprove={approve} />
                <VersionsPanel d={d} />
                {write ? <EditPanel d={d} /> : null}
                <PlacementPanel
                  d={d}
                  accounts={accounts}
                  can={{
                    write,
                    schedule: can(user, 'marketing:schedule:manage'),
                    publish: can(user, 'marketing:content:publish'),
                  }}
                />
                <HistoryPanel d={d} />
                <PeoplePanel d={d} canWrite={write || approve} />
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
