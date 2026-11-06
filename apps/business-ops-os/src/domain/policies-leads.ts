/**
 * Policy register: the website enquiry form (F4-15) and automatic lead sharing (F4-16). Owner,
 * 6 Nov 2026: both built and off until switched on; every value here is our proposal.
 */
import { z } from 'zod';
import type { DefinitionsFor } from './policies-base';

/** Website addresses separated by spaces or commas ("" = none). */
export const originList = (text: string) => text.split(/[\s,]+/).filter(Boolean);
const isOrigin = (v: string) =>
  URL.canParse(v) && /^https?:$/.test(new URL(v).protocol) && new URL(v).origin === v;

export const leadSettingSchemas = {
  'leads.website_form.enabled': z.object({ enabled: z.boolean() }).strict(),
  'leads.website_form.allowed_origins': z
    .object({
      origins: z
        .string()
        .trim()
        .max(1000)
        .refine(
          (v) => originList(v).every(isOrigin),
          'Give each website as its address only, such as https://www.example.in, with no page after it.',
        ),
    })
    .strict(),
  'leads.website_form.consent': z
    .object({
      version: z.string().trim().min(1).max(40),
      text: z.string().trim().min(20).max(1000),
    })
    .strict(),
  'leads.sharing.enabled': z.object({ enabled: z.boolean() }).strict(),
} as const;

const OWNER =
  'Owner, 6 Nov 2026 (F4-15, F4-16): build it, off until switched on; the values are our proposal.';

export const LEAD_SETTING_DEFINITIONS: DefinitionsFor<typeof leadSettingSchemas> = {
  'leads.website_form.enabled': {
    label: 'Website enquiry form',
    description:
      'When on, the public page /ops/enquire takes enquiries from families and each one becomes a lead (or a new enquiry on the lead with the same phone number). It opens only once the owner has approved the consent wording. When off or not approved, the page says enquiries are not open and nothing is saved.',
    defaultValue: { enabled: false },
    defaultState: 'proposed',
    source: OWNER,
    ownerDecision: 'F4-15: owner to switch it on.',
    editable: true,
  },
  'leads.website_form.allowed_origins': {
    label: 'Websites allowed to send enquiries',
    description:
      'Other websites (for example the institute website) whose own enquiry form may post to Elevate OS; separate several with spaces. Empty: only the page /ops/enquire may send enquiries; a link to it always works.',
    defaultValue: { origins: '' },
    defaultState: 'proposed',
    source: OWNER,
    ownerDecision: 'F4-15: owner to name the website address.',
    editable: true,
  },
  'leads.website_form.consent': {
    label: 'Website form consent text',
    description:
      'The words a family ticks before sending the form (Digital Personal Data Protection Act 2023 notice). Each enquiry stores the version it was sent under, so change the version whenever you change the words. Whether a student under 18 may send it alone is the owner’s decision; the text does not decide it.',
    defaultValue: {
      version: 'website-v1',
      text: 'I agree that Elevate Education may use the details on this form to contact me by phone or email about this enquiry and its courses. I can ask for my details to be corrected or deleted at any time by writing to team@elevateeducation.in.',
    },
    defaultState: 'proposed',
    source: `${OWNER} Draft wording, needs legal review.`,
    ownerDecision: 'F4-15: owner to approve the wording and the rule for minors.',
    editable: true,
  },
  'leads.sharing.enabled': {
    label: 'Automatic lead sharing',
    description:
      'When on, a new lead that nobody owns (website form, imports, leads saved without an owner) goes to the next counsellor of its programme’s rule in Leads → Lead sharing, or of the default rule, skipping anyone not active or on approved leave today. When off, such leads stay unassigned.',
    defaultValue: { enabled: false },
    defaultState: 'proposed',
    source: OWNER,
    ownerDecision: 'F4-16: owner to switch it on.',
    editable: true,
  },
};
