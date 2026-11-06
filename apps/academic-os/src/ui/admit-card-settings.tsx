/**
 * Admit cards on an Academic test page (F4-03), for academic coordinators: give roll numbers, set
 * the venue and instructions. Business Operations prints the cards from the same record.
 */
import { getDb } from '@elevate/database';
import { Card } from '@elevate/shared-ui';
import { admitCardsFor } from '../server/services/admit-cards';
import { ApiForm } from './api-form';

export async function AdmitCardSettings({ id, action }: { id: string; action: string }) {
  const d = await admitCardsFor(getDb(), id);
  const t = d.assessment;
  const numbered = d.rows.filter((r) => r.rollNumber !== null).length;
  return (
    <Card
      title="Admit cards"
      description="Roll numbers are given once, by batch then name, and never reused. Business Operations prints the cards (Tests and mock tests)."
    >
      <p>
        {numbered} of {d.rows.length} students numbered. Venue:{' '}
        {t.venue.online ? 'Online' : (t.venue.roomName ?? 'not set')}. Instructions:{' '}
        {t.instructions ?? 'the default text from Business Operations settings'}.
      </p>
      {numbered < d.rows.length ? (
        <ApiForm
          action={action}
          submitLabel="Give roll numbers"
          successMessage="Roll numbers given."
          extra={{ action: 'roll_numbers' }}
          idPrefix="rolls"
          fields={[]}
        />
      ) : null}
      <ApiForm
        action={action}
        submitLabel="Save venue and instructions"
        extra={{ action: 'venue' }}
        idPrefix="venue"
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
              ...d.rooms.map((r) => ({ value: r.id, label: r.label })),
            ],
          },
          {
            name: 'instructions',
            label: 'Instructions for this test',
            type: 'textarea',
            defaultValue: t.instructions ?? '',
            hint: 'Leave empty for the default text. Up to 600 characters.',
          },
        ]}
      />
    </Card>
  );
}
