import { getDb } from '@elevate/database';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  StatusBadge,
  TextInput,
} from '@elevate/shared-ui';
import { addDays, isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import { formatIst, istDate, istMidnightUtc, modulePath } from '../../domain';
import { listCalendar, listPlannedPlacements } from '../../server';
import { ContentStateBadge, PlacementBadge } from '../../ui/badges';
import { MarketingPage, Section, param, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const fromRaw = param(sp, 'from');
  const from = (fromRaw && isIsoDate(fromRaw) ? fromRaw : toIsoDate()) as IsoDate;
  const toRaw = param(sp, 'to');
  let to = (toRaw && isIsoDate(toRaw) ? toRaw : addDays(from, 13)) as IsoDate;
  if (to < from || addDays(from, 62) < to) to = addDays(from, 13);
  const account = param(sp, 'account')?.toUpperCase();
  return (
    <MarketingPage
      permission="marketing:content:read"
      path={modulePath('calendar')}
      active="calendar"
      title="Calendar"
      description="Scheduled and published placements by IST date and account. Hard conflicts block scheduling; warnings are shown here and when scheduling."
      searchParams={sp}
    >
      {() => (
        <Section
          load={async () => {
            const db = getDb();
            const rows = await listCalendar(db, {
              from: istMidnightUtc(from),
              to: istMidnightUtc(addDays(to, 1)),
              accountCode: account,
            });
            const planned = await listPlannedPlacements(db);
            const byDay = new Map<string, typeof rows>();
            for (const r of rows) {
              const day = istDate(
                (r.status === 'published' ? r.publishedAt : r.scheduledAt) ?? new Date(0),
              );
              byDay.set(day, [...(byDay.get(day) ?? []), r]);
            }
            const conflictCount = rows.filter(
              (r) => r.conflicts.hard.length || r.conflicts.warnings.length,
            ).length;
            return (
              <div className="el-stack">
                <form method="get" className="el-grid">
                  <Field id="from" label="From (IST)">
                    <TextInput id="from" name="from" type="date" defaultValue={from} />
                  </Field>
                  <Field id="to" label="To (IST, max 62 days)">
                    <TextInput id="to" name="to" type="date" defaultValue={to} />
                  </Field>
                  <Field id="account" label="Account code">
                    <TextInput id="account" name="account" defaultValue={account ?? ''} />
                  </Field>
                  <div>
                    <Button type="submit" variant="secondary">
                      Show
                    </Button>
                  </div>
                </form>
                {conflictCount ? (
                  <Alert tone="warning">
                    {conflictCount} placement(s) in this window have conflicts.
                  </Alert>
                ) : null}
                {rows.length === 0 ? (
                  <EmptyState
                    title="Nothing scheduled or published in this window"
                    description={`${from} to ${to} (IST).`}
                  />
                ) : (
                  [...byDay.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([day, list]) => (
                      <Card key={day} title={day}>
                        <DataTable
                          rows={list}
                          rowKey={(r) => r.id}
                          columns={[
                            {
                              key: 'time',
                              header: 'Time',
                              render: (r) =>
                                formatIst(r.status === 'published' ? r.publishedAt : r.scheduledAt),
                            },
                            { key: 'account', header: 'Account', render: (r) => r.accountCode },
                            {
                              key: 'code',
                              header: 'Placement',
                              render: (r) =>
                                r.contentItemId ? (
                                  <a href={modulePath(`content/${r.contentItemId}`)}>{r.code}</a>
                                ) : (
                                  (r.code ?? r.legacyCode)
                                ),
                            },
                            {
                              key: 'status',
                              header: 'Status',
                              render: (r) => (
                                <>
                                  <PlacementBadge status={r.status} mode={r.publicationMode} />{' '}
                                  {r.contentState ? (
                                    <ContentStateBadge state={r.contentState} />
                                  ) : null}
                                </>
                              ),
                            },
                            {
                              key: 'conflicts',
                              header: 'Conflicts',
                              render: (r) =>
                                r.conflicts.hard.length + r.conflicts.warnings.length === 0 ? (
                                  '—'
                                ) : (
                                  <ul>
                                    {r.conflicts.hard.map((c, i) => (
                                      <li key={`h${i}`}>
                                        <StatusBadge tone="danger">{c.code}</StatusBadge>{' '}
                                        {c.message}
                                      </li>
                                    ))}
                                    {r.conflicts.warnings.map((c, i) => (
                                      <li key={`w${i}`}>
                                        <StatusBadge tone="warning">{c.code}</StatusBadge>{' '}
                                        {c.message}
                                      </li>
                                    ))}
                                  </ul>
                                ),
                            },
                          ]}
                        />
                      </Card>
                    ))
                )}
                <Card
                  title={`Planned, not scheduled (${planned.length})`}
                  description="Planned placements are not posts: they are not counted as scheduled or published."
                >
                  <DataTable
                    rows={planned}
                    rowKey={(r) => r.p.id}
                    empty={<EmptyState title="No planned placements" />}
                    columns={[
                      {
                        key: 'code',
                        header: 'Placement',
                        render: (r) =>
                          r.p.contentItemId ? (
                            <a href={modulePath(`content/${r.p.contentItemId}`)}>{r.p.code}</a>
                          ) : (
                            <StatusBadge tone="warning">{r.p.legacyCode} (ambiguous)</StatusBadge>
                          ),
                      },
                      { key: 'account', header: 'Account', render: (r) => r.accountCode },
                      {
                        key: 'planned',
                        header: 'Planned for (IST)',
                        render: (r) =>
                          r.p.originalPublishAt
                            ? formatIst(r.p.originalPublishAt)
                            : (r.p.legacyDateRaw ?? '—'),
                      },
                      {
                        key: 'legacy',
                        header: 'Legacy status',
                        render: (r) => r.p.legacyStatus ?? '—',
                      },
                    ]}
                  />
                </Card>
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
