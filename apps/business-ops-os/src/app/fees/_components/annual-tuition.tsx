/**
 * /ops/fees — annual tuition for one academic year (owner brief 23 Oct 2026 §22–24): tiles, the
 * paid-versus-outstanding donut and its drill-down (`?open=outstanding`), all from one feeYear
 * call under the year and course in the URL. Rules: A-FEE-9.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, EmptyState } from '@elevate/shared-ui';
import { MANUAL_FEE_DISCLAIMER } from '../../../domain/fees';
import { feeYear, owingStudents, OWING_SORTS, type OwingSort } from '../../../server/fee-year';
import { DonutChart, StatCard } from '../../../ui/charts';
import { shareLabels } from '../../../ui/chart-math';
import { fmtPaise, plural } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { FilterForm, listHref } from '../../../ui/list-controls';
import { Segment } from '../../../ui/sections';
import { OwingDialog } from './owing-dialog';

type Params = Record<string, string | undefined>;
const BASE = '/ops/fees';

export async function AnnualTuition({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const r = await load((db) => feeYear(db, user, { year: sp.year, course: sp.course }));
  if (!r.ok) return r.view;
  const d = r.data;
  const t = d.totals;
  const sort = (Object.keys(OWING_SORTS) as OwingSort[]).find((k) => k === sp.sort) ?? 'overdue';
  const owing = owingStudents(d.rows, sort);
  const courseName = d.courses.find((c) => c.value === d.course)?.label ?? d.course;
  const filters = [`Academic year ${d.year ?? 'not set'}`, courseName ?? 'All courses'];
  const keep = { year: sp.year, course: sp.course };
  const openHref = listHref(BASE, keep, { open: 'outstanding' });
  const unreconciled = d.rows.filter((x) => !x.reconciled).length;
  const notes = (
    <>
      {d.draftsNotCounted ? (
        <Alert
          title={`${plural(d.draftsNotCounted, 'agreement')} waiting for approval not counted`}
        >
          A first agreement counts here once it is approved and activated on the student&apos;s Fees
          tab.
        </Alert>
      ) : null}
      {d.changesPending ? (
        <Alert
          title={`${plural(d.changesPending, 'agreement')} ${d.changesPending === 1 ? 'has' : 'have'} a change waiting for approval`}
        >
          Figures use the last approved version until the change is approved and activated.
        </Alert>
      ) : null}
      {d.continuedElsewhere ? (
        <Alert
          title={
            d.continuedElsewhere === 1
              ? '1 student’s agreement continues under another counsellor'
              : `${d.continuedElsewhere} students’ agreements continue under another counsellor`
          }
        >
          Their current agreement is on an admission case you do not counsel, so they are not in
          these figures.
        </Alert>
      ) : null}
      {d.withoutYear ? (
        <Alert
          tone="warning"
          title={`${plural(d.withoutYear, 'agreement')} without an academic year`}
        >
          These are in no year&apos;s figures. Change the agreement on the student&apos;s Fees tab
          to give it a year.
        </Alert>
      ) : null}
    </>
  );
  if (!d.years.length)
    return (
      <Segment title="Annual tuition">
        {notes}
        <EmptyState
          title="No accepted fee agreements yet"
          description="Annual tuition shows here once a student's fee agreement is approved and activated, from the student's Fees tab."
        />
      </Segment>
    );
  return (
    <Segment
      title={`Annual tuition ${d.year}`}
      description="Tuition on accepted fee agreements for the academic year. Registration and demo fees are separate."
      meta={
        d.rows.some((x) => x.isSample) ? (
          <span className="el-badge el-badge-sample">SAMPLE DATA</span>
        ) : undefined
      }
    >
      <div className="el-stack">
        <FilterForm
          action={BASE}
          submitLabel="Show"
          resetHref={BASE}
          fields={[
            {
              name: 'year',
              label: 'Academic year',
              type: 'select',
              value: sp.year,
              anyLabel: `Latest (${d.years[0]})`,
              options: d.years.map((y) => ({ value: y, label: y })),
            },
            {
              name: 'course',
              label: 'Course',
              type: 'select',
              value: sp.course,
              anyLabel: 'All courses',
              options: d.courses,
            },
          ]}
        />
        {notes}
        {unreconciled ? (
          <Alert
            tone="warning"
            title={`${plural(unreconciled, 'agreement')} not matching its ledger`}
          >
            Their figures are included as recorded. Open the student&apos;s Fees tab to see what
            does not match.
          </Alert>
        ) : null}
        {d.rows.length ? (
          <>
            <ul className="el-grid ops-kpis" aria-label={`Annual tuition ${d.year}`}>
              <li>
                <StatCard
                  label="Net tuition billed"
                  value={fmtPaise(t.billedPaise)}
                  note={`${plural(t.students, 'student')}, after discounts and waivers`}
                />
              </li>
              <li>
                <StatCard
                  label="Paid"
                  value={fmtPaise(t.paidPaise)}
                  note={
                    t.creditPaise
                      ? `Payments less refunds; ${fmtPaise(t.creditPaise)} paid above what is owed is a credit, not counted`
                      : 'Payments less refunds'
                  }
                />
              </li>
              <li>
                <StatCard
                  label="Outstanding"
                  value={fmtPaise(t.outstandingPaise)}
                  note={
                    t.outstandingPct === null
                      ? 'No tuition billed'
                      : `${shareLabels([t.paidPaise, t.outstandingPaise])[1]} of net tuition billed`
                  }
                />
              </li>
              <li>
                <StatCard
                  label="Due now"
                  value={fmtPaise(t.dueNowPaise)}
                  note="Falls due today; overdue from tomorrow"
                />
              </li>
              <li>
                <StatCard label="Overdue" value={fmtPaise(t.overduePaise)} note="Due date passed" />
              </li>
              <li>
                <StatCard
                  label="Not yet due"
                  value={fmtPaise(t.futurePaise)}
                  note="Later instalments and amounts without a due date"
                />
              </li>
            </ul>
            <DonutChart
              label={`Annual tuition ${d.year}, paid and outstanding`}
              format={fmtPaise}
              totalLabel="Billed"
              table
              emptyText="No tuition billed: every agreement here is fully discounted or waived."
              data={[
                { label: 'Paid', value: t.paidPaise },
                {
                  label: 'Outstanding',
                  value: t.outstandingPaise,
                  href: owing.length ? openHref : undefined,
                },
              ]}
            />
            {owing.length ? (
              <p>
                <a href={openHref}>
                  See the {plural(owing.length, 'student')} with tuition outstanding
                </a>
              </p>
            ) : (
              <p>No tuition is outstanding under these filters.</p>
            )}
            <details className="el-explain">
              <summary>How these figures are counted</summary>
              <p>
                Net tuition billed is the agreed tuition less discounts, waivers and credit
                adjustments, plus debit adjustments. Paid is payments less refunds, never more than
                what is billed. Outstanding is what is left, split into overdue (due date passed),
                due now (falls due today) and not yet due. Outstanding percentage = outstanding ÷
                net tuition billed.
              </p>
              <p>
                An agreement covering two courses counts in full under each course filter, so the
                course totals together can exceed the total for all courses.
              </p>
              <p>
                Each agreement counts at its last approved version, also while a change waits for
                approval; a closed agreement still counts what its ledger shows as owed. Voided and
                reversed entries never count. {MANUAL_FEE_DISCLAIMER}
              </p>
              <p>
                The Outstanding instalments tab lists active agreements only, so a closed agreement,
                or one counted at its last approved version while a change waits, shows here but not
                there.
              </p>
            </details>
          </>
        ) : (
          <p>No accepted agreement for {d.year} matches these filters.</p>
        )}
      </div>
      {sp.open === 'outstanding' ? (
        <OwingDialog
          rows={owing}
          filters={filters}
          basePath={BASE}
          params={{ ...keep, open: 'outstanding', sort }}
          page={Math.max(1, Number.parseInt(sp.page ?? '', 10) || 1)}
          closeHref={listHref(BASE, keep)}
          canOpenLedger={can(user, 'ops:students:read')}
        />
      ) : null}
    </Segment>
  );
}
