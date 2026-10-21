import { can } from '@elevate/authorization';
import { ButtonLink, PageHeader, Tabs } from '@elevate/shared-ui';
import { Frame, gate, Section } from '../../ui/frame';
import { listHref } from '../../ui/list-controls';
import { EodReport, ReportModal, TeamReports } from './_components/eod-views';
import { AllTasks, BASE, MyDay, type Params } from './_components/task-views';

export const dynamic = 'force-dynamic';

const VIEWS = { day: MyDay, all: AllTasks, eod: EodReport, team: TeamReports };
const LABELS = { day: 'My day', all: 'All tasks', eod: 'End-of-day report', team: 'Team reports' };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:tasks:read', BASE);
  const sp = await searchParams;
  const keys = (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).filter(
    (k) => k !== 'team' || can(access.user, 'ops:eod:review'),
  );
  const tab = keys.find((k) => k === sp.tab) ?? 'day';
  const View = VIEWS[tab];
  return (
    <Frame access={access} active="tasks">
      <PageHeader
        title={LABELS[tab]}
        description="Log work as it comes in; send your end-of-day report to your manager."
        actions={
          tab === 'day' && can(access.user, 'ops:tasks:write') ? (
            <ButtonLink variant="primary" href={listHref(BASE, sp, { new: '1', open: undefined })}>
              Log a task
            </ButtonLink>
          ) : undefined
        }
      />
      <Tabs
        idBase="tasks"
        label="Task views"
        selected={tab}
        items={keys.map((k) => ({
          key: k,
          label: LABELS[k],
          href: listHref(BASE, {}, { tab: k === 'day' ? undefined : k }),
        }))}
      >
        <Section>
          <View user={access.user} sp={sp} />
          {sp.report ? <ReportModal user={access.user} id={sp.report} sp={sp} /> : null}
        </Section>
      </Tabs>
    </Frame>
  );
}
