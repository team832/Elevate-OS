import type { AuthenticatedUser } from '@elevate/authentication';
import type { Tone } from '@elevate/shared-ui';

export const BASE = '/ops/hr/feedback';
export const API = '/ops/api/v1/feedback';
export type Params = Record<string, string | undefined>;
export interface TabProps {
  user: AuthenticatedUser;
  params: Params;
}

export const MODERATION: Record<string, [label: string, tone: Tone]> = {
  pending: ['Awaiting moderation', 'warning'],
  approved: ['Approved', 'success'],
  rejected: ['Rejected', 'neutral'],
  hidden: ['Hidden', 'neutral'],
};
export const METHOD: Record<string, string> = {
  form: 'Form',
  paper: 'Paper',
  interview: 'Interview',
  import: 'Imported file',
  other: 'Other',
};
export const asOptions = (m: Record<string, string | readonly [string, ...unknown[]]>) =>
  Object.entries(m).map(([value, l]) => ({ value, label: typeof l === 'string' ? l : l[0] }));
