/**
 * `<base>/leads/sharing`: automatic lead sharing rules (F4-16), for whoever may assign leads.
 * One rule per programme plus a default; saving a programme's rule replaces the one it has.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { OPS_LEAD_ASSIGNMENT_MODES } from '@elevate/database';
import { ButtonLink, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { DECISION_STATE_LABELS } from '../../domain';
import {
  listSharingRules,
  SHARING_MODE_LABELS,
  type SharingRuleRow,
} from '../../server/lead-sharing';
import { formOptions } from '../../server/options';
import { loadSettings } from '../../server/settings';
import { ActionForm, type FieldSpec } from '../../ui/action-form';
import { load, Section } from '../../ui/frame';
import { listHref } from '../../ui/list-controls';
import { FormModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import '../ops.css';

type Params = Record<string, string | undefined>;

export function LeadSharingBody({
  user,
  base,
  sp,
  tabs,
}: {
  user: AuthenticatedUser;
  base: string;
  sp: Params;
  tabs?: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title="Lead sharing"
        description={
          <>
            Who gets a new lead that nobody owns: leads from the website form, imports and leads
            saved without an owner. A programme without its own rule uses the default rule.{' '}
            <a href={`${base}/leads`}>All leads</a>
          </>
        }
        tabs={tabs}
      />
      <Section>
        <Rules user={user} base={base} sp={sp} />
      </Section>
    </>
  );
}

async function Rules({ user, base, sp }: { user: AuthenticatedUser; base: string; sp: Params }) {
  const r = await load(async (db) => {
    const [rules, opts, settings] = await Promise.all([
      listSharingRules(db, user),
      formOptions(db),
      loadSettings(db),
    ]);
    return { rules, opts, sharing: settings['leads.sharing.enabled'] };
  });
  if (!r.ok) return r.view;
  const { rules, opts, sharing } = r.data;
  const page = `${base}/leads/sharing`;
  const close = listHref(page, sp, { act: undefined, edit: undefined });
  const editing = rules.find((x) => x.id === sp.edit);
  const api = `${base}/api/v1/lead-sharing`;
  return (
    <div className="el-stack">
      <p>
        Automatic sharing is{' '}
        <StatusBadge tone={sharing.value.enabled ? 'success' : 'neutral'}>
          {sharing.value.enabled ? 'On' : 'Off'}
        </StatusBadge>{' '}
        ({DECISION_STATE_LABELS[sharing.decisionState]}).{' '}
        {sharing.value.enabled
          ? 'New leads with no owner go to the counsellors below.'
          : 'New leads with no owner stay unassigned; the rules below wait until it is switched on.'}{' '}
        {/* The setting lives in Business Ops OS on every mount (Marketing's settings are its own). */}
        {can(user, 'ops:module:access') && can(user, 'ops:settings:read') ? (
          <a href="/ops/settings?open=leads.sharing.enabled">Open it in Business Ops OS settings</a>
        ) : (
          'Ask an operations manager to switch it on in Business Ops OS settings.'
        )}
      </p>
      <div className="el-page-actions">
        <ButtonLink href={listHref(page, sp, { act: 'new', edit: undefined })} variant="primary">
          Add a rule
        </ButtonLink>
        <ButtonLink href={api} download>
          Download (spreadsheet)
        </ButtonLink>
      </div>
      <RecordTable
        caption={`${rules.length} rule${rules.length === 1 ? '' : 's'}`}
        rows={rules}
        rowKey={(x) => x.id}
        empty={
          <EmptyState
            title="No sharing rules yet"
            description="Add a default rule to share every new lead, or one rule per programme."
          />
        }
        columns={[
          { key: 'programmeName', header: 'Programme' },
          { key: 'mode', header: 'How', render: (x) => SHARING_MODE_LABELS[x.mode] },
          {
            key: 'counsellors',
            header: 'Counsellors in turn order',
            render: (x) =>
              x.counsellors
                .map((c) => (c.active ? c.fullName : `${c.fullName} (not active: skipped)`))
                .join(', '),
          },
          { key: 'dailyCap', header: 'Daily cap each', render: (x) => x.dailyCap ?? 'No cap' },
          {
            key: 'last',
            header: 'Last lead went to',
            render: (x) => x.lastAssignedName ?? 'No lead yet',
          },
          {
            key: 'change',
            header: 'Change',
            render: (x) => (
              <>
                <a href={listHref(page, sp, { edit: x.id, act: undefined })}>
                  Change<span className="el-visually-hidden"> {x.programmeName}</span>
                </a>
                <ActionForm
                  action={`${api}/${x.id}`}
                  method="DELETE"
                  submitLabel="Remove rule"
                  labelSuffix={` ${x.programmeName}`}
                  variant="danger"
                  compact
                />
              </>
            ),
          },
        ]}
      />
      {sp.act === 'new' || editing ? (
        <FormModal
          id="sharing-rule"
          title={editing ? `Change: ${editing.programmeName}` : 'Add a sharing rule'}
          meta="Saving a rule for a programme that already has one replaces it."
          closeHref={close}
        >
          <ActionForm
            action={api}
            submitLabel="Save rule"
            redirectTo={close}
            fields={ruleFields(opts, editing)}
          />
        </FormModal>
      ) : null}
    </div>
  );
}

function ruleFields(
  opts: Awaited<ReturnType<typeof formOptions>>,
  rule: SharingRuleRow | undefined,
): FieldSpec[] {
  const chosen = new Set<string>(rule?.counsellorStaffIds ?? []);
  return [
    {
      name: 'programmeCode',
      label: 'Programme (empty: the default rule)',
      type: 'select',
      options: opts.programmes,
      defaultValue: rule ? (rule.programmeCode ?? '') : undefined,
    },
    {
      name: 'mode',
      label: 'How leads are shared',
      type: 'select',
      required: true,
      defaultValue: rule?.mode ?? 'round_robin',
      options: OPS_LEAD_ASSIGNMENT_MODES.map((m) => ({ value: m, label: SHARING_MODE_LABELS[m] })),
      hint: 'In turn: each counsellor in order. Fewest open leads: whoever has the fewest leads still open.',
    },
    {
      name: 'dailyCap',
      label: 'Most new leads per counsellor per day (empty: no cap)',
      type: 'number',
      defaultValue: rule?.dailyCap ? String(rule.dailyCap) : undefined,
      hint: 'Counts every lead a counsellor was given today, by rule or by hand. When everyone is at the cap the lead stays unassigned.',
    },
    ...opts.staff.map((s) => ({
      name: `counsellors.${s.value}`,
      label: s.label,
      type: 'checkbox' as const,
      defaultValue: String(chosen.has(s.value)),
      section: 'Counsellors (active staff)',
    })),
  ];
}
