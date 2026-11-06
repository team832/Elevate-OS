import type { Metadata } from 'next';
import { ButtonLink, EmptyState, PageHeader, fmtDaysIn } from '@elevate/shared-ui';
import { ValidationError } from '@elevate/shared-contracts';
import { getDb } from '@elevate/database';
import type { PageAccess } from '@elevate/server-kit/next';
import { buildReport } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { reportParams, reportQuery, type ReportKind } from '../../../server/schemas-assessment';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';
import '../print.css';
import { fmtDateTime } from '../../../ui/badges';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Report' };

type Params = Record<string, string | string[] | undefined>;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Params> }) {
  const { kind } = await params;
  const access = await gate('academic:module:access', MODULE_PATHS.report(kind));
  return (
    <AcademicShell access={access} active="reports" loading="Building the report…">
      {access.status === 'allowed' ? <Body access={access} kind={kind} params={await searchParams} /> : null}
    </AcademicShell>
  );
}

async function Body({ access, kind, params }: { access: PageAccess; kind: string; params: Params }) {
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  const data = await load(async () => buildReport(getDb(), actorFor(access.user), reportParams.parse({ kind }).kind as ReportKind, reportQuery.parse(Object.fromEntries(query))));
  if (!data.ok && data.error instanceof ValidationError)
    // Opened without its filters (e.g. a bookmarked link): send the user to the filter form, not an error.
    return <EmptyState level={1} title="Choose what to report on" description={data.error.message} action={<ButtonLink href={MODULE_PATHS.reports}>Open the reports page</ButtonLink>} />;
  if (!data.ok) return <LoadError level={1} back="home" error={data.error} />;
  const r = data.data;
  query.set('format', 'csv');
  return (
    <>
      <PageHeader
        title={r.title}
        description={r.subtitle}
        actions={
          <>
            <ButtonLink href={`${MODULE_PATHS.api(`reports/${kind}`)}?${query}`} download>
              Download CSV
            </ButtonLink>
            <ButtonLink href={MODULE_PATHS.reports}>All reports</ButtonLink>
          </>
        }
      />
      <div className="el-stack">
        <p className="el-field-hint">
          <strong>Definition:</strong> {r.definition}
        </p>
        {r.rows.length === 0 ? (
          <p>No rows for these filters. Change the dates or the batch on the reports page.</p>
        ) : (
          <div className="el-table-wrap" role="region" aria-label={r.title} tabIndex={0}>
            <table className="el-table report-table">
              <thead>
                <tr>
                  {r.columns.map((c, j) => (
                    <th key={c} scope="col" className={typeof r.rows[0]?.[j] === 'number' ? 'el-num' : undefined}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={typeof cell === 'number' ? 'el-num' : undefined}>
                        {cell === null || cell === undefined ? 'Not recorded' : fmtDaysIn(String(cell).replace(/_/g, ' '))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="report-notes">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p className="el-field-hint">Generated {fmtDateTime(new Date())} IST by {access.user.displayName}.</p>
      </div>
    </>
  );
}
