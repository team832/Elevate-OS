/**
 * Onboarding checklist templates (owner brief §8): every version, newest first per code, and a
 * form to publish the next version copied from a chosen one (POST /onboarding-templates,
 * ops:settings:manage). Publishing retires the earlier version; built checklists never change.
 */
import { StatusBadge } from '@elevate/shared-ui';
import { CLASS_CATEGORY_LABELS, CLASS_CATEGORY_OPTIONS } from '../../../domain/demos';
import type { OnboardingTemplateItem } from '../../../domain/onboarding';
import { ActionForm } from '../../../ui/action-form';
import { decisionTone, humanise } from '../../../ui/format';
import { listHref } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';

type Params = Record<string, string | undefined>;
type Template = {
  id: string;
  code: string;
  version: number;
  status: string;
  programmeCodes: string[];
  classCategory: string | null;
  items: OnboardingTemplateItem[];
};

const BASE = '/ops/settings';
const classLabel = (c: string | null) =>
  c ? (CLASS_CATEGORY_LABELS[c] ?? humanise(c)) : 'Any class';

function itemText(i: OnboardingTemplateItem) {
  const parts = [humanise(i.kind)];
  if (i.dueDays !== undefined) parts.push(`due ${i.dueDays} day(s) after admission`);
  if (i.kind === 'material')
    parts.push(
      `${i.requiredQuantity ?? 1} cop${(i.requiredQuantity ?? 1) === 1 ? 'y' : 'ies'}${i.programmeCode ? ` for ${i.programmeCode}` : ''}${i.edition ? `, ${i.edition}` : ''}`,
    );
  return `${i.label} (${parts.join(', ')})`;
}

export function OnboardingTemplates({
  templates,
  manage,
  sp,
}: {
  templates: readonly Template[];
  manage: boolean;
  sp: Params;
}) {
  const href = (patch: Params) => listHref(BASE, sp, patch);
  const close = href({ act: undefined, template: undefined });
  const source = templates.find((t) => t.id === sp.template);
  const next = source
    ? Math.max(...templates.filter((t) => t.code === source.code).map((t) => t.version)) + 1
    : 1;
  return (
    <Segment
      id="onboarding-templates"
      title="Onboarding templates"
      description="Checklist items a new student gets, by programme and class. Publishing makes a new version active and retires the earlier one; checklists already built keep their version."
      actions={
        manage ? (
          <a href={href({ act: 'template', template: undefined })}>New template</a>
        ) : undefined
      }
      flush
    >
      <RecordTable
        caption={`${templates.length} template version(s)${manage ? ' · open a row to publish its next version' : ''}`}
        rows={templates}
        rowKey={(t) => t.id}
        rowHref={manage ? (t) => href({ act: 'template', template: t.id }) : undefined}
        linkColumn="code"
        empty="No onboarding template yet."
        columns={[
          { key: 'code', header: 'Template', render: (t) => `${t.code} v${t.version}` },
          {
            key: 'status',
            header: 'Status',
            render: (t) => (
              <StatusBadge tone={t.status === 'active' ? 'success' : decisionTone(t.status)}>
                {humanise(t.status)}
              </StatusBadge>
            ),
          },
          { key: 'programmes', header: 'Programmes', render: (t) => t.programmeCodes.join(', ') },
          { key: 'class', header: 'Class', render: (t) => classLabel(t.classCategory) },
          {
            key: 'items',
            header: 'Items',
            render: (t) => (
              <ul>
                {t.items.map((i) => (
                  <li key={i.key}>{itemText(i)}</li>
                ))}
              </ul>
            ),
          },
        ]}
      />
      {manage && sp.act === 'template' ? (
        <FormModal
          id="template-publish"
          title={source ? `Publish ${source.code} v${next}` : 'New onboarding template'}
          meta={source ? `Copied from v${source.version}; change what you need.` : undefined}
          closeHref={close}
        >
          <ActionForm
            action="/ops/api/v1/onboarding-templates"
            submitLabel={source ? `Publish version ${next}` : 'Publish version 1'}
            // Router path: Next adds the /ops basePath itself (D-022).
            redirectTo={close.replace(/^\/ops/, '')}
            secondary={<a href={close}>Cancel</a>}
            extra={{ classCategory: null }}
            fields={[
              {
                name: 'code',
                label: 'Template code',
                required: true,
                defaultValue: source?.code,
                hint: 'Lower case letters, digits and _. The same code publishes a new version.',
                section: 'Applies to',
              },
              {
                name: 'programmeCodes',
                label: 'Programme codes',
                type: 'list',
                required: true,
                defaultValue: source?.programmeCodes.join(', '),
                hint: 'Comma separated, e.g. CLAT, IPMAT (1 to 10).',
                section: 'Applies to',
              },
              {
                name: 'classCategory',
                label: 'Class',
                type: 'select',
                defaultValue: source?.classCategory ?? '',
                options: CLASS_CATEGORY_OPTIONS,
                hint: 'Leave empty for any class.',
                section: 'Applies to',
              },
              {
                name: 'items',
                label: 'Items',
                type: 'json',
                required: true,
                defaultValue: JSON.stringify(source?.items ?? [], null, 2),
                hint: 'One entry per item (1 to 40): key, label, kind (check, biometric or material), optional dueDays (0 to 365). Material items may add programmeCode, requiredQuantity (1 to 50), catalogueCode and edition.',
                section: 'Checklist items',
              },
            ]}
          />
        </FormModal>
      ) : null}
    </Segment>
  );
}
