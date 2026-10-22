/**
 * Teacher reports segment of the teacher profile: generate an internal report for a period and
 * download the stored ones. Loads its own list, so a failing query (e.g. migration 0014 not yet
 * applied) shows an error inside this segment while the profile and the form still render.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { ErrorState } from '@elevate/shared-ui';
import { addDays, istToday } from '../../domain';
import { listTeacherReports } from '../../server/teacher-report';
import { ActionForm } from '../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../ui/format';
import { load } from '../../ui/frame';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';

export async function TeacherReports({
  user,
  staffId,
}: {
  user: AuthenticatedUser;
  staffId: string;
}) {
  const r = await load((db) => listTeacherReports(db, user, staffId));
  const today = istToday(new Date());
  return (
    <Segment
      id="teacher-reports"
      title="Teacher reports"
      description="An internal folio for BDM meetings and analysis: profile, class delivery, reviews written, moderated feedback counts, tasks and EOD reports for a period. Built once from the records and stored; missing data is shown in words, never as zero. No contact details."
    >
      <div className="el-stack">
        <ActionForm
          action={`/ops/api/v1/teachers/${staffId}/report`}
          submitLabel="Generate teacher report"
          successText="Report generated. Download it from the list below."
          fields={[
            {
              name: 'from',
              label: 'From',
              type: 'date',
              required: true,
              defaultValue: addDays(today, -29),
              section: 'Reporting period',
            },
            {
              name: 'to',
              label: 'To',
              type: 'date',
              required: true,
              defaultValue: today,
              section: 'Reporting period',
            },
          ]}
        />
        {!r.ok ? (
          <ErrorState title="Stored reports could not be loaded" />
        ) : (
          <RecordTable
            caption="Stored reports"
            rows={r.data}
            rowKey={(x) => x.id}
            empty="No report generated yet."
            columns={[
              { key: 'ref', header: 'Reference', render: (x) => x.referenceCode },
              {
                key: 'period',
                header: 'Period',
                render: (x) => `${fmtDate(x.periodFrom)} to ${fmtDate(x.periodTo)}`,
              },
              {
                key: 'by',
                header: 'Generated',
                render: (x) => `${x.generatedBy ?? 'Unknown user'} · ${fmtDateTime(x.createdAt)}`,
              },
              {
                key: 'pdf',
                header: 'Download',
                render: (x) => (
                  <a href={`/ops/api/v1/teachers/${staffId}/report/${x.referenceCode}/pdf`}>
                    Download PDF
                    <span className="el-visually-hidden"> {x.referenceCode}</span>
                  </a>
                ),
              },
            ]}
          />
        )}
      </div>
    </Segment>
  );
}
