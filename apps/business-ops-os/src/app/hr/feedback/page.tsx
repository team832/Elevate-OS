import { can } from '@elevate/authorization';
import { ButtonLink, PageHeader, Subnav } from '@elevate/shared-ui';
import { feedbackScope } from '../../../server/feedback-access';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { ActionsTab } from './_components/actions-tab';
import { ImportsTab } from './_components/imports-tab';
import { ResponsesTab } from './_components/responses-tab';
import { SummariesTab } from './_components/summaries-tab';
import { BASE, type Params } from './_components/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student feedback about teachers' };

const TABS = {
  responses: ['Responses', ResponsesTab],
  imports: ['Imports', ImportsTab],
  summaries: ['Summaries', SummariesTab],
  actions: ['Development actions', ActionsTab],
} as const;

/** /ops/hr/feedback — HR's student feedback about teachers (brief 23 Oct 2026 §15). */
export default async function HrFeedbackPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:teacher_feedback:read', BASE);
  const params = await searchParams;
  const tab = (params.tab && params.tab in TABS ? params.tab : 'responses') as keyof typeof TABS;
  const Tab = TABS[tab][1];
  const manage = can(access.user, 'ops:teacher_feedback:manage');
  // HR staff who teach see why instead of the tabs (round 7).
  const allowed = await load((db) => feedbackScope(db, access.user, 'ops:teacher_feedback:read'));
  if (!allowed.ok)
    return (
      <Frame access={access} active="hr-feedback">
        <PageHeader title="Student feedback about teachers" />
        {allowed.view}
      </Frame>
    );
  return (
    <Frame access={access} active="hr-feedback">
      <PageHeader
        title="Student feedback about teachers"
        description="Responses from students and guardians, imported files, HR's summaries and the follow-ups agreed with each teacher."
        actions={
          manage && tab === 'responses' ? (
            <ButtonLink href={listHref(BASE, { tab }, { record: 'new' })}>
              Record feedback
            </ButtonLink>
          ) : null
        }
        tabs={
          <Subnav
            label="Feedback areas"
            items={Object.entries(TABS).map(([k, [label]]) => [`${BASE}?tab=${k}`, label] as const)}
            current={`${BASE}?tab=${tab}`}
          />
        }
      />
      <Section label="Loading feedback…">
        <Tab user={access.user} params={{ ...params, tab }} />
      </Section>
    </Frame>
  );
}
