/** Words for Tests and Mock Tests screens (never raw codes on screen). */
import { StatusBadge } from '@elevate/shared-ui';
import type { TestSummary } from '../../../server/assessments';
import { fmtDate } from '../../../ui/format';

export const BASE = '/ops/tests';
export const VIEWS = [
  ['upcoming', 'Upcoming'],
  ['in_progress', 'In progress'],
  ['previous', 'Previous'],
  ['imports', 'Imports awaiting review'],
  ['awaiting_publication', 'Results awaiting publication'],
] as const;
export type View = (typeof VIEWS)[number][0];

export const KIND_LABELS = {
  chapter_test: 'Test: chapter test',
  practice: 'Test: practice',
  sectional: 'Mock test: sectional',
  full_mock: 'Mock test: full',
} as const;

const PUBLICATION = {
  not_published: ['Not published', 'neutral'],
  provisional: ['Provisional results', 'warning'],
  published: ['Published', 'success'],
  withdrawn: ['Withdrawn', 'danger'],
} as const;
export const PublicationBadge = ({ state }: { state: keyof typeof PUBLICATION }) => (
  <StatusBadge tone={PUBLICATION[state][1]}>{PUBLICATION[state][0]}</StatusBadge>
);

export const STATUS_LABELS = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  conducted: 'Held',
  finalised: 'Results finalised',
  cancelled: 'Cancelled',
} as const;

export const SOURCE_LABELS = { csv: 'CSV file', pdf_ai: 'PDF read by AI', manual: 'Manual' };

export const when = (t: Pick<TestSummary, 'scheduledDate' | 'startTime'>) =>
  t.scheduledDate
    ? `${fmtDate(t.scheduledDate)}${t.startTime ? `, ${t.startTime} IST` : ''}`
    : 'Not scheduled';

/** "12 present, 2 absent, 1 unmarked"; null counts = no roster yet (not zero). */
export const rosterText = (c: TestSummary['rosterCounts']) =>
  c
    ? `${c.present} present, ${c.absent} absent, ${c.excused} excused, ${c.unmarked} unmarked`
    : 'Roster not taken';
