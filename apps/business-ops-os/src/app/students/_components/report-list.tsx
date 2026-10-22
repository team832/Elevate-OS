import { StatusBadge } from '@elevate/shared-ui';
import { REPORT_KIND_LABELS, type ReportAudience } from '../../../domain/student-report';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';

export const REPORT_STATUS_TONES = {
  draft: 'neutral',
  reviewed: 'info',
  final: 'success',
} as const;

export interface ReportRow {
  id: string;
  referenceCode: string;
  audience: ReportAudience;
  status: keyof typeof REPORT_STATUS_TONES;
  periodFrom: string;
  periodTo: string;
  at: Date;
}

/** The student's generated reports: kind, period, status, PDF (drafts print with a banner). */
export function ReportList({ rows, studentId }: { rows: readonly ReportRow[]; studentId: string }) {
  const base = `/ops/students/${studentId}/report`;
  return (
    <RecordTable
      rows={rows}
      rowKey={(r) => r.id}
      rowHref={(r) => `${base}?export=${r.referenceCode}`}
      empty="No report generated yet. Choose a kind and a period above."
      columns={[
        { key: 'kind', header: 'Kind', render: (r) => REPORT_KIND_LABELS[r.audience] },
        {
          key: 'period',
          header: 'Period',
          render: (r) => `${fmtDate(r.periodFrom)} to ${fmtDate(r.periodTo)}`,
        },
        {
          key: 'status',
          header: 'Status',
          render: (r) => (
            <StatusBadge tone={REPORT_STATUS_TONES[r.status]}>{humanise(r.status)}</StatusBadge>
          ),
        },
        { key: 'at', header: 'Created', render: (r) => fmtDateTime(r.at) },
        {
          key: 'pdf',
          header: 'PDF',
          render: (r) => (
            <a href={`/ops/api/v1/students/${studentId}/report/${r.referenceCode}/pdf`}>
              Download PDF
            </a>
          ),
        },
      ]}
    />
  );
}
