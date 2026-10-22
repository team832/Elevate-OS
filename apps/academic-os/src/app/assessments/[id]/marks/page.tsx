import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Alert, ButtonLink, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import type { PageAccess } from '@elevate/server-kit/next';
import { getMarksSheet } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { ApiForm } from '../../../../ui/api-form';
import { StateBadge, fmtDateTime } from '../../../../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Enter marks' };

const STATE_LABELS: Record<string, string> = { scored: 'Scored', absent: 'Absent', exempt: 'Exempt', withheld: 'Withheld', pending: 'Pending marking' };

export default async function MarksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:assessments:mark', MODULE_PATHS.marks(id));
  return (
    <AcademicShell access={access} active="assessments" loading="Loading the marks sheet…">
      {access.status === 'allowed' ? <Body access={access} id={id} /> : null}
    </AcademicShell>
  );
}

async function Body({ access, id }: { access: PageAccess; id: string }) {
  const data = await load(() => getMarksSheet(getDb(), actorFor(access.user), id));
  if (!data.ok) return <LoadError error={data.error} />;
  const { assessment: a, bounds, canWithhold, rows } = data.data;
  const states = Object.entries(STATE_LABELS)
    .filter(([v]) => v !== 'withheld' || canWithhold)
    .map(([value, label]) => ({ value, label }));
  const counts = Object.keys(STATE_LABELS).map((s) => `${STATE_LABELS[s]} ${rows.filter((r) => r.state === s).length}`).join(' · ');
  return (
    <>
      <PageHeader
        title={`Marks — ${a.code}`}
        meta={<StateBadge state={a.status} />}
        description={`${a.title} · ${counts}`}
        actions={<ButtonLink href={MODULE_PATHS.assessment(a.id)}>Back to the assessment</ButtonLink>}
      />
      <div className="el-stack">
        {!bounds ? (
          <Alert tone="warning" title="The maximum is not known yet">
            A coordinator must set the scoring rule and sections on the assessment page before marks can be entered.
          </Alert>
        ) : (
          <p className="el-field-hint">
            Enter a total from {bounds.min} to {bounds.max}. {bounds.negativeAllowed ? 'This scheme has negative marking, so a total below 0 is allowed.' : 'This scheme has no negative marking, so totals cannot go below 0.'} Absent, exempt and withheld students get no score (never 0); pending means not marked yet.
          </p>
        )}
        {a.status === 'finalised' ? (
          <Alert tone="info" title="Results are final">
            Changes saved here take effect when a coordinator re-scores the assessment with a reason; that creates a new result version and keeps the old one.
          </Alert>
        ) : null}
        <Card>
          <DataTable
            compact
            rows={rows}
            rowKey={(r) => r.studentId}
            empty={<EmptyState title="No students in this batch" description="Students appear here once they are placed in the assessment's batch." />}
            columns={[
              { key: 'student', header: 'Student', render: (r) => `${r.fullName} (${r.code})` },
              { key: 'state', header: 'Result', render: (r) => <StateBadge state={r.state} /> },
              { key: 'score', header: 'Score', numeric: true, render: (r) => (r.state === 'scored' ? (r.manualScore ?? (r.hasResponses ? 'from responses' : 'Not recorded')) : '—') },
              { key: 'updated', header: 'Last change', render: (r) => (r.updatedAt ? fmtDateTime(r.updatedAt) : '—') },
              {
                key: 'enter',
                header: '',
                render: (r) =>
                  bounds ? (
                    <details>
                      <summary>Enter mark</summary>
                      <ApiForm
                        action={MODULE_PATHS.api(`assessments/${a.id}/marks`)}
                        method="PUT"
                        wrapAs="marks"
                        extra={{ studentId: r.studentId, version: r.version }}
                        submitLabel={`Save mark for ${r.fullName}`}
                        successMessage={a.status === 'finalised' ? 'Saved. Results are final: ask the academic coordinator to re-score so this change counts.' : 'Mark saved.'}
                        idPrefix={`mk-${r.studentId}`}
                        fields={[
                          { name: 'state', label: 'Result', type: 'select', required: true, options: states, defaultValue: r.state },
                          { name: 'manualScore', label: `Score (out of ${bounds.max})`, defaultValue: r.manualScore ?? undefined, hint: 'Only for Scored.' },
                        ]}
                      />
                    </details>
                  ) : null,
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
