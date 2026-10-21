import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { DECISION_STATE_LABELS, type ResolvedSetting } from '../../domain';
import { getCrmAdapter } from '../../server/adapters/crm';
import { listTemplates } from '../../server/onboarding';
import { listSettings } from '../../server/settings';
import { ActionForm } from '../../ui/action-form';
import { AdmissionsNav } from '../../ui/admissions-nav';
import { humanise } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, SearchPanel } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';
import { OnboardingTemplates } from './_components/onboarding-templates';
import { decisionCodes, StateBadge, valueRows } from './_components/setting-value';

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
  default: 'Default from the legacy record',
  stored: 'Changed in Elevate OS',
};
const INVALID = 'Stored value invalid: default used';

/** Groups in display order; the first matching pattern wins (demo keys before admission keys). */
const GROUPS: [string, RegExp][] = [
  ['Admissions', /^(admissions?\.(?!demo\.)|followups\.|kpi\.)/],
  ['Demos', /^((admissions\.)?demo\.|pipeline\.demo)/],
  ['Fees', /^fees\./],
  ['Events and appointments', /^(events|appointments)\./],
  ['Reports', /^reports\./],
  ['Other', /./],
];
const groupOf = (key: string) => GROUPS.find(([, re]) => re.test(key))![0];

/** "Source: D-038" (a small hint), or nothing when no decision record is named. */
const SourceHint = ({ s }: { s: ResolvedSetting }) => {
  const codes = decisionCodes(s.ownerDecision);
  return codes ? <p className="el-field-hint">Source: {codes}</p> : null;
};

/** A one-field value reads inline ("Amount: ₹1,000"); larger values become label/value rows. */
function Value({ s }: { s: ResolvedSetting }) {
  const [first, ...rest] = valueRows(s.value);
  return first && !rest.length ? (
    <>
      {first.label}: {first.value}
    </>
  ) : (
    <DetailTable rows={valueRows(s.value)} />
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:settings:read', BASE);
  const sp = await searchParams;
  const admissions = sp.group === 'admissions';
  return (
    <Frame access={access} active="settings">
      <PageHeader
        title={admissions ? 'Admissions settings' : 'Configuration and policy states'}
        description="What each rule is set to now. A change made here stays Proposed until leadership approves it."
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
    const [settings, crm, templates] = await Promise.all([
      listSettings(db, user),
      getCrmAdapter().status(),
      admissions ? listTemplates(db, user) : [],
    ]);
    return { settings, crm, templates };
  });
  if (!r.ok) return r.view;
  const { settings, crm, templates } = r.data;
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
      <a href={close({ open: s.key, act: 'edit' })}>Change (stays proposed)</a>
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
      <SearchPanel
        action={BASE}
        hidden={admissions ? { group: 'admissions' } : undefined}
        search={{ name: 'q', label: 'Setting name', value: sp.q }}
        filters={[
          {
            name: 'state',
            label: 'Decision state',
            type: 'select',
            value: sp.state,
            options: states.map((s) => ({ value: s, label: DECISION_STATE_LABELS[s] })),
          },
        ]}
      />
      {groups.length ? (
        groups.map((g) => (
          <Segment key={g.title} title={g.title} flush>
            <RecordTable
              caption={`${g.title}: ${g.items.length} setting${g.items.length === 1 ? '' : 's'}`}
              rows={g.items}
              rowKey={(s) => s.key}
              rowHref={(s) => close({ open: s.key, act: undefined })}
              linkColumn="label"
              columns={[
                { key: 'label', header: 'Setting' },
                { key: 'value', header: 'Current value', render: (s) => <Value s={s} /> },
                {
                  key: 'state',
                  header: 'State',
                  render: (s) => (
                    <>
                      <StateBadge state={s.decisionState} />
                      <SourceHint s={s} />
                      {ORIGIN_TEXT[s.origin] ? null : (
                        <StatusBadge tone="warning">{INVALID}</StatusBadge>
                      )}
                    </>
                  ),
                },
              ]}
            />
          </Segment>
        ))
      ) : (
        <EmptyState title="No settings match" description="Clear the search or the state filter." />
      )}
      {admissions ? <OnboardingTemplates templates={templates} manage={manage} sp={sp} /> : null}
      {open && sp.act === 'edit' && manage && open.editable ? (
        <FormModal
          id="setting-edit"
          title={`Change: ${open.label}`}
          meta="The new value is saved as Proposed."
          closeHref={close({ act: undefined })}
        >
          <ActionForm
            action={`/ops/api/v1/settings/${open.key}`}
            method="PUT"
            submitLabel="Save as proposed"
            redirectTo={close({ act: undefined })}
            secondary={<a href={close({ act: undefined })}>Cancel</a>}
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
          <Segment title="Setting" level={3} flush>
            <DetailTable
              rows={[
                { label: 'What it controls', value: open.description },
                { label: 'Decision state', value: <StateBadge state={open.decisionState} /> },
                open.ownerDecision && { label: 'Owner decision', value: open.ownerDecision },
                { label: 'Value from', value: ORIGIN_TEXT[open.origin] ?? INVALID },
                { label: 'Editable here', value: open.editable ? 'Yes' : 'No' },
              ]}
            />
          </Segment>
          <p className="el-field-hint">Source: {open.source}</p>
        </RecordModal>
      ) : null}
    </div>
  );
}
