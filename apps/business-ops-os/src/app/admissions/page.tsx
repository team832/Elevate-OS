/**
 * Admissions landing = Demo students (owner brief §4.1, §5, §5.1): KPI cards that
 * set filters, the search section, Current / Upcoming / Previous tabs with counts
 * from the same query as the rows, pagination, and one centred pop-up at a time:
 * the demo (`?open=<id>`), Convert to admission (`?convert=<id>`) or booking
 * (`?new=1`). All state lives in the URL.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, ButtonLink, EmptyState, PageHeader, Tabs, type Column } from '@elevate/shared-ui';
import { z } from 'zod';
import { istToday } from '../../domain';
import { DEMO_LIST_VIEWS, DEMO_OUTCOMES, type DemoListView } from '../../domain/demos';
import { listDemos, type DemoSummary } from '../../server/demos';
import { DEMO_SORTS, demoListQuery, type DemoListQuery } from '../../server/demos-schemas';
import { formOptions } from '../../server/options';
import { AdmissionsNav } from '../../ui/admissions-nav';
import { StatCard } from '../../ui/charts';
import { Unavailable } from '../../ui/cross-module';
import { fmtDate, fmtDateTime, fmtMonth, humanise } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, options, Pager, SearchPanel } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { BookDemo } from './_components/book-demo';
import {
  Badge,
  DayMarks,
  FollowUpCell,
  programmeNames,
  SampleBadge,
} from './_components/demo-bits';
import {
  DemoActions,
  DemoJourney,
  DemoMeta,
  demoSections,
  loadDemoRecord,
} from './_components/demo-record';
import { ConvertForm, loadConversion } from './demos/[id]/convert/convert-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Demos' };

const BASE = '/ops/admissions';
type Params = Record<string, string | undefined>;
type Option = { value: string; label: string };

const linkTo = (params: Params, patch: Params) => listHref(BASE, params, patch);
/** Every list filter: the query keys except the tab and the page. */
const FILTER_KEYS = Object.keys(demoListQuery.shape).filter((k) => k !== 'view' && k !== 'page');
const isId = (id: string) => z.uuid().safeParse(id).success;

export default async function AdmissionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:leads:read', BASE);
  const params = await searchParams;
  const parsed = demoListQuery.safeParse(params);
  const write = can(access.user, 'ops:leads:write');
  const close = linkTo(params, {
    open: undefined,
    new: undefined,
    convert: undefined,
    lead: undefined,
  });
  return (
    <Frame access={access} active="admissions">
      <PageHeader
        title="Demos"
        description="Who is in a demo now, who starts next, and how finished demos ended."
        actions={
          write ? (
            <ButtonLink
              variant="primary"
              href={linkTo(params, { new: '1', open: undefined, convert: undefined })}
            >
              Book a demo
            </ButtonLink>
          ) : undefined
        }
        tabs={<AdmissionsNav current="demos" user={access.user} />}
      />
      {parsed.success ? (
        <Section label="Loading demo students…">
          <DemoList query={parsed.data} params={params} user={access.user} write={write} />
        </Section>
      ) : (
        <Alert tone="warning" title="Some filters in the address were not understood">
          <a href={BASE}>Clear filters</a>
        </Alert>
      )}
      {params.convert ? (
        <Section label="Loading conversion…">
          <ConvertModal
            user={access.user}
            id={params.convert}
            closeHref={linkTo(params, { convert: undefined })}
          />
        </Section>
      ) : params.open ? (
        <Section label="Loading demo…">
          <DemoModal user={access.user} id={params.open} params={params} closeHref={close} />
        </Section>
      ) : params.new && write ? (
        <FormModal id="book-demo" title="Book a demo" closeHref={close}>
          <Section label="Loading form…">
            <BookDemo user={access.user} cancelHref={close} leadId={params.lead} />
          </Section>
        </FormModal>
      ) : null}
    </Frame>
  );
}

const notFound = <EmptyState title="Demo not found" description="The link may be out of date." />;

