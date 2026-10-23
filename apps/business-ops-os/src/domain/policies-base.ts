/** Building blocks shared by the policy register files (domain/policies*.ts). */
import { z } from 'zod';

export const DECISION_STATES = [
  'proposed',
  'approved',
  'locked',
  'open',
  'pending_verification',
  'superseded',
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const DECISION_STATE_LABELS: Record<DecisionState, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  locked: 'Locked',
  open: 'Open — owner decision needed',
  pending_verification: 'Pending verification',
  superseded: 'Superseded',
};

export const codeList = z
  .array(
    z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
        label: z.string().min(1).max(120),
      })
      .strict(),
  )
  .max(40);

export interface PolicyDefinition<V> {
  label: string;
  description: string;
  defaultValue: V;
  defaultState: DecisionState;
  source: string;
  ownerDecision: string | null;
  /** Can operations managers change the value here? (Changed values become `proposed`.) */
  editable: boolean;
}

/** One definition per schema key, its default typed as that setting's value. */
export type DefinitionsFor<S extends Record<string, z.ZodType>> = {
  [K in keyof S]: PolicyDefinition<z.output<S[K]>>;
};
