/** Calendar item badge and form fields, shared by the calendar, the item page and Deliverables. */
import {
  Field,
  Select,
  SourceBadge,
  StatusBadge,
  TextArea,
  TextInput,
  type Tone,
} from '@elevate/shared-ui';
import {
  CALENDAR_ITEM_TYPES,
  CALENDAR_STATUS_LABELS,
  CHANNELS,
  CHANNEL_LABELS,
  ITEM_TYPE_LABELS,
  type CalendarStatus,
} from '../../domain/calendar';
import type { CalendarItemRow, CalendarOptions } from '../../server/calendar';

const TONES: Record<CalendarStatus, Tone> = {
  idea: 'neutral',
  planned: 'neutral',
  in_production: 'info',
  submitted: 'info',
  approved: 'success',
  scheduled: 'info',
  published: 'success',
  changes_requested: 'warning',
  cancelled: 'neutral',
};

export function CalendarStatusBadge({ status }: { status: CalendarStatus }) {
  return <StatusBadge tone={TONES[status]}>{CALENDAR_STATUS_LABELS[status]}</StatusBadge>;
}

export const SampleBadge = ({ sample }: { sample: boolean }) => (
  <SourceBadge source={sample ? 'sample' : 'live'} note="Fictional record for the demo" />
);

/** `datetime-local` value in IST for an instant. */
export const istInput = (at: Date | null) =>
  at ? new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 16) : undefined;

/** A labelled select; without `empty` a choice is required. */
export function Choice({
  id,
  label,
  value,
  options,
  empty,
  hint,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  options: readonly (readonly [string, string])[];
  empty?: string;
  hint?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Select id={id} name={id} defaultValue={value ?? ''} required={!empty}>
        {empty ? <option value="">{empty}</option> : null}
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Every §12 field; `item` fills them for editing. */
export function ItemFields({
  options,
  item,
}: {
  options: CalendarOptions;
  item?: CalendarItemRow;
}) {
  return (
    <>
      <Field id="title" label="Title">
        <TextInput
          id="title"
          name="title"
          required
          minLength={3}
          maxLength={300}
          defaultValue={item?.title}
        />
      </Field>
      <Choice
        id="itemType"
        label="Type"
        value={item?.itemType}
        options={CALENDAR_ITEM_TYPES.map((t) => [t, ITEM_TYPE_LABELS[t]])}
      />
      <Choice
        id="programmeId"
        label="Course"
        value={item?.programmeId}
        empty="Not tied to one course"
        options={options.courses.map((c) => [c.id, c.name])}
      />
      <Field id="audience" label="Audience">
        <TextInput
          id="audience"
          name="audience"
          maxLength={500}
          defaultValue={item?.audience ?? ''}
        />
      </Field>
      <Choice
        id="channel"
        label="Channel"
        value={item?.channel}
        empty="Not decided"
        options={CHANNELS.map((c) => [c, CHANNEL_LABELS[c]])}
      />
      <Choice
        id="campaignId"
        label="Campaign"
        value={item?.campaignId}
        empty="No campaign"
        options={options.campaigns.map((c) => [c.id, `${c.code} · ${c.name}`])}
      />
      <Choice
        id="ownerStaffId"
        label="Owner"
        value={item?.ownerStaffId}
        empty="Not set"
        hint="An employee owns the items they add. Only a marketing manager can choose someone else or leave it unset."
        options={options.owners.map((o) => [o.id, o.name])}
      />
      <Field id="brief" label="Brief">
        <TextArea
          id="brief"
          name="brief"
          rows={4}
          maxLength={5000}
          defaultValue={item?.brief ?? ''}
        />
      </Field>
      <Field id="assetLinks" label="Asset links" hint="One http(s) link per line, up to 20.">
        <TextArea
          id="assetLinks"
          name="assetLinks"
          rows={3}
          defaultValue={item?.assetLinks.join('\n')}
        />
      </Field>
    </>
  );
}
