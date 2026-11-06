/** Policy register: the student and parent portal (F4-13). Both Proposed; the portal starts off. */
import { z } from 'zod';
import type { DefinitionsFor } from './policies-base';

export const portalSettingSchemas = {
  'portal.enabled': z.object({ enabled: z.boolean() }).strict(),
  'portal.guardian_access_to_adults': z.object({ allowed: z.boolean() }).strict(),
  'portal.consent_text': z
    .object({
      version: z.string().trim().min(1).max(40),
      text: z.string().trim().min(20).max(2000),
    })
    .strict(),
} as const;

export const PORTAL_SETTING_DEFINITIONS: DefinitionsFor<typeof portalSettingSchemas> = {
  'portal.enabled': {
    label: 'Student and parent portal open',
    description:
      'Off: the portal pages say the portal is not open yet, and nobody can sign in or set a password there. Staff can still give access and print setup slips.',
    defaultValue: { enabled: false },
    defaultState: 'proposed',
    source: 'Owner answers 6 Nov 2026 (F4-13: build the portal, off by default).',
    ownerDecision: 'Owner to decide when the portal opens to students and parents.',
    editable: true,
  },
  'portal.guardian_access_to_adults': {
    label: 'Guardian logins for students aged 18 or over',
    description:
      'Off: a parent or guardian cannot get a portal login for a student aged 18 or over, and a guardian login stops showing a child once the child turns 18. On: they can, with no consent recorded from the student. Checked again at every sign-in and page.',
    defaultValue: { allowed: false },
    defaultState: 'proposed',
    source:
      'REV-W4 round 1, 6 Nov 2026 (an adult’s data shown to a parent without the adult’s consent).',
    ownerDecision:
      'Owner to decide whether parents may see the portal of a student aged 18 or over.',
    editable: true,
  },
  'portal.consent_text': {
    label: 'Guardian consent for a student under 18 (portal)',
    description:
      'The words a parent or guardian agrees to before a student under 18 (or with no date of birth recorded) gets portal access. Staff record who agreed, when, and this version. Consent can be recorded only once the owner has approved the wording. Needs lawyer review (DPDP Act 2023).',
    defaultValue: {
      version: '2026-11-06-proposed',
      text: 'I am the parent or guardian of this student. I agree that Elevate Education may give a login to the Elevate portal for this student, so that the login holder can see the student’s attendance, test results, homework, fees and timetable. I can ask Elevate Education at any time to switch this login off.',
    },
    defaultState: 'proposed',
    source:
      'FX-PORTAL draft, 6 Nov 2026 (DPDP Act 2023: verifiable consent of a parent for a child).',
    ownerDecision: 'Owner (and a lawyer) to approve or change the consent wording.',
    editable: true,
  },
};
