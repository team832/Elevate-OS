/**
 * Files on a test (owner brief 23 Oct 2026 §19–§20): question papers, answer keys and score
 * sheets. Adding or removing any of them needs ops:assessments:manage. Papers and keys are read
 * with ops:assessments:read, but someone who cannot manage sees only released versions
 * (`released_at` ≤ now, applied per file by attachments.ts `RELEASED_KINDS`).
 * Score sheets are for managers only.
 * shortcut: the test lives in Academic OS, so the owner id is not checked to exist here; the
 * Tests and Mock Tests service (TESTS-OPS) may tighten this when it reads the record.
 */
import { can } from '@elevate/authorization';
import type { Actor } from './context';

export type AssessmentFileKind = 'assessment_paper' | 'assessment_key' | 'score_import';

export const assessmentFileAccess =
  (kind: AssessmentFileKind) => async (_db: unknown, user: Actor, _ownerId: string) => ({
    canRead: can(user, kind === 'score_import' ? 'ops:assessments:manage' : 'ops:assessments:read'),
    canWrite: can(user, 'ops:assessments:manage'),
  });