async function DemoModal({
  user,
  id,
  params,
  closeHref,
}: {
  user: AuthenticatedUser;
  id: string;
  params: Params;
  closeHref: string;
}) {
  const r = isId(id) ? await loadDemoRecord(user, id) : null;
  if (!r?.ok)
    return (
      <RecordModal id="demo-modal" title="Demo" closeHref={closeHref}>
        {r?.view ?? notFound}
      </RecordModal>
    );
  const { d, options } = r.data;
  return (
    <RecordModal
      id="demo-modal"
      title={d.studentName}
      meta={<DemoMeta d={d} />}
      fullHref={`${BASE}/demos/${d.demo.id}`}
      closeHref={closeHref}
      returnId={d.demo.id}
      tabs={demoSections({ d, user, options, level: 3 })}
    >
      <div className="el-form-actions">
        <DemoActions d={d} user={user} convertHref={linkTo(params, { convert: d.demo.id })} />
      </div>
      <DemoJourney d={d} />
    </RecordModal>
  );
}

async function ConvertModal({
  user,
  id,
  closeHref,
}: {
  user: AuthenticatedUser;
  id: string;
  closeHref: string;
}) {
  const r = isId(id) ? await loadConversion(user, id) : null;
  if (!r?.ok)
    return (
      <FormModal id="convert-modal" title="Convert to admission" closeHref={closeHref}>
        {r?.view ?? notFound}
      </FormModal>
    );
  return (
    <FormModal
      id="convert-modal"
      title={`Convert to admission: ${r.data.d.student.fullName}`}
      meta="Links one student record and opens the admission application, all together or not at all."
      closeHref={closeHref}
      returnId={id}
    >
      <ConvertForm data={r.data} demoId={id} level={3} cancelHref={closeHref} />
    </FormModal>
  );
}

const SORT_LABELS: Record<(typeof DEMO_SORTS)[number], string> = {
  name: 'Student name',
  first_class: 'First class date',
  follow_up: 'Follow-up due date',
  recent: 'Recently booked',
};

const EMPTY: Record<DemoListView, [title: string, description: string]> = {
  current: ['No demo is running', 'An upcoming demo moves here on the day of its first class.'],
  upcoming: ['No upcoming demos', 'Book one for a student who has finished counselling.'],
  previous: ['No finished demos yet', 'A demo moves here when its outcome is recorded.'],
  all: ['No demo students yet', 'Book a demo for a student who has finished counselling.'],
};

const hint = (text: string) => (
  <>
    <br />
    <span className="el-field-hint">{text}</span>
  </>
);
/** Subjects on the first line, teachers under them: one compact cell instead of a wide column. */
function teachersCell(r: DemoSummary) {
  const unique = (values: (string | null)[]) => [...new Set(values.filter(Boolean))].join(', ');
  return (
    <>
      {unique(r.sessions.map((s) => s.subject)) || 'Subjects not set'}
      {hint(unique(r.sessions.map((s) => s.teacherName)) || 'No teacher assigned')}
    </>
  );
}

/** Follow-up due age, plus "Mark done" for staff with ops:leads:write. */
function followUpColumn(canClose: boolean): Column<DemoSummary> {
  return {
    key: 'followUp',
    header: 'Follow-up',
    render: (r) => (
      <>
        <FollowUpCell followUp={r.followUp} canClose={canClose} />
        {r.followUp ? hint(r.followUp.title) : null}
      </>
    ),
  };
}

/** Name and sample marker, with the programmes of interest (by name) under it. */
function studentColumn(programmes: readonly Option[]): Column<DemoSummary> {
  return {
    key: 'student',
    header: 'Student',
    render: (r) => (
      <>
        {r.studentName} <SampleBadge show={r.demo.isSample} />
        {hint(
          r.interests.length ? programmeNames(r.interests, programmes) : 'Interests not recorded',
        )}
      </>
    ),
  };
}

