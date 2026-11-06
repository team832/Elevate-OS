/** Admit cards on a test page (F4-03): roll numbers, venue and instructions, and the PDF downloads. */
import type { AuthenticatedUser } from '@elevate/authentication';
import { admitCardPlan, admitCardRecord } from '../../../server/admit-cards';
import type { TestDetail } from '../../../server/assessments';
import { venueText } from '../../../server/pdf/admit-card';
import { ActionForm } from '../../../ui/action-form';
import { Unavailable } from '../../../ui/cross-module';
import { load } from '../../../ui/frame';
import { DetailTable, Segment } from '../../../ui/sections';

const TITLE = 'Admit cards';

export async function AdmitCards({ d, user }: { d: TestDetail; user: AuthenticatedUser }) {
  const id = d.assessment.id;
  const r = await load(async (db) => {
    const record = await admitCardRecord(user, id);
    return record.status === 'available'
      ? { ...record, plan: await admitCardPlan(db, user, record.data) }
      : record;
  });
  if (!r.ok) return <Segment title={TITLE}>{r.view}</Segment>;
  if (r.data.status !== 'available')
    return (
      <Segment title={TITLE}>
        <Unavailable name="Academic OS" result={r.data} />
      </Segment>
    );
  const { data: a, plan } = r.data;
  const t = a.assessment;
  const numbered = a.rows.filter((x) => x.rollNumber !== null).length;
  if (t.status === 'cancelled')
    return (
      <Segment title={TITLE}>
        <p className="el-field-hint">This test is cancelled: no admit cards are printed.</p>
      </Segment>
    );
  const api = `/ops/api/v1/assessments/${id}/admit-cards`;
  return (
    <Segment
      title={TITLE}
      description="Two cards per A4 sheet. Roll numbers are given once, by batch then name, and never reused."
    >
      <div className="el-stack">
        <DetailTable
          rows={[
            {
              label: 'Roll numbers',
              value: t.rosterSnapshotAt
                ? `${numbered} of ${a.rows.length} students numbered`
                : 'Take the roster first',
            },
            { label: 'Venue', value: venueText(t) },
            {
              label: 'Instructions',
              value: t.instructions ?? `Default text from Settings: ${plan.instructions}`,
            },
            plan.leaveOut && {
              label: 'No card (overdue fees)',
              value: plan.leftOut.length
                ? plan.leftOut
                    .map((x) => `${x.displayName} (${x.admissionNumber ?? 'no admission number'})`)
                    .join(', ')
                : 'Nobody on this roster',
            },
          ]}
        />
        {t.rosterSnapshotAt && numbered < a.rows.length ? (
          <ActionForm
            action={api}
            submitLabel="Give roll numbers"
            extra={{ action: 'roll_numbers' }}
            successText="Roll numbers given."
            compact
          />
        ) : null}
        {a.rows.length > 0 && numbered === a.rows.length ? (
          <p>
            Download admit cards (PDF): <a href={api}>all batches</a>
            {d.assessment.batches.map((b) => (
              <span key={b.batchId}>
                {' · '}
                <a href={`${api}?batchId=${b.batchId}`}>
                  {b.code}
                  <span className="el-visually-hidden"> only</span>
                </a>
              </span>
            ))}
          </p>
        ) : null}
        <details>
          <summary>Change the venue or the instructions</summary>
          <ActionForm
            action={api}
            submitLabel="Save venue and instructions"
            extra={{ action: 'venue' }}
            successText="Saved."
            fields={[
              {
                name: 'venue',
                label: 'Venue',
                type: 'select',
                required: true,
                defaultValue: t.venue.online ? 'online' : (t.venue.roomId ?? 'not_set'),
                options: [
                  { value: 'not_set', label: 'Not set yet' },
                  { value: 'online', label: 'Online' },
                  ...a.rooms.map((room) => ({ value: room.id, label: room.label })),
                ],
              },
              {
                name: 'instructions',
                label: 'Instructions for this test',
                type: 'textarea',
                defaultValue: t.instructions ?? '',
                hint: 'Leave empty to print the default text from Settings. Up to 600 characters.',
              },
            ]}
          />
        </details>
      </div>
    </Segment>
  );
}
