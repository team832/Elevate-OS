import { can } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { ButtonLink, PageHeader, StatusBadge } from '@elevate/shared-ui';
import type { KpiWindow } from '../domain';
import { buildOverview, rangeOf } from '../server/overview';
import { fmtDate } from '../ui/format';
import { Frame, gate, load, Section } from '../ui/frame';
import { RangeFilter } from './_components/range-filter';
import { OverviewBlocks } from './_components/overview-blocks';
import { Today } from './_components/today';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };

type Params = { from?: string; to?: string };

/**
 * /ops — Overview (owner brief 22 Oct 2026 §5): headline tiles, charts and figures for the period,
 * each block only with its permission (checked on the server), then the person's own work today.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:module:access', '/ops');
  const at = rangeOf(await searchParams);
  const user = access.user;
  return (
    <Frame access={access} active="home">
      <PageHeader
        title="Overview"
        meta={
          <StatusBadge tone="neutral">
            {fmtDate(at.range.from)} – {fmtDate(at.range.to)}
          </StatusBadge>
        }
        description="Admissions, money, teaching and team figures for the period, then your work today."
        actions={
          <>
            {can(user, 'ops:tasks:write') ? (
              <ButtonLink variant="primary" href="/ops/tasks?new=1">
                Log a task
              </ButtonLink>
            ) : null}
            {can(user, 'ops:leads:write') ? (
              <ButtonLink variant="secondary" href="/ops/admissions?new=1">
                Book a demo
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="el-stack">
        <RangeFilter base="/ops" at={at} />
        <Section label="Loading the overview…">
          <Blocks user={user} range={at.range} />
        </Section>
        <h2>Your work today</h2>
        <Section label="Loading today…">
          <Today user={user} />
        </Section>
      </div>
    </Frame>
  );
}

async function Blocks({ user, range }: { user: AuthenticatedUser; range: KpiWindow }) {
  const r = await load((db) => buildOverview(db, user, range));
  return r.ok ? <OverviewBlocks o={r.data} /> : r.view;
}
