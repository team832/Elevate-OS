import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { getLead } from '../../../server/leads';
import { formOptions } from '../../../server/options';
import { fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { BookDemoLink, LEAD_ACTS, LeadActModal, LeadMeta, leadTabs } from '../lead-record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead' };

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ act?: string }>;
}) {
  const { id } = await params;
  const access = await gate('ops:leads:read', `/ops/leads/${id}`);
  const { act: actParam } = await searchParams;
  const act = LEAD_ACTS.find((a) => a === actParam);
  return (
    <Frame access={access} active="leads">
      <Section>
        <LeadDetail user={access.user} id={id} act={act} />
      </Section>
    </Frame>
  );
}

async function LeadDetail({
  user,
  id,
  act,
}: {
  user: AuthenticatedUser;
  id: string;
  act?: (typeof LEAD_ACTS)[number];
}) {
  const r = await load(async (db) =>
    Promise.all([getLead(db, user, id), act ? formOptions(db) : null]),
  );
  if (!r.ok) return r.view;
  const [d, options] = r.data;
  const self = `/ops/leads/${d.lead.id}`;
  return (
    <div className="el-stack">
      <PageHeader
        title={d.lead.studentName}
        meta={<LeadMeta d={d} />}
        description={
          <>
            Received {fmtDateTime(d.lead.firstReceivedAt)} · <a href="/ops/leads">All leads</a>
          </>
        }
        actions={<BookDemoLink d={d} user={user} />}
      />
      {leadTabs(d, user, (a) => `${self}?act=${a}`, 2).map((t) => (
        <div key={t.key} className="el-stack">
          {t.content}
        </div>
      ))}
      {act && options ? (
        <LeadActModal act={act} d={d} options={options} user={user} closeHref={self} />
      ) : null}
    </div>
  );
}
