import { MARKETING_CHANNELS, type marketingCampaigns } from '@elevate/database';
import { Button, Card, Checkbox, Field, TextInput } from '@elevate/shared-ui';
import { CAMPAIGN_TRANSITIONS, CHANNEL_LABELS } from '../../../server/campaigns';
import { CAMPAIGN_STATUS_LABELS } from '../../../ui/campaigns';
import { PickField, type Option } from '../../../ui/fields';
import { updateCampaignAction } from '../actions';

type Campaign = typeof marketingCampaigns.$inferSelect;

/** Edit a campaign's fields and status (managers; the service re-checks marketing:campaigns:write). */
export function CampaignEditForm({
  campaign: c,
  courses,
}: {
  campaign: Campaign;
  courses: readonly Option[];
}) {
  return (
    <Card title="Edit campaign" description="Every change is recorded in the audit log.">
      <form action={updateCampaignAction} className="el-stack">
        <input type="hidden" name="campaignId" value={c.id} />
        <div className="el-grid">
          <Field id="name" label="Name">
            <TextInput id="name" name="name" required minLength={2} defaultValue={c.name} />
          </Field>
          <PickField
            id="status"
            label="Status"
            value={c.status}
            options={[c.status, ...CAMPAIGN_TRANSITIONS[c.status]].map((st) => ({
              id: st,
              name: CAMPAIGN_STATUS_LABELS[st]!,
            }))}
            hint="Ended and cancelled campaigns cannot be reopened."
          />
          <Field id="startsOn" label="Starts">
            <TextInput id="startsOn" name="startsOn" type="date" defaultValue={c.startsOn ?? ''} />
          </Field>
          <Field id="endsOn" label="Ends">
            <TextInput id="endsOn" name="endsOn" type="date" defaultValue={c.endsOn ?? ''} />
          </Field>
          <PickField
            id="programmeId"
            label="Course"
            value={c.programmeId}
            options={courses}
            none="All or several courses"
          />
          <Field id="audience" label="Audience">
            <TextInput
              id="audience"
              name="audience"
              maxLength={300}
              defaultValue={c.audience ?? ''}
              placeholder="Class 12 students in Sikar planning for IPMAT"
            />
          </Field>
          <Field id="objective" label="Objective">
            <TextInput
              id="objective"
              name="objective"
              maxLength={1000}
              defaultValue={c.objective ?? ''}
            />
          </Field>
        </div>
        <fieldset className="el-inline-form">
          <legend>Channels</legend>
          {MARKETING_CHANNELS.map((ch) => (
            <Checkbox
              key={ch}
              name="channels"
              value={ch}
              label={CHANNEL_LABELS[ch]}
              defaultChecked={c.channels.includes(ch)}
            />
          ))}
        </fieldset>
        <div>
          <Button type="submit">Save campaign</Button>
        </div>
      </form>
    </Card>
  );
}