const COLUMNS = {
  programme: {
    key: 'programme',
    header: 'Programme and counsellor',
    render: (r) => (
      <>
        {r.programmeName ?? 'Programme not set'}
        {hint(r.counsellorName ?? 'No counsellor')}
      </>
    ),
  },
  classes: {
    key: 'classes',
    header: 'Demo days',
    render: (r) => (
      <>
        <DayMarks days={r.days} label={r.progress.label} />
        {hint(
          r.next
            ? `Next: ${fmtDateTime(r.next.startsAt)}`
            : r.awaitingRecord.length
              ? 'Attendance to record'
              : 'No class ahead',
        )}
      </>
    ),
  },
  teachers: { key: 'teachers', header: 'Subjects and teachers', render: teachersCell },
  checklist: { key: 'checklist', header: 'Checklist', render: (r) => r.checklist.label },
  firstSession: {
    key: 'first',
    header: 'First class',
    render: (r) => (r.sessions[0] ? fmtDateTime(r.sessions[0].startsAt) : 'Not scheduled'),
  },
  setup: {
    key: 'setup',
    header: 'Still to arrange',
    render: (r) => r.gaps.join('; ') || 'Ready',
  },
  outcome: {
    key: 'outcome',
    header: 'Outcome',
    render: (r) => (
      <>
        <Badge value={r.demo.outcome} />
        {hint(r.demo.outcomeAt ? fmtDate(istToday(r.demo.outcomeAt)) : 'Date not recorded')}
      </>
    ),
  },
  attended: {
    key: 'attended',
    header: 'Days attended',
    render: (r) => (
      <DayMarks days={r.days} label={r.progress.label} detail={r.progress.sessionsLabel} />
    ),
  },
  conversion: {
    key: 'conversion',
    header: 'Admission',
    render: (r) => (r.convertedCode ? 'Begun' : 'Not begun'),
  },
  reason: { key: 'reason', header: 'Reason', render: (r) => r.demo.outcomeReason ?? '—' },
} satisfies Record<string, Column<DemoSummary>>;

/** Six columns per tab so every one fits; the rest is in the pop-up. */
const VIEW_COLUMNS: Record<DemoListView, (keyof typeof COLUMNS | 'followUp' | 'student')[]> = {
  current: ['student', 'programme', 'classes', 'teachers', 'checklist', 'followUp'],
  upcoming: ['student', 'firstSession', 'programme', 'teachers', 'setup', 'followUp'],
  previous: ['student', 'outcome', 'attended', 'checklist', 'conversion', 'reason'],
  all: ['student', 'firstSession', 'programme', 'teachers', 'checklist', 'followUp'],
};
/** The column each offered sort orders by; "Recently booked" has none on screen. */
const SORTED_COLUMN: Partial<Record<(typeof DEMO_SORTS)[number], string>> = {
  name: 'student',
  first_class: COLUMNS.firstSession.key,
  follow_up: 'followUp',
};

