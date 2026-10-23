/** Campaign owner and members, with add/end forms for whoever may manage campaigns. */
import { Button, Card, DataTable, EmptyState, Field, Select, TextInput } from '@elevate/shared-ui';
import { addCampaignMemberAction, endCampaignMemberAction } from '../app/actions/campaigns';
import { CAMPAIGN_MEMBER_ROLE_LABELS, type listCampaignMembers } from '../server';

type Member = Awaited<ReturnType<typeof listCampaignMembers>>[number];

export function CampaignMembers({
  campaignId,
  members,
  options,
}: {
  campaignId: string;
  members: readonly Member[];
  /** People who can be added; null = the viewer cannot manage members. */
  options: readonly { id: string; name: string }[] | null;
}) {
  return (
    <Card
      title="Owner and members"
      description="Members see this campaign and its content in Marketing OS. Ending a membership keeps it in the history."
    >
      <DataTable
        compact
        rows={members}
        rowKey={(m) => m.id}
        empty={<EmptyState title="Nobody is on this campaign yet" />}
        columns={[
          { key: 'name', header: 'Person', render: (m) => m.staffName },
          { key: 'role', header: 'Role', render: (m) => CAMPAIGN_MEMBER_ROLE_LABELS[m.role] },
          { key: 'from', header: 'From', render: (m) => m.fromDate },
          { key: 'to', header: 'Until', render: (m) => m.toDate ?? 'Current' },
          ...(options
            ? [
                {
                  key: 'end',
                  header: 'Action',
                  render: (m: Member) =>
                    m.toDate ? null : (
                      <form action={endCampaignMemberAction}>
                        <input type="hidden" name="campaignId" value={campaignId} />
                        <input type="hidden" name="memberId" value={m.id} />
                        <Button type="submit" variant="secondary">
                          End membership
                          <span className="el-visually-hidden"> of {m.staffName}</span>
                        </Button>
                      </form>
                    ),
                },
              ]
            : []),
        ]}
      />
      {options ? (
        options.length ? (
          <form action={addCampaignMemberAction} className="el-grid">
            <input type="hidden" name="campaignId" value={campaignId} />
            <Field id="staffId" label="Person">
              <Select id="staffId" name="staffId" required>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="role" label="Role">
              <Select id="role" name="role">
                <option value="member">{CAMPAIGN_MEMBER_ROLE_LABELS.member}</option>
                <option value="owner">{CAMPAIGN_MEMBER_ROLE_LABELS.owner}</option>
              </Select>
            </Field>
            <Field id="fromDate" label="From" hint="Leave empty for today (IST).">
              <TextInput
                id="fromDate"
                name="fromDate"
                type="date"
                aria-describedby="fromDate-hint"
              />
            </Field>
            <div>
              <Button type="submit">Add to campaign</Button>
            </div>
          </form>
        ) : (
          <p className="el-field-hint">
            No active staff in Marketing &amp; Growth to add. Link people to the department in the
            Staff directory first.
          </p>
        )
      ) : null}
    </Card>
  );
}
