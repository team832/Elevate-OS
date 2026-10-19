import type { AuthenticatedUser } from '@elevate/authentication';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { isIsoDate } from '../../domain';
import { listSchedule } from '../../server/schedule';
import { loadSettings } from '../../server/settings';
import { ActionForm } from '../../ui/action-form';
import { decisionTone, fmtDate, fmtDateTime, humanise, statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:leads:read', '/ops/schedule');
  const sp = await searchParams;
  const from = isIsoDate(sp.from) ? sp.from : undefined;
  const to = isIsoDate(sp.to) ? sp.to : undefined;
  return (
    <Frame access={access} active="schedule">
      <PageHeader
        title="Counselling and demo schedule"
        description="This IST week by default. Demo classes are separate sessions, never the main batch (BR-OPS-2)."
      />
      <form className="el-inline-form" method="get">
        <label>
          From <input className="el-input" type="date" name="from" defaultValue={from} />
        </label>
        <label>
          To <input className="el-input" type="date" name="to" defaultValue={to} />
        </label>
        <button className="el-button el-button-secondary" type="submit">
          Show
        </button>
      </form>
      <Section>
        <Schedule user={access.user} from={from} to={to} />
      </Section>
    </Frame>
  );
}

async function Schedule({
  user,
  from,
  to,
}: {
  user: AuthenticatedUser;
  from?: string;
  to?: string;
}) {
  const r = await load(async (db) => ({
    s: await listSchedule(db, user, { from, to }),
    settings: await loadSettings(db),
  }));
  if (!r.ok) return r.view;
  const { s, settings } = r.data;
  const terms = settings['demo.terms'];
  const fee = settings['demo.fee'];
  const limits = settings['demo.limits'];
  return (
    <div className="el-stack">
      <Card
        title="Demo terms in force"
        description="Configuration with its recorded decision state."
      >
        <ul>
          <li>
            {terms.value.days} demo days, separate demo classes; non-refundable if not joining;
            adjusted against fees on joining —{' '}
            <StatusBadge tone={decisionTone(terms.decisionState)}>
              {terms.decisionState}
            </StatusBadge>{' '}
            ({terms.source})
          </li>
          <li>
            Fee recorded on bookings: ₹{fee.value.amountInr} —{' '}
            <StatusBadge tone={decisionTone(fee.decisionState)}>{fee.decisionState}</StatusBadge>{' '}
            (owner decision {fee.ownerDecision}); Elevate OS stores fee status and a reference only.
          </li>
          <li>
            Limits (consecutive days, subject cap, missed day):{' '}
            <StatusBadge tone={decisionTone(limits.decisionState)}>
              {limits.decisionState}
            </StatusBadge>{' '}
            — not enforced until {limits.ownerDecision} is decided.
          </li>
        </ul>
      </Card>
      <Card title={`Counselling ${fmtDate(s.from)} – ${fmtDate(s.to)}`}>
        <DataTable
          rows={s.counselling}
          rowKey={(c) => c.id}
          empty={<EmptyState title="No counselling booked in this range" />}
          columns={[
            { key: 'scheduledAt', header: 'When', render: (c) => fmtDateTime(c.scheduledAt) },
            {
              key: 'lead',
              header: 'Lead',
              render: (c) => (
                <a href={`/ops/admissions/${c.admissionId}`}>
                  {c.leadCode} — {c.studentName}
                </a>
              ),
            },
            { key: 'counsellorName', header: 'Counsellor' },
            { key: 'mode', header: 'Mode', render: (c) => humanise(c.mode) },
            {
              key: 'status',
              header: 'Status',
              render: (c) => (
                <StatusBadge tone={statusTone(c.status)}>{humanise(c.status)}</StatusBadge>
              ),
            },
            {
              key: 'act',
              header: '',
              render: (c) =>
                c.status === 'scheduled' ? (
                  <ActionForm
                    action={`/ops/api/v1/counselling/${c.id}`}
                    submitLabel="Record"
                    compact
                    fields={[
                      {
                        name: 'action',
                        label: 'Result',
                        type: 'select',
                        required: true,
                        options: [
                          { value: 'complete', label: 'Completed' },
                          { value: 'no_show', label: 'No-show' },
                          { value: 'cancel', label: 'Cancelled' },
                        ],
                      },
                      { name: 'outcome', label: 'Outcome (completed)' },
                      { name: 'reason', label: 'Reason (no-show/cancel)' },
                    ]}
                  />
                ) : (
                  (c.outcome ?? '')
                ),
            },
          ]}
        />
      </Card>
      <Card title="Demo classes in this range">
        <DataTable
          rows={s.demos}
          rowKey={(d) => d.id}
          empty={<EmptyState title="No demos in this range" />}
          columns={[
            { key: 'days', header: 'Days', render: (d) => d.dayDates.map(fmtDate).join(', ') },
            {
              key: 'lead',
              header: 'Lead',
              render: (d) => (
                <a href={`/ops/admissions/${d.admissionId}`}>
                  {d.leadCode} — {d.studentName}
                </a>
              ),
            },
            { key: 'subjects', header: 'Subjects', render: (d) => d.subjects.join(', ') },
            {
              key: 'teachers',
              header: 'Teachers',
              render: (d) => d.teachers.join(', ') || 'Not booked',
            },
            {
              key: 'status',
              header: 'Status',
              render: (d) => <StatusBadge tone={statusTone(d.status)}>{d.status}</StatusBadge>,
            },
            { key: 'fee', header: 'Demo fee', render: (d) => humanise(d.feeStatus) },
          ]}
        />
      </Card>
    </div>
  );
}