async function DemoList({
  user,
  query,
  params,
  write,
}: {
  user: AuthenticatedUser;
  query: DemoListQuery;
  params: Params;
  write: boolean;
}) {
  const r = await load((db) => Promise.all([listDemos(db, user, query), formOptions(db)]));
  if (!r.ok) return r.view;
  const [list, opts] = r.data;
  const { view, kpis } = list;
  const tiles: [string, number, string, Params][] = [
    ['Current demos', kpis.current, 'First class on or before today', { view: 'current' }],
    ['Upcoming demos', kpis.upcoming, 'No class has started yet', { view: 'upcoming' }],
    [
      'Follow-ups due',
      kpis.followUpsDue,
      'Due today or overdue; opens the list of them',
      { followUp: 'due', view: 'all' },
    ],
    [
      'Conversions this month',
      kpis.conversions,
      `Converted in ${fmtMonth(list.month)}`,
      { view: 'previous', outcome: 'converted', outcomeMonth: list.month },
    ],
    [
      'Admissions pending decision',
      kpis.pendingDecision,
      'Demo students whose case awaits the admission decision',
      { stage: 'admission_pending', view: 'all' },
    ],
  ];
  const filtered = FILTER_KEYS.some((k) => params[k]);
  const kept = Object.fromEntries(
    (['view', 'stage'] as const).flatMap((k) => (params[k] ? [[k, params[k]]] : [])),
  );
  return (
    <div className="el-stack">
      {list.academicUnavailable ? (
        <Unavailable
          name="Academic OS"
          result={list.academicUnavailable}
          note="Attendance and teachers recorded there show as not known."
        />
      ) : null}
      <ul className="el-grid ops-kpis" aria-label="Demo figures">
        {tiles.map(([label, value, note, patch]) => (
          <li key={label}>
            <StatCard
              label={label}
              value={value}
              note={note}
              href={linkTo(params, { ...patch, page: undefined, open: undefined })}
              current={Object.entries(patch).every(
                ([k, v]) => (k === 'view' ? view : params[k]) === v,
              )}
            />
          </li>
        ))}
      </ul>
      {list.leftOpen.length ? (
        <Alert tone="warning" title="Lost cases with demo classes still scheduled">
          <p>
            These no longer count as current or upcoming, and nothing was cancelled. Open each demo
            and close it: that releases its classes and the teacher’s time.
          </p>
          <ul>
            {list.leftOpen.map((d) => (
              <li key={d.demoId}>
                <a href={linkTo(params, { open: d.demoId, new: undefined })}>{d.studentName}</a>:{' '}
                {d.classes} {d.classes === 1 ? 'class' : 'classes'}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <SearchPanel
        action={BASE}
        hidden={kept}
        search={{ name: 'q', label: 'Search by name or reference', value: params.q }}
        filters={[
          {
            name: 'programme',
            label: 'Programme',
            type: 'select',
            options: opts.programmes,
            value: params.programme,
          },
          {
            name: 'counsellor',
            label: 'Counsellor',
            type: 'select',
            options: opts.staff,
            value: params.counsellor,
          },
          {
            name: 'outcome',
            label: 'Outcome',
            type: 'select',
            options: options(DEMO_OUTCOMES),
            value: params.outcome,
          },
          { name: 'from', label: 'Class from', type: 'date', value: params.from },
          { name: 'to', label: 'Class to', type: 'date', value: params.to },
          {
            name: 'sort',
            label: 'Sort by',
            type: 'select',
            value: params.sort,
            options: DEMO_SORTS.map((value) => ({ value, label: SORT_LABELS[value] })),
          },
          {
            name: 'followUp',
            label: 'Follow-up',
            type: 'select',
            value: params.followUp,
            options: [
              { value: 'due', label: 'Due today or overdue' },
              { value: 'overdue', label: 'Overdue' },
            ],
          },
        ]}
      />
      <Tabs
        idBase="demos"
        label="Demos"
        selected={view}
        items={DEMO_LIST_VIEWS.map((v) => ({
          key: v,
          label: humanise(v),
          href: linkTo(params, { view: v, page: undefined, open: undefined }),
          count: list.counts[v],
        }))}
      >
        <RecordTable
          rows={list.rows}
          rowKey={(row) => row.demo.id}
          rowHref={(row) => linkTo(params, { open: row.demo.id, new: undefined })}
          linkColumn="student"
          sortedBy={
            query.sort && SORTED_COLUMN[query.sort]
              ? { column: SORTED_COLUMN[query.sort]!, direction: 'ascending' }
              : undefined
          }
          columns={VIEW_COLUMNS[view].map((k) =>
            k === 'followUp'
              ? followUpColumn(write)
              : k === 'student'
                ? studentColumn(opts.programmes)
                : COLUMNS[k],
          )}
          empty={
            filtered ? (
              <EmptyState
                title="No demos match this search"
                action={<a href={linkTo({}, { view })}>Clear search and filters</a>}
              />
            ) : (
              <EmptyState
                title={EMPTY[view][0]}
                description={EMPTY[view][1]}
                action={
                  view === 'upcoming' && write ? (
                    <a href={linkTo(params, { new: '1' })}>Book a demo</a>
                  ) : undefined
                }
              />
            )
          }
        />
        <Pager
          basePath={BASE}
          params={{ ...params, open: undefined }}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
        />
      </Tabs>
    </div>
  );
}
