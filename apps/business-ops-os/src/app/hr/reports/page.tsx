import { PageHeader, Subnav } from '@elevate/shared-ui';
import { Frame, gate, Section } from '../../../ui/frame';
import { BASE, ByPeriod, Summary } from './hr-reports-body';
import { Waiting } from './waiting';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Work reports' };

/** `/ops/hr/reports` (brief 23 Oct 2026 §6, §13–14): who has reported, and figures per person. */
export default async function WorkReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:work_reports:read', BASE);
  const sp = await searchParams;
  const view = sp.view === 'summary' || sp.view === 'waiting' ? sp.view : 'period';
  return (
    <Frame access={access} active="hr-reports">
      <PageHeader
        title="Work reports"
        description="End-of-day, weekly and monthly reports of the staff HR manages, and their work figures side by side."
        tabs={
          <Subnav
            label="Work report views"
            items={[
              [`${BASE}?view=period`, 'By period'],
              [`${BASE}?view=summary`, 'Figures by person'],
              [`${BASE}?view=waiting`, 'Waiting for review'],
            ]}
            current={`${BASE}?view=${view}`}
          />
        }
      />
      <Section label="Loading reports…">
        {view === 'summary' ? (
          <Summary user={access.user} sp={sp} />
        ) : view === 'waiting' ? (
          <Waiting user={access.user} sp={sp} />
        ) : (
          <ByPeriod user={access.user} sp={sp} />
        )}
      </Section>
    </Frame>
  );
}
