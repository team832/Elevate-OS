import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
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
import { formatIst, istDate, istMidnightUtc, modulePath, weekdayIndex } from '../../domain';
import { listCalendar, listPlannedPlacements } from '../../server';
import { ContentStateBadge, PlacementBadge } from '../../ui/badges';
import { MarketingPage, Section, param, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Content calendar' };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ist = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options });
const dayLabel = ist({ weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = ist({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
type Row = Awaited<ReturnType<typeof listCalendar>>[number];
/** A published placement sits on its publish time, a scheduled one on its slot. */
const at = (r: Row) => (r.status === 'published' && r.publishedAt) || r.scheduledAt;
const conflictCount = (r: Row) => r.conflicts.hard.length + r.conflicts.warnings.length;

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const fromRaw = param(sp, 'from');
  const from = (fromRaw && isIsoDate(fromRaw) ? fromRaw : toIsoDate()) as IsoDate;
  const toRaw = param(sp, 'to');
  let to = (toRaw && isIsoDate(toRaw) ? toRaw : addDays(from, 13)) as IsoDate;
  if (to < from || addDays(from, 62) < to) to = addDays(from, 13);
  const account = param(sp, 'account')?.toUpperCase();
  const today = toIsoDate();
  const days: IsoDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return (
    <MarketingPage
      permission="marketing:content:read"
      path={modulePath('calendar')}
      active="calendar"
      title="Content calendar"
      description="Scheduled and published posts by date (IST) and account. Clashes block scheduling."
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
            const byDay = new Map<string, Row[]>();
            for (const r of rows) {
              const day = istDate(at(r) ?? new Date(0));
              byDay.set(day, [...(byDay.get(day) ?? []), r]);
            }
            const clashes = rows.filter(conflictCount);
            return (
              <div className="el-stack">
                <form method="get" className="el-inline-form">
                  <Field id="from" label="From (IST)">
                    <TextInput id="from" name="from" type="date" defaultValue={from} />
                  </Field>
                  <Field id="to" label="To (IST, max 62 days)">
                    <TextInput id="to" name="to" type="date" defaultValue={to} />
                  </Field>
                  <Field id="account" label="Account code">
                    <TextInput id="account" name="account" defaultValue={account ?? ''} />
                  </Field>
                  <Button type="submit" variant="secondary">
                    Apply filters
                  </Button>
                </form>
                {clashes.length ? (
                  <Alert tone="warning">
                    {clashes.length} placement(s) in this window have conflicts; they are listed
                    under the calendar.
                  </Alert>
                ) : null}
                <div className="mkt-weekdays" aria-hidden="true">
                  {WEEKDAYS.map((w) => (
                    <span key={w}>{w}</span>
                  ))}
                </div>
                <ol
                  className="mkt-calendar"
                  aria-label={`Days from ${from} to ${to} (IST)`}
                  style={{ '--mkt-start': weekdayIndex(from) + 1 } as CSSProperties}
                >
                  {days.map((day) => {
                    const list = byDay.get(day) ?? [];
                    return (
                      <li
                        key={day}
                        className="mkt-day"
                        aria-current={day === today ? 'date' : undefined}
                      >
                        <h2 className="mkt-day-head">
                          {dayLabel.format(istMidnightUtc(day))}
                          {day === today ? ' · Today' : ''}
                        </h2>
                        {list.length ? (
                          <ul className="mkt-day-list">
                            {list.map((r) => {
                              const when = at(r);
                              const hard = r.conflicts.hard.length;
                              const warnings = r.conflicts.warnings.length;
                              return (
                                <li key={r.id} className="mkt-slot">
                                  <span className="mkt-slot-when">
                                    {when ? timeLabel.format(when) : '—'}
                                  </span>
                                  <span>{r.accountCode}</span>
                                  {r.contentItemId ? (
                                    <a href={modulePath(`content/${r.contentItemId}`)}>{r.code}</a>
                                  ) : (
                                    <span>{r.code ?? r.legacyCode}</span>
                                  )}
                                  <PlacementBadge status={r.status} mode={r.publicationMode} />
                                  {r.contentState ? (
                                    <ContentStateBadge state={r.contentState} />
                                  ) : null}
                                  {hard ? (
                                    <StatusBadge tone="danger">
                                      {hard} clash{hard === 1 ? '' : 'es'}
                                    </StatusBadge>
                                  ) : null}
                                  {warnings ? (
                                    <StatusBadge tone="warning">
                                      {warnings} warning{warnings === 1 ? '' : 's'}
                                    </StatusBadge>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="mkt-day-empty">Nothing scheduled</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {clashes.length ? (
                  <Card
                    title="Conflicts in this window"
                    description="A clash blocks scheduling until it is resolved; a warning does not."
                  >
                    <DataTable
                      compact
                      rows={clashes}
                      rowKey={(r) => r.id}
                      columns={[
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
                        { key: 'when', header: 'When (IST)', render: (r) => formatIst(at(r)) },
                        {
                          key: 'conflicts',
                          header: 'Conflicts',
                          render: (r) => (
                            <ul>
                              {r.conflicts.hard.map((c, i) => (
                                <li key={`h${i}`}>
                                  <StatusBadge tone="danger">{c.code}</StatusBadge> {c.message}
                                </li>
                              ))}
                              {r.conflicts.warnings.map((c, i) => (
                                <li key={`w${i}`}>
                                  <StatusBadge tone="warning">{c.code}</StatusBadge> {c.message}
                                </li>
                              ))}
                            </ul>
                          ),
                        },
                      ]}
                    />
                  </Card>
                ) : null}
                <Card
                  title={`Planned, not scheduled (${planned.length})`}
                  description="Planned placements are not posts: they are not counted as scheduled or published."
                >
                  <DataTable
                    compact
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
