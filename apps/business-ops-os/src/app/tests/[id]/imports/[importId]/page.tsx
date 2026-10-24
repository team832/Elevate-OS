import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { PageHeader, StatusBadge } from '@elevate/shared-ui';
import { formatUnits, type StagedRow } from '../../../../../domain/score-import';
import { importReview, type ImportReview as Review } from '../../../../../server/score-import';
import { ActionForm } from '../../../../../ui/action-form';
import { fmtDateTime } from '../../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../../ui/frame';
import { DetailTable, Segment } from '../../../../../ui/sections';
import { ImportReview, type ReviewRowView } from '../../../_components/import-review';
import { BASE, SOURCE_LABELS } from '../../../_components/labels';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Score import review' };

type Props = { params: Promise<{ id: string; importId: string }> };
const BASIS = {
  admission_number: 'Admission number',
  student_code: 'Student code',
  exact_name: 'Exact name on the roster',
  none: 'No match',
} as const;

export default async function ImportPage({ params }: Props) {
  const { id, importId } = await params;
  const access = await gate('ops:assessments:read', `${BASE}/${id}/imports/${importId}`);
  return (
    <Frame access={access} active="tests">
      <Section>
        <Body user={access.user} testId={id} importId={importId} />
      </Section>
    </Frame>
  );
}

/** Rows as the review table shows them (labels only; the server re-checks on save). */
function viewRows(r: Review): ReviewRowView[] {
  const roster = r.test.roster.filter((x) => !x.removedAt);
  const label = (x: (typeof roster)[number]) =>
    `${x.displayName} (${x.admissionNumber ?? 'no admission no.'}, ${x.batchCode})`;
  return r.rows.map((row) => {
    const p = row.parsed as unknown as StagedRow;
    const suggested = new Set((row.candidates as { studentId: string }[]).map((c) => c.studentId));
    const matched = roster.find((x) => x.studentId === row.studentId);
    return {
      rowId: `row-${row.rowNo}`,
      rowNumber: row.rowNo,
      ai: p.source === 'ai',
      original:
        Object.entries(row.original)
          .filter(([, v]) => v.trim())
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ') || 'Empty row',
      status: row.matchStatus,
      proposed: matched ? label(matched) : null,
      basis: BASIS[row.matchBasis],
      marks: p.scoreUnits === null ? 'Not entered' : formatUnits(p.scoreUnits),
      attendance: p.attendance,
      change: row.change,
      errors: row.errors.map((e) => e.message),
      warnings: (p.warnings ?? []).map((w) => w.message),
      choices: [...roster]
        .sort((a, b) => Number(suggested.has(b.studentId)) - Number(suggested.has(a.studentId)))
        .map((x) => ({
          studentId: x.studentId,
          label: label(x),
          suggested: suggested.has(x.studentId),
        })),
    };
  });
}

async function Body({
  user,
  testId,
  importId,
}: {
  user: AuthenticatedUser;
  testId: string;
  importId: string;
}) {
  const res = await load((db) => importReview(db, user, importId, testId));
  if (!res.ok) return res.view;
  const r = res.data;
  const t = r.test.assessment;
  const testHref = `${BASE}/${t.id}`;
  const open = r.status === 'in_review';
  const editable = open && can(user, 'ops:assessments:manage');
  const rows = viewRows(r);
  const seen = new Set(r.rows.map((x) => x.studentId));
  const missing = r.test.roster.filter((x) => !x.removedAt && !seen.has(x.studentId));
  const n = (k: string) => r.counts[k] ?? 0;
  return (
    <>
      <PageHeader
        title={`Review: ${r.fileName ?? 'score sheet'}`}
        meta={
          <>
            <StatusBadge tone={open ? 'warning' : 'neutral'}>{STATUS[r.status]}</StatusBadge>
            {r.source === 'pdf_ai' ? <StatusBadge tone="info">Read by AI</StatusBadge> : null}
          </>
        }
        description={
          <>
            For{' '}
            <a href={testHref}>
              {t.code} · {t.title}
            </a>
            . Nothing is saved to Academic OS until you save the reviewed marks; publishing results
            is a separate step on the test page.
          </>
        }
      />
      <div className="ops-panels">
        <Segment title="What was read" level={2} flush>
          <DetailTable
            rows={[
              { label: 'Source', value: SOURCE_LABELS[r.source] },
              { label: 'Read', value: fmtDateTime(r.createdAt) },
              { label: 'Rows', value: String(r.rowsTotal) },
              {
                label: 'Matched',
                value: `${n('matched')} matched; ${n('suggested')} suggestions; ${n('ambiguous')} ambiguous; ${n('unmatched')} not on the roster; ${n('duplicate')} duplicates`,
              },
              {
                label: 'Against saved marks',
                value: `${n('new')} new, ${n('no_change')} the same, ${n('overwrite')} change a verified mark, ${n('not_entered')} with nothing entered`,
              },
              { label: 'Rows with problems', value: String(n('withErrors')) },
              {
                label: 'On the roster, not in the file',
                value: missing.length ? missing.map((x) => x.displayName).join(', ') : 'None',
              },
            ]}
          />
        </Segment>
      </div>
      <ImportReview
        rows={rows}
        editable={editable}
        action={`/ops/api/v1/score-imports/${r.id}/confirm`}
        doneHref={testHref}
      />
      {editable ? (
        <ActionForm
          action={`/ops/api/v1/score-imports/${r.id}/cancel`}
          submitLabel="Cancel this import"
          variant="danger"
          compact
          redirectTo={testHref}
          successText="Import cancelled."
        />
      ) : null}
    </>
  );
}

const STATUS = {
  uploaded: 'Uploaded',
  staged: 'Read',
  in_review: 'Waiting for review',
  confirmed: 'Saved to Academic OS',
  cancelled: 'Cancelled',
  failed: 'Failed',
} as const;
