import { Fragment } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader, SETTINGS_STATE_NOTE } from '@elevate/shared-ui';
import { listHrSettings } from '../../../server/hr-settings';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import {
  remindersPreviewOf,
  SETTING_COLUMNS,
  SettingEditForm,
} from '../../settings/_components/setting-value';

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
        description={`HR, work-report and feedback rules. ${SETTINGS_STATE_NOTE} A value you change here works straight away and shows that way until the owner approves it.`}
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
      {GROUPS.map(([title, re]) => {
        const rows = r.data.filter((s) => re.test(s.key));
        return (
          <Fragment key={title}>
            <Segment title={title} flush>
              <RecordTable
                caption={title}
                rows={rows}
                rowKey={(s) => s.key}
                rowHref={(s) => (s.editable ? listHref(BASE, sp, { open: s.key }) : '')}
                linkColumn="label"
                columns={SETTING_COLUMNS}
              />
            </Segment>
            {remindersPreviewOf(rows)}
          </Fragment>
        );
      })}
      {open ? (
        <FormModal
          id="hr-setting-edit"
          title={`Change: ${open.label}`}
          meta="It works straight away and shows as not yet approved."
          closeHref={close}
        >
          <DetailTable rows={[{ label: 'What it controls', value: open.description }]} />
          {remindersPreviewOf([open])}
          <SettingEditForm s={open} api="/ops/api/v1/hr/settings" close={close} />
        </FormModal>
      ) : null}
    </div>
  );
}
