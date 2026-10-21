/** Full demo record (owner brief §5.1 deep link): the pop-up's sections, stacked. */
import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { AdmissionsNav } from '../../../../ui/admissions-nav';
import { Frame, gate, Section } from '../../../../ui/frame';
import {
  DemoActions,
  DemoJourney,
  DemoMeta,
  demoSections,
  loadDemoRecord,
} from '../../_components/demo-record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Demo student' };

export default async function DemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:leads:read', `/ops/admissions/demos/${id}`);
  return (
    <Frame access={access} active="admissions">
      <Section label="Loading demo…">
        <Record user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Record({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await loadDemoRecord(user, id);
  const tabs = <AdmissionsNav current="demos" user={user} />;
  if (!r.ok)
    return (
      <>
        <PageHeader title="Demo student" tabs={tabs} />
        {r.view}
      </>
    );
  const { d, options } = r.data;
  return (
    <>
      <PageHeader
        title={d.studentName}
        meta={<DemoMeta d={d} />}
        description={<a href="/ops/admissions">Back to demo students</a>}
        actions={
          <DemoActions d={d} user={user} convertHref={`/ops/admissions/demos/${id}/convert`} />
        }
        tabs={tabs}
      />
      <div className="el-stack">
        <DemoJourney d={d} />
        {demoSections({ d, user, options, level: 2 }).map((t) => (
          <div key={t.key} className="el-stack">
            {t.content}
          </div>
        ))}
      </div>
    </>
  );
}
