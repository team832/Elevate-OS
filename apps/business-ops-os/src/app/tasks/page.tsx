import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { ButtonLink, PageHeader } from '@elevate/shared-ui';
import { hasInbox } from '../../server/eod-review';
import { Frame, gate, Section } from '../../ui/frame';
import { listHref } from '../../ui/list-controls';
import { TasksNav } from './_components/eod-nav';
import { EodReport } from './_components/eod-views';
import { AllTasks, BASE, MyDay, type Params } from './_components/task-views';

export const dynamic = 'force-dynamic';

const VIEWS = { day: MyDay, all: AllTasks, eod: EodReport };
const LABELS = { day: 'My day', all: 'Task tracker', eod: 'End-of-day report' };
const DESCRIPTIONS = {
  day: 'Log work as it comes in and keep each task up to date.',
  all: 'Every task you may see, with filters.',
  eod: 'Your report for a day, built from your task history. Add your notes and submit it to your manager.',
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:tasks:read', BASE);
  const sp = await searchParams;
  const tab = (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).find((k) => k === sp.tab) ?? 'day';
  const View = VIEWS[tab];
  const inbox = await hasInbox(getDb(), access.user).catch(() => false);
  return (
    <Frame access={access} active="tasks">
      <PageHeader
        title={LABELS[tab]}
        description={DESCRIPTIONS[tab]}
        tabs={<TasksNav user={access.user} current={tab} inbox={inbox} />}
        actions={
          tab === 'day' && can(access.user, 'ops:tasks:write') ? (
            <ButtonLink variant="primary" href={listHref(BASE, sp, { new: '1', open: undefined })}>
              Log a task
            </ButtonLink>
          ) : undefined
        }
      />
      <Section>
        <View user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}
