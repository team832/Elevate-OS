/** Renders conflict-check results: hard constraints separately from preferences. Never says "optimal". */
import { Alert, DataTable, StatusBadge } from '@elevate/shared-ui';
import { StateBadge } from './badges';

interface Finding {
  code: string;
  severity: 'hard' | 'preference';
  date: string | null;
  message: string;
  unverified?: boolean;
}

export function ConflictList({ verdict, hard, preferences, notes = [] }: { verdict: string; hard: readonly Finding[]; preferences: readonly Finding[]; notes?: readonly string[] }) {
  const table = (rows: readonly Finding[]) => (
    <DataTable
      rows={rows.map((r, i) => ({ ...r, key: `${r.code}-${i}` }))}
      rowKey={(r) => r.key}
      columns={[
        { key: 'code', header: 'Constraint', render: (r) => r.code.replace(/_/g, ' ').toLowerCase() },
        { key: 'date', header: 'Date', render: (r) => r.date ?? '—' },
        { key: 'message', header: 'Detail', render: (r) => <>{r.message} {r.unverified ? <StatusBadge tone="danger">date unverified</StatusBadge> : null}</> },
      ]}
    />
  );
  return (
    <div className="el-stack">
      <p>
        Result: <StateBadge state={verdict} /> — {hard.length} hard conflict(s), {preferences.length} preference warning(s).
      </p>
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
      {notes.map((n) => (
        <p key={n} className="el-field-hint">
          {n}
        </p>
      ))}
    </div>
  );
}
