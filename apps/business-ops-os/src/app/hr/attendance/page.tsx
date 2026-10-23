/**
 * /ops/hr/attendance (owner brief 23 Oct 2026 §12): staff days by date, what needs review,
 * correction requests, schedules, holidays and leave, and punch file imports. Everyone's
 * attendance (ops:attendance:read, all scope); changes need ops:attendance:manage.
 */
import { can, type Principal } from '@elevate/authorization';
import { PageHeader, Subnav } from '@elevate/shared-ui';
import { listAttendance } from '../../../server/attendance';
import { attendanceListQuery, correctionListQuery } from '../../../server/attendance-schemas';
import { listCorrections } from '../../../server/attendance-corrections';
import { getPunchImport, listPunchImports } from '../../../server/attendance-import';
import { aiBlocked } from '../../../server/ai-drafts';
import { attendanceSetup } from '../../../server/attendance-lists';
import { ActionForm } from '../../../ui/action-form';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager } from '../../../ui/list-controls';
import { API, BASE, DaysTab } from './_components/days';
import { ImportTab } from './_components/import';
import { CalendarTab, SchedulesTab } from './_components/setup';
import { CorrectionsTable, Legend } from './_components/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Attendance' };

type Params = Record<string, string | undefined>;
const TABS = [
  ['', 'Days'],
  ['review', 'Needs review'],
  ['corrections', 'Corrections'],
  ['schedules', 'Schedules'],
  ['calendar', 'Holidays and leave'],
  ['import', 'Import punches'],
] as const;

export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('ops:attendance:read', BASE);
  const params = await searchParams;
  return (
    <Frame access={access} active="hr-attendance">
      <Section label="Loading attendance…">
        <HrAttendance user={access.user} params={params} />
      </Section>
    </Frame>
  );
}

async function HrAttendance({ user, params }: { user: Principal; params: Params }) {
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab! : '';
  const canManage = can(user, 'ops:attendance:manage');
  const result = await load(async (db) => {
    const setup = await attendanceSetup(db, user);
    const raw = { ...params, review: tab === 'review' ? (params.review ?? '1') : undefined };
    const query =
      attendanceListQuery.safeParse(raw).data ?? attendanceListQuery.parse({ review: raw.review });
    return {
      setup,
      list: tab === '' || tab === 'review' ? await listAttendance(db, user, query) : null,
      corrections:
        tab === 'corrections'
          ? await listCorrections(
              db,
              user,
              correctionListQuery.safeParse({
                status: params.status ?? 'pending',
                page: params.page,
              }).data ?? {
                status: 'pending',
              },
            )
          : null,
      imports: tab === 'import' && canManage ? await listPunchImports(db, user) : [],
      preview:
        tab === 'import' && canManage && params.import
          ? await getPunchImport(db, user, params.import)
          : null,
      ai: tab === 'import' && canManage ? await aiBlocked(db, user, 'csvMapping') : null,
    };
  });
  const header = (
    <PageHeader
      title="Attendance"
      description="Staff check-ins and check-outs, daily status and HR decisions. Separate from classes taught."
      tabs={
        <Subnav
          label="Attendance views"
          items={TABS.filter(([k]) => canManage || k !== 'import').map(([k, label]) => [
            listHref(BASE, { tab: k || undefined }),
            label,
          ])}
          current={listHref(BASE, { tab: tab || undefined })}
        />
      }
    />
  );
  if (!result.ok)
    return (
      <>
        {header}
        {result.view}
      </>
    );
  const { setup, list, corrections, imports, preview, ai } = result.data;
  return (
    <>
      {header}
      <Legend />
      {list ? (
        <DaysTab
          list={list}
          setup={setup}
          params={params}
          review={tab === 'review'}
          canManage={canManage}
        />
      ) : null}
      {corrections ? (
        <>
          <Subnav
            label="Correction requests by decision"
            items={[
              [listHref(BASE, { tab: 'corrections' }), 'Waiting for HR'],
              [listHref(BASE, { tab: 'corrections', status: 'approved' }), 'Approved'],
              [listHref(BASE, { tab: 'corrections', status: 'rejected' }), 'Rejected'],
            ]}
            current={listHref(BASE, { tab: 'corrections', status: params.status })}
          />
          <CorrectionsTable
            staff
            rows={corrections.items}
            empty="No correction requests here."
            actions={
              canManage
                ? (c) =>
                    c.status === 'pending' ? (
                      <>
                        <ActionForm
                          action={`${API}/corrections/${c.id}`}
                          extra={{ decision: 'approved' }}
                          submitLabel="Approve"
                          successText="Approved."
                          labelSuffix={` — ${c.staffName}, ${c.workDate}`}
                          compact
                        />
                        <details>
                          <summary>Reject</summary>
                          <ActionForm
                            action={`${API}/corrections/${c.id}`}
                            extra={{ decision: 'rejected' }}
                            submitLabel="Reject request"
                            variant="danger"
                            labelSuffix={` — ${c.staffName}, ${c.workDate}`}
                            fields={[
                              {
                                name: 'note',
                                label: 'Why (shown to the employee)',
                                type: 'textarea',
                                required: true,
                              },
                            ]}
                          />
                        </details>
                      </>
                    ) : null
                : undefined
            }
          />
          <Pager
            basePath={BASE}
            params={params}
            page={corrections.page}
            pageSize={corrections.pageSize}
            total={corrections.total}
          />
        </>
      ) : null}
      {tab === 'schedules' ? <SchedulesTab setup={setup} canManage={canManage} /> : null}
      {tab === 'calendar' ? (
        <CalendarTab
          setup={setup}
          canManage={canManage}
          canDecideHolidays={can(user, 'ops:hr_settings:manage')}
        />
      ) : null}
      {tab === 'import' && canManage ? (
        <ImportTab imports={imports} preview={preview} ai={ai} />
      ) : null}
    </>
  );
}
