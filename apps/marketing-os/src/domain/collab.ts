/**
 * Collab rule (BR-MKT-4, CH-006, CH-007, MKT-014; docs/ALGORITHMS.md §7).
 * - Pure exam content is posted solo on that exam's pages.
 * - Comparisons and "every path" content (scope cross_exam) go out as an Instagram/YouTube
 *   collab across every exam page involved.
 * - Founder stories: founder account, with a collab when relevant.
 * - IGS (Sikar) content is solo; a collab with IGS is only for Sikar events.
 */
import type { AccountScope, IdeaScope, Platform } from './vocabulary';

export interface CollabIdea {
  code: string | null;
  scope: IdeaScope;
  /** Exams involved (for cross_exam) or the exam (for single_exam). */
  scopePrefixes: readonly string[];
}

export interface CollabAccount {
  placementId?: string;
  accountCode: string;
  platform: Platform;
  scope: AccountScope;
  examPrefixes: readonly string[];
}

export interface CollabIssue {
  code:
    | 'TOO_FEW_MEMBERS'
    | 'PLATFORM_NOT_SUPPORTED'
    | 'MIXED_PLATFORMS'
    | 'DUPLICATE_ACCOUNT'
    | 'SOLO_CONTENT'
    | 'MISSING_EXAM_PAGE'
    | 'UNRELATED_EXAM_PAGE'
    | 'SIKAR_NOT_ALLOWED'
    | 'SIKAR_REQUIRED'
    | 'FOUNDER_ACCOUNT_REQUIRED'
    | 'NON_COLLAB_ACCOUNT'
    | 'SCOPE_INCOMPLETE'
    | 'WRONG_EXAM_PAGE'
    | 'COLLAB_EXPECTED';
  message: string;
  accountCode?: string;
}

export interface CollabValidation {
  valid: boolean;
  errors: CollabIssue[];
  warnings: CollabIssue[];
}

export function validateCollabGroup(
  idea: CollabIdea,
  platform: Platform,
  members: readonly CollabAccount[],
): CollabValidation {
  const errors: CollabIssue[] = [];
  const warnings: CollabIssue[] = [];

  if (platform !== 'instagram' && platform !== 'youtube') {
    errors.push({
      code: 'PLATFORM_NOT_SUPPORTED',
      message: 'Collabs exist only on Instagram and YouTube.',
    });
  }
  if (members.length < 2) {
    errors.push({ code: 'TOO_FEW_MEMBERS', message: 'A collab needs at least two accounts.' });
  }
  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m.accountCode)) {
      errors.push({
        code: 'DUPLICATE_ACCOUNT',
        message: `${m.accountCode} is listed twice.`,
        accountCode: m.accountCode,
      });
    }
    seen.add(m.accountCode);
    if (m.platform !== platform) {
      errors.push({
        code: 'MIXED_PLATFORMS',
        message: `${m.accountCode} is on ${m.platform}, not ${platform}.`,
        accountCode: m.accountCode,
      });
    }
    if (m.scope === 'company') {
      errors.push({
        code: 'NON_COLLAB_ACCOUNT',
        message: `${m.accountCode} is a company page; it cannot be part of a collab.`,
        accountCode: m.accountCode,
      });
    }
    if (m.scope === 'local' && idea.scope !== 'local_sikar') {
      errors.push({
        code: 'SIKAR_NOT_ALLOWED',
        message: `${m.accountCode} (Sikar) joins a collab only for Sikar events.`,
        accountCode: m.accountCode,
      });
    }
  }

  const examMembers = members.filter((m) => m.scope === 'exam');
  const covered = new Set(examMembers.flatMap((m) => m.examPrefixes));

  switch (idea.scope) {
    case 'single_exam':
      errors.push({
        code: 'SOLO_CONTENT',
        message:
          'Pure exam content is posted solo on its own exam page, not as a collab (CH-006, CH-007).',
      });
      break;
    case 'cross_exam': {
      if (idea.scopePrefixes.length < 2) {
        warnings.push({
          code: 'SCOPE_INCOMPLETE',
          message: 'A cross-exam idea should name at least two exams so coverage can be checked.',
        });
      }
      const missing = idea.scopePrefixes.filter((p) => !covered.has(p));
      if (missing.length > 0) {
        errors.push({
          code: 'MISSING_EXAM_PAGE',
          message: `Every exam involved needs its page in the collab; missing: ${missing.join(', ')}.`,
        });
      }
      for (const m of examMembers) {
        if (!m.examPrefixes.some((p) => idea.scopePrefixes.includes(p))) {
          errors.push({
            code: 'UNRELATED_EXAM_PAGE',
            message: `${m.accountCode} serves ${m.examPrefixes.join('/') || 'no exam'}, which this idea does not involve (exam pages stay pure).`,
            accountCode: m.accountCode,
          });
        }
      }
      break;
    }
    case 'founder':
      if (!members.some((m) => m.scope === 'founder')) {
        errors.push({
          code: 'FOUNDER_ACCOUNT_REQUIRED',
          message: "A founder-story collab must include the founder's own account.",
        });
      }
      if (examMembers.length > 0) {
        warnings.push({
          code: 'SCOPE_INCOMPLETE',
          message:
            'Founder stories join exam pages only "when relevant" — the approver should confirm relevance.',
        });
      }
      break;
    case 'local_sikar':
      if (!members.some((m) => m.scope === 'local')) {
        errors.push({
          code: 'SIKAR_REQUIRED',
          message: 'A Sikar-event collab must include the Sikar account.',
        });
      }
      break;
    case 'general':
      warnings.push({
        code: 'SCOPE_INCOMPLETE',
        message:
          'General ideas cannot be checked for exam coverage; set the scope to cross_exam with the exams involved.',
      });
      break;
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** MKT-014: is one placement (outside or inside a collab) consistent with the idea's scope? */
export function checkPlacementScope(
  idea: CollabIdea,
  account: CollabAccount,
  inCollab: boolean,
): CollabValidation {
  const errors: CollabIssue[] = [];
  const warnings: CollabIssue[] = [];
  if (idea.scope === 'single_exam' && account.scope === 'exam') {
    if (!account.examPrefixes.some((p) => idea.scopePrefixes.includes(p))) {
      errors.push({
        code: 'WRONG_EXAM_PAGE',
        message: `${idea.code ?? 'This idea'} is ${idea.scopePrefixes.join('/')} content; ${account.accountCode} serves ${account.examPrefixes.join('/')}. Exam pages stay pure.`,
        accountCode: account.accountCode,
      });
    }
  }
  if (idea.scope === 'local_sikar' && account.scope !== 'local') {
    errors.push({
      code: 'SIKAR_NOT_ALLOWED',
      message: 'Sikar / offline-centre content goes only on the Sikar account (BR-MKT-3 #4).',
      accountCode: account.accountCode,
    });
  }
  if (account.scope === 'local' && idea.scope !== 'local_sikar') {
    warnings.push({
      code: 'SIKAR_NOT_ALLOWED',
      message: 'The Sikar account is for local content; confirm this idea belongs there.',
      accountCode: account.accountCode,
    });
  }
  if (idea.scope === 'cross_exam' && account.scope === 'exam' && !inCollab) {
    warnings.push({
      code: 'COLLAB_EXPECTED',
      message:
        'Comparisons and "every path" content go out as a collab across every exam page involved.',
      accountCode: account.accountCode,
    });
  }
  return { valid: errors.length === 0, errors, warnings };
}
