import type { AuthenticatedUser } from '@elevate/authentication';
import { DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  DIRECTORY_STATE_LABELS,
  DIRECTORY_STATES,
  type DirectoryState,
} from '../../domain/students';
import { studentListQuery } from '../../server/admissions-schemas';
import { formOptions } from '../../server/options';
import { listStudents } from '../../server/students';
import { fmtDate } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

const HANDOFF_FILTERS = [
  { value: 'not_requested', label: 'Not requested' },
  { value: 'pending', label: 'Waiting for Academic OS' },
  { value: 'rejected', label: 'Rejected by Academic OS' },
  { value: 'enrolled', label: 'Enrolled' },
] as const;

const stateTone = (s: DirectoryState | null) =>
  s === 'enrolled' ? 'success' : s === 'awaiting_enrolment' ? 'info' : 'neutral';

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:students:read', '/ops/students');
  const sp = await searchParams;
  const parsed = studentListQuery.safeParse(sp);
  const query = parsed.success ? parsed.data : studentListQuery.parse({});
  return (
    <Frame access={access} active="students">
      <PageHeader
        title="Students"
        description="Everyone whose admission was confirmed: admitted, waiting for Academic OS, enrolled, or withdrawn after admission. Academic OS holds the student record; this list shows the admission side and the handoff status. Contact details are not shown here."
      />
      {!parsed.success ? (
        <p className="el-field-hint" role="status">
          Some filters were not valid and were ignored.
        </p>
      ) : null}
      <Section label="Loading filters…">
        <Filters query={query} />
      </Section>
      <Section label="Loading students…">
        <StudentList user={access.user} query={query} />
      </Section>
    </Frame>
  );
}

async function Filters({ query }: { query: ReturnType<typeof studentListQuery.parse> }) {
  const r = await load((db) => formOptions(db));
  const programmes = r.ok ? r.data.programmes : [];
  return (
    <form
      method="get"
      action="/ops/students"
      className="el-inline-form"
      aria-label="Filter students"
    >
      <div className="el-field">
        <label htmlFor="students-q">Name or code</label>
        <input id="students-q" name="q" className="el-input" defaultValue={query.q ?? ''} />
      </div>
      <div className="el-field">
        <label htmlFor="students-state">Status</label>
        <select
          id="students-state"
          name="state"
          className="el-select"
          defaultValue={query.state ?? ''}
        >
          <option value="">Any</option>
          {DIRECTORY_STATES.map((s) => (
            <option key={s} value={s}>
              {DIRECTORY_STATE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="el-field">
        <label htmlFor="students-programme">Programme</label>
        <select
          id="students-programme"
          name="programme"
          className="el-select"
          defaultValue={query.programme ?? ''}
        >
          <option value="">Any</option>
          {programmes.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="el-field">
        <label htmlFor="students-handoff">Handoff</label>
        <select
          id="students-handoff"
          name="handoff"
          className="el-select"
          defaultValue={query.handoff ?? ''}
        >
          <option value="">Any</option>
          {HANDOFF_FILTERS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </div>
      <div className="el-field">
        <label htmlFor="students-sort">Sort</label>
        <select id="students-sort" name="sort" className="el-select" defaultValue={query.sort}>
          <option value="newest">Admitted most recently</option>
          <option value="oldest">Admitted longest ago</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      <button type="submit" className="el-button el-button-secondary">
        Show students
      </button>
      <a href="/ops/students">Clear filters</a>
    </form>
  );
}

function pageHref(query: ReturnType<typeof studentListQuery.parse>, cursor: string) {
  const p = new URLSearchParams();
  for (const k of ['q', 'state', 'programme', 'handoff', 'sort'] as const) {
    const v = query[k];
    if (v) p.set(k, String(v));
  }
  p.set('cursor', cursor);
  return `/ops/students?${p.toString()}`;
}

async function StudentList({
  user,
  query,
}: {
  user: AuthenticatedUser;
  query: ReturnType<typeof studentListQuery.parse>;
}) {
  const r = await load((db) => listStudents(db, user, query));
  if (!r.ok) return r.view;
  const filtered = Boolean(query.q || query.state || query.programme || query.handoff);
  return (
    <>
      <DataTable
        caption={`${r.data.items.length} student(s) on this page`}
        rows={r.data.items}
        rowKey={(s) => s.id}
        empty={
          <EmptyState
            title={filtered ? 'No students match these filters' : 'No admitted students yet'}
            description={
              filtered
                ? 'Change or clear the filters.'
                : 'A student appears here once an admission passes the confirmation checks and is marked admitted.'
            }
            action={
              filtered ? (
                <a href="/ops/students">Clear filters</a>
              ) : (
                <a href="/ops/admissions">Open the admissions pipeline</a>
              )
            }
          />
        }
        columns={[
          {
            key: 'name',
            header: 'Student',
            render: (s) => <a href={`/ops/students/${s.id}`}>{s.studentName}</a>,
          },
          { key: 'code', header: 'Admission', render: (s) => s.code },
          { key: 'programme', header: 'Programme', render: (s) => s.programmeCode ?? 'Not set' },
          {
            key: 'owner',
            header: 'Admission owner',
            render: (s) => s.counsellorName ?? 'Unassigned',
          },
          {
            key: 'state',
            header: 'Status',
            render: (s) => (
              <StatusBadge tone={stateTone(s.state)}>{s.stateLabel ?? s.status}</StatusBadge>
            ),
          },
          {
            key: 'handoff',
            header: 'Academic OS handoff',
            render: (s) => <StatusBadge tone={s.handoff.tone}>{s.handoff.label}</StatusBadge>,
          },
          { key: 'date', header: 'Admitted on', render: (s) => fmtDate(s.admissionDate) },
          {
            key: 'academic',
            header: 'Academic record',
            render: (s) =>
              s.academicPath ? <a href={s.academicPath}>Open in Academic OS</a> : 'Not linked yet',
          },
        ]}
      />
      <nav className="el-inline-form" aria-label="Pages">
        {query.cursor ? <a href="/ops/students">First page</a> : null}
        {r.data.nextCursor ? <a href={pageHref(query, r.data.nextCursor)}>Next page</a> : null}
      </nav>
    </>
  );
}
