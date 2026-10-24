/** The ideas-board fields (brief §13) for the new and edit forms. */
import { Field, TextArea, TextInput } from '@elevate/shared-ui';
import {
  CALENDAR_ITEM_TYPES,
  CHANNELS,
  CHANNEL_LABELS,
  EFFORT_LABELS,
  EFFORT_SIZES,
  ITEM_TYPE_LABELS,
} from '../../domain/calendar';
import type { IdeaRow } from '../../server';
import type { CalendarOptions } from '../../server/calendar';
import { Choice } from '../calendar/item-ui';

const Text = ({
  id,
  label,
  value,
  rows,
}: {
  id: string;
  label: string;
  value?: string | null;
  rows?: number;
}) => (
  <Field id={id} label={label}>
    {rows ? (
      <TextArea id={id} name={id} rows={rows} maxLength={2000} defaultValue={value ?? ''} />
    ) : (
      <TextInput id={id} name={id} maxLength={500} defaultValue={value ?? ''} />
    )}
  </Field>
);

export function IdeaBoardFields({ options, idea }: { options: CalendarOptions; idea?: IdeaRow }) {
  return (
    <>
      <Text id="problemNeed" label="Problem or audience need" value={idea?.problemNeed} rows={2} />
      <Text id="audience" label="Target audience" value={idea?.audience} />
      <Choice
        id="programmeId"
        label="Relevant course"
        value={idea?.programmeId}
        empty="Not tied to one course"
        options={options.courses.map((c) => [c.id, c.name])}
      />
      <Choice
        id="proposedFormat"
        label="Proposed format"
        value={idea?.proposedFormat}
        empty="Not decided"
        options={CALENDAR_ITEM_TYPES.map((t) => [t, ITEM_TYPE_LABELS[t]])}
      />
      <Choice
        id="proposedChannel"
        label="Proposed channel"
        value={idea?.proposedChannel}
        empty="Not decided"
        options={CHANNELS.map((c) => [c, CHANNEL_LABELS[c]])}
      />
      <Text id="hypothesis" label="Hypothesis" value={idea?.hypothesis} rows={2} />
      <Choice
        id="effort"
        label="Effort estimate"
        value={idea?.effort}
        empty="Not estimated"
        options={EFFORT_SIZES.map((e) => [e, EFFORT_LABELS[e]])}
      />
      <Text id="expectedOutcome" label="Expected outcome" value={idea?.expectedOutcome} rows={2} />
      <Choice
        id="ownerStaffId"
        label="Owner"
        value={idea?.ownerStaffId}
        empty="No owner yet"
        options={options.owners.map((o) => [o.id, o.name])}
      />
      <Choice
        id="campaignId"
        label="Related campaign"
        value={idea?.campaignId}
        empty="No campaign"
        options={options.campaigns.map((c) => [c.id, `${c.code} · ${c.name}`])}
      />
    </>
  );
}
