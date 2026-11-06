import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Fragment } from 'react';
import { EmptyState, PageHeader, SETTINGS_STATE_NOTE, StatusBadge } from '@elevate/shared-ui';
import type { ResolvedSetting } from '../../domain';
import { getCrmAdapter } from '../../server/adapters/crm';
import { listJobs } from '../../server/jobs';
import { listTemplates } from '../../server/onboarding';
import { listSettings } from '../../server/settings';
import { AdmissionsNav } from '../../ui/admissions-nav';
import { humanise } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, SearchPanel } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';
import { BackgroundJobs } from './_components/background-jobs';
import { OnboardingTemplates } from './_components/onboarding-templates';
import {
  decisionWords,
  INVALID_STORED,
  remindersPreviewOf,
  SETTING_COLUMNS,
  SettingEditForm,
  settingStateWord,
  StateBadge,
  valueRows,
} from './_components/setting-value';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/settings';
/** Settings shown under Admissions → Settings (owner brief §4). */
const ADMISSIONS_PREFIXES = [
  'admission',
  'demo.',
  'fees.',
  'events.',
  'reports.',
  'kpi.conversion',
];
const inAdmissions = (key: string) => ADMISSIONS_PREFIXES.some((p) => key.startsWith(p));

const ORIGIN_TEXT: Record<string, string> = {
  default: 'Default',
  stored: 'Changed in Elevate OS',
};

/** Groups in display order; the first matching pattern wins (demo keys before admission keys). */
const GROUPS: [string, RegExp][] = [
  ['Admissions', /^(admissions?\.(?!demo\.)|followups\.|kpi\.)/],
  ['Demos', /^((admissions\.)?demo\.|pipeline\.demo)/],
  ['Fees', /^fees\./],
  ['Events and appointments', /^(events|appointments)\./],
  ['Reports', /^reports\./],
  ['Leads and website form', /^leads\./],
  ['Student and parent portal', /^portal\./],
  ['Other', /./],
];
const groupOf = (key: string) => GROUPS.find(([, re]) => re.test(key))![0];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:settings:read', BASE);
  const sp = await searchParams;
  const admissions = sp.group === 'admissions';
  return (
    <Frame access={access} active="settings">
      <PageHeader
        title={admissions ? 'Admissions settings' : 'Configuration and policy states'}
        description={`What each rule is set to now. ${SETTINGS_STATE_NOTE} A value you change here works straight away and shows that way until the owner approves it.`}
        tabs={admissions ? <AdmissionsNav current="settings" user={access.user} /> : undefined}
      />
      <Section>
        <Settings user={access.user} sp={sp} admissions={admissions} />
      </Section>
    </Frame>
  );
}

async function Settings({
  user,
  sp,
  admissions,
}: {
  user: AuthenticatedUser;
  sp: Params;
  admissions: boolean;
}) {
  const r = await load(async (db) => {
    const [settings, crm, templates, jobs] = await Promise.all([
      listSettings(db, user),
      getCrmAdapter().status(),
      admissions ? listTemplates(db, user) : [],
      admissions ? [] : listJobs(db, user),
    ]);
    // Job settings have their own section (BackgroundJobs).
    return { settings: settings.filter((s) => !s.key.startsWith('jobs.')), crm, templates, jobs };
  });
  if (!r.ok) return r.view;
  const { settings, crm, templates, jobs } = r.data;
  const q = sp.q?.trim().toLowerCase();
  const rows = settings.filter(
    (s) =>
      (!admissions || inAdmissions(s.key)) &&
      (!q || `${s.label} ${s.description}`.toLowerCase().includes(q)) &&
      (!sp.state || s.decisionState === sp.state),
  );
  const groups = GROUPS.map(([title]) => ({
    title,
    items: rows.filter((s) => groupOf(s.key) === title),
  })).filter((g) => g.items.length);
  const states = [...new Set(settings.map((s) => s.decisionState))];
  const open = settings.find((s) => s.key === sp.open);
  const manage = can(user, 'ops:settings:manage');
  const close = (patch: Params) => listHref(BASE, sp, patch);
  const changeLink = (s: ResolvedSetting) =>
    manage && s.editable ? (
      <a href={close({ open: s.key, act: 'edit' })}>Change this setting</a>
    ) : undefined;
  return (
    <div className="el-stack">
      {admissions ? null : (
        <Segment title="External CRM" flush>
          <DetailTable
            rows={[
              {
                label: 'Connection',
                value: <StatusBadge tone="neutral">{humanise(crm.connection)}</StatusBadge>,
              },
              { label: 'Detail', value: crm.detail },
            ]}
          />
        </Segment>
      )}
      {admissions ? null : <BackgroundJobs jobs={jobs} canRun={can(user, 'ops:jobs:run')} />}
      <SearchPanel
        action={BASE}
        hidden={admissions ? { group: 'admissions' } : undefined}
        search={{ name: 'q', label: 'Setting name', value: sp.q }}
        filters={[
          {
            name: 'state',
            label: 'Status',
            type: 'select',
            value: sp.state,
            options: states.map((s) => ({ value: s, label: settingStateWord(s) })),
          },
        ]}
      />
      {groups.length ? (
        groups.map((g) => (
          <Fragment key={g.title}>
            <Segment title={g.title} flush>
              <RecordTable
                caption={`${g.title}: ${g.items.length} setting${g.items.length === 1 ? '' : 's'}`}
                rows={g.items}
                rowKey={(s) => s.key}
                rowHref={(s) => close({ open: s.key, act: undefined })}
                linkColumn="label"
                columns={SETTING_COLUMNS}
              />
            </Segment>
            {remindersPreviewOf(g.items)}
          </Fragment>
        ))
      ) : (
        <EmptyState
          title="No settings match"
          description="Clear the search or the status filter."
        />
      )}
      {admissions ? <OnboardingTemplates templates={templates} manage={manage} sp={sp} /> : null}
      {open && sp.act === 'edit' && manage && open.editable ? (
        <FormModal
          id="setting-edit"
          title={`Change: ${open.label}`}
          meta="It works straight away and shows as not yet approved."
          closeHref={close({ act: undefined })}
        >
          {remindersPreviewOf([open])}
          <SettingEditForm s={open} api="/ops/api/v1/settings" close={close({ act: undefined })} />
        </FormModal>
      ) : open ? (
        <RecordModal
          id="setting-modal"
          title={open.label}
          meta={<StateBadge state={open.decisionState} />}
          closeHref={close({ open: undefined, act: undefined })}
          returnId={open.key}
        >
          <Segment title="Current value" level={3} flush actions={changeLink(open)}>
            <DetailTable rows={valueRows(open.value)} />
          </Segment>
          {remindersPreviewOf([open])}
          <Segment title="Setting" level={3} flush>
            <DetailTable
              rows={[
                { label: 'What it controls', value: open.description },
                { label: 'Status', value: <StateBadge state={open.decisionState} /> },
                open.ownerDecision && {
                  label: 'Owner decision',
                  value: decisionWords(open.ownerDecision),
                },
                { label: 'Value from', value: ORIGIN_TEXT[open.origin] ?? INVALID_STORED },
                { label: 'Editable here', value: open.editable ? 'Yes' : 'No' },
              ]}
            />
          </Segment>
        </RecordModal>
      ) : null}
    </div>
  );
}
