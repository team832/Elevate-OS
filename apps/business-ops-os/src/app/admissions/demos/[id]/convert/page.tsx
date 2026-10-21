/** Convert to admission, full page: the deep link and no-JavaScript fallback of the pop-up. */
import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { AdmissionsNav } from '../../../../../ui/admissions-nav';
import { Frame, gate, Section } from '../../../../../ui/frame';
import { ConvertForm, loadConversion } from './convert-form';
import '../../../admissions.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Convert to admission' };

export default async function ConvertDemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:admissions:convert', `/ops/admissions/demos/${id}/convert`);
  return (
    <Frame access={access} active="admissions">
      <Section label="Loading conversion details…">
        <Convert user={access.user} demoId={id} />
      </Section>
    </Frame>
  );
}

async function Convert({ user, demoId }: { user: AuthenticatedUser; demoId: string }) {
  const r = await loadConversion(user, demoId);
  const back = `/ops/admissions/demos/${demoId}`;
  const header = (meta?: string) => (
    <PageHeader
      title="Convert to admission"
      meta={meta}
      description={
        <>
          Opens a draft application; nobody is admitted here. <a href={back}>Back to the demo</a>
        </>
      }
      tabs={<AdmissionsNav current="demos" user={user} />}
    />
  );
  if (!r.ok)
    return (
      <>
        {header()}
        {r.view}
      </>
    );
  return (
    <>
      {header(r.data.d.student.fullName)}
      <div className="el-stack ops-admissions-form">
        <ConvertForm data={r.data} demoId={demoId} level={2} cancelHref={back} />
      </div>
    </>
  );
}
