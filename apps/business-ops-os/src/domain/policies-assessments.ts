/** Policy register: Tests and Mock Tests files (owner brief 23 Oct 2026 §19). */
import { z } from 'zod';
import type { DefinitionsFor } from './policies-base';

export const PAPER_RELEASE_FROM = ['test_day', 'any_time'] as const;

export const assessmentSettingSchemas = {
  'assessments.paper_release': z.object({ releaseFrom: z.enum(PAPER_RELEASE_FROM) }).strict(),
} as const;

export const ASSESSMENT_SETTING_DEFINITIONS: DefinitionsFor<typeof assessmentSettingSchemas> = {
  'assessments.paper_release': {
    label: 'Releasing question papers and answer keys',
    description:
      'Until a manager releases them, a test’s question paper and answer key open only for people who manage tests. Test day: they can be released from the test date (IST). Any time: also before it.',
    defaultValue: { releaseFrom: 'test_day' },
    defaultState: 'proposed',
    source:
      'owner brief 2026-10-23 §19 (“restrict upcoming question papers and unreleased answer keys”).',
    ownerDecision: 'Owner to confirm when papers and keys may be released, and who may see them.',
    editable: true,
  },
};
