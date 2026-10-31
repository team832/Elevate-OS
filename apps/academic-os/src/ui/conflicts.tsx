/** Renders conflict-check results: hard constraints separately from preferences. Never says "optimal". */
import { Alert, DataTable, StatusBadge, fmtDay } from '@elevate/shared-ui';
import { StateBadge } from './badges';

interface Finding {
  code: string;
  severity: 'hard' | 'preference';
  date: string | null;
  message: string;
  unverified?: boolean;
}

/** `checked` and `notes` (what was not checked) come from the timetable check; "Feasible" is only said of a complete one. */
export function ConflictList({ verdict, hard, preferences, checked = [], notes = [] }: { verdict: string; hard: readonly Finding[]; preferences: readonly Finding[]; checked?: readonly string[]; notes?: readonly string[] }) {
  const partial = verdict === 'feasible' && notes.length > 0;
  const table = (rows: readonly Finding[]) => (
    <DataTable
      rows={rows.map((r, i) => ({ ...r, key: `${r.code}-${i}` }))}
      rowKey={(r) => r.key}
      columns={[
        { key: 'code', header: 'Constraint', render: (r) => r.code.replace(/_/g, ' ').toLowerCase() },
        { key: 'date', header: 'Date', render: (r) => fmtDay(r.date) },
        { key: 'message', header: 'Detail', render: (r) => <>{r.message} {r.unverified ? <StatusBadge tone="danger">date unverified</StatusBadge> : null}</> },
      ]}
    />
  );
  return (
    <div className="el-stack">
      <p>
        Result: {partial ? <StatusBadge tone="warning">Partial conflict check</StatusBadge> : <StateBadge state={verdict} />} — {hard.length} hard conflict(s), {preferences.length} preference warning(s){partial ? ' in what was checked' : ''}.
      </p>
      {checked.length > 0 ? (
        <Alert tone={notes.length > 0 ? 'warning' : 'info'}>
          <p>Checked: {checked.join(', ')}.</p>
          {notes.length > 0 ? <p>Not checked: {notes.join(' ')}</p> : null}
        </Alert>
      ) : null}
      {hard.length > 0 ? (
        <Alert tone="danger" title="Hard conflicts">
          {table(hard)}
        </Alert>
      ) : null}
      {preferences.length > 0 ? (
        <Alert tone="warning" title="Preferences (warnings only)">
          {table(preferences)}
        </Alert>
      ) : null}
    </div>
  );
}
