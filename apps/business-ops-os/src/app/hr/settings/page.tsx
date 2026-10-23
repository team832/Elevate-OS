import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { listHrSettings } from '../../../server/hr-settings';
import { ActionForm } from '../../../ui/action-form';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { StateBadge, valueRows } from '../../settings/_components/setting-value';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HR settings' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/hr/settings';

const GROUPS: [string, RegExp][] = [
  ['Staff and attendance', /^hr\./],
  ['Work reports', /^reports\./],
  ['Student feedback about teachers', /^feedback\./],
  ['Tasks', /^tasks\./],
];

export default async function HrSettingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:hr_settings:manage', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-settings">
      <PageHeader
        title="HR settings"
        description="HR, work-report and feedback rules. A value changed here stays Proposed until the owner approves it."
      />
      <Section>
        <Settings user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Settings({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const r = await load((db) => listHrSettings(db, user));
  if (!r.ok) return r.view;
  const close = listHref(BASE, sp, { open: undefined });
  const open = r.data.find((s) => s.key === sp.open && s.editable);
  return (
    <div className="el-stack">
      {GROUPS.map(([title, re]) => (
        <Segment key={title} title={title} flush>
          <RecordTable
            caption={title}
            rows={r.data.filter((s) => re.test(s.key))}
            rowKey={(s) => s.key}
            rowHref={(s) => (s.editable ? listHref(BASE, sp, { open: s.key }) : '')}
            linkColumn="label"
            columns={[
              { key: 'label', header: 'Setting' },
              { key: 'description', header: 'What it controls' },
              {
                key: 'value',
                header: 'Current value',
                render: (s) => <DetailTable rows={valueRows(s.value)} />,
              },
              {
                key: 'state',
                header: 'Decision state',
                render: (s) => (
                  <>
                    <StateBadge state={s.decisionState} />
                    {s.editable ? null : <p className="el-field-hint">Fixed for now</p>}
                  </>
                ),
              },
            ]}
          />
        </Segment>
      ))}
      {open ? (
        <FormModal
          id="hr-setting-edit"
          title={`Change: ${open.label}`}
          meta="The new value is saved as Proposed."
          closeHref={close}
        >
          <DetailTable rows={[{ label: 'What it controls', value: open.description }]} />
          <ActionForm
            action={`/ops/api/v1/hr/settings/${open.key}`}
            method="PUT"
            submitLabel="Save as proposed"
            redirectTo={close.replace(/^\/ops/, '')}
            secondary={<a href={close}>Cancel</a>}
            fields={[
              {
                name: 'value',
                label: 'Value (JSON)',
                type: 'json',
                required: true,
                defaultValue: JSON.stringify(open.value, null, 2),
                section: 'Value',
              },
              { name: 'note', label: 'Why', section: 'Value' },
            ]}
          />
        </FormModal>
      ) : null}
    </div>
  );
}
