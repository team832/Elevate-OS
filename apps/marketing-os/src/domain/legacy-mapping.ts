/**
 * Legacy → Elevate OS mappings (MKT-034, PRD §2.5, MKT-004; docs/ALGORITHMS.md §10).
 * The raw legacy word is always kept next to the mapped value (legacy_status columns).
 */
import type {
  AccountScope,
  AccountStatus,
  ContentFormat,
  ContentState,
  CoursePrefix,
  IdeaScope,
  IdeaStatus,
  PlacementStatus,
  Platform,
} from './vocabulary';

/** MKT-004 idea lifecycle mapping. */
export function mapLegacyIdeaStatus(raw: string | null | undefined): IdeaStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'scripted':
    case 'edited':
      return 'in_development';
    case 'ready':
    case 'published':
    case 'scheduled':
      return 'ready';
    case 'held':
    case 'parked':
    case 'on hold':
      return 'held';
    case 'rejected':
      return 'rejected';
    default:
      return 'idea';
  }
}

export interface LegacyPlacementMapping {
  contentState: ContentState;
  placementStatus: PlacementStatus;
  hold: boolean;
}

/** PRD §2.5 legacy placement statuses → content state, placement status and hold flag. */
export function mapLegacyPlacementStatus(raw: string | null | undefined): LegacyPlacementMapping {
  const s = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (s === 'published')
    return { contentState: 'published', placementStatus: 'published', hold: false };
  if (s === 'scheduled')
    return { contentState: 'scheduled', placementStatus: 'scheduled', hold: false };
  if (s.startsWith('ready_to_post') || s === 'awaiting_approval') {
    return { contentState: 'in_review', placementStatus: 'planned', hold: false };
  }
  if (s === 'held' || s === 'parked' || s === 'on_hold') {
    return { contentState: 'draft', placementStatus: 'planned', hold: true };
  }
  if (s === 'cancelled')
    return { contentState: 'archived', placementStatus: 'cancelled', hold: false };
  // planned, todo, needs_recording, drafted, brief_ready, in_production …
  return { contentState: 'draft', placementStatus: 'planned', hold: false };
}

/** Free-text legacy formats → the content format enum (raw value kept in legacy_format). */
export function mapLegacyFormat(raw: string | null | undefined): ContentFormat {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('carousel')) return 'carousel';
  if (/(video|reel|short|recording)/.test(s)) return 'video_brief';
  if (s.includes('script')) return 'script';
  if (s.includes('caption')) return 'caption';
  if (/^(image|photo|thumbnail)/.test(s.trim())) return 'image';
  return 'post';
}

/** Idea scope from the legacy course prefix and pillar (proposed mapping; editable per idea). */
export function mapLegacyIdeaScope(
  course: CoursePrefix,
  pillar: string | null | undefined,
): { scope: IdeaScope; scopePrefixes: CoursePrefix[] } {
  if (course === 'GEN') {
    return (pillar ?? '').toLowerCase().includes('founder')
      ? { scope: 'founder', scopePrefixes: [] }
      : { scope: 'general', scopePrefixes: [] };
  }
  return { scope: 'single_exam', scopePrefixes: [course] };
}

export function mapLegacyAccountStatus(legacyStatus: string | null | undefined): AccountStatus {
  switch ((legacyStatus ?? '').toLowerCase()) {
    case 'live':
      return 'live';
    case 'starting':
      return 'starting';
    case 'retired':
      return 'retired';
    default:
      return 'later';
  }
}

export function mapAccountScope(code: string, examPage: boolean): AccountScope {
  if (code === 'IGS') return 'local';
  if (code === 'LIP') return 'company';
  if (!examPage) return 'founder';
  return 'exam';
}

/** Exams an exam page serves, from the legacy `exam_or_scope` text. */
export function mapExamPrefixes(
  examOrScope: string | null | undefined,
  examPage: boolean,
): CoursePrefix[] {
  if (!examPage) return [];
  const s = (examOrScope ?? '').toUpperCase();
  const out: CoursePrefix[] = [];
  if (s.includes('CLAT')) out.push('CLAT');
  if (s.includes('IPMAT')) out.push('IPMAT');
  if (s.includes('CUET')) out.push('CUET');
  if (s.includes('COMMERCE')) out.push('COM');
  return out;
}

export function mapPlatform(raw: string | null | undefined): Platform {
  const s = (raw ?? '').toLowerCase();
  return s === 'instagram' || s === 'youtube' || s === 'linkedin' ? s : 'other';
}

/**
 * Upper-bound cadence numbers from the legacy cadence text (proposed, OD-007):
 * - per day: "max N a day";
 * - per week: when the text is weekly ("/week" or "a week"), the sum of the upper bound of
 *   every number or range not used by the per-day clause ("1 long + 3-4 Shorts a week" → 5).
 * Text without a weekly or daily clause yields nulls (no number is invented).
 */
export function parseCadenceText(text: string | null | undefined): {
  maxPerDay: number | null;
  maxPerWeek: number | null;
} {
  if (!text) return { maxPerDay: null, maxPerWeek: null };
  const dayMatch = /max\s+(\d+)\s+(?:a|per|\/)\s*day/i.exec(text);
  const maxPerDay = dayMatch ? Number(dayMatch[1]) : null;
  let maxPerWeek: number | null = null;
  if (/(\/\s*week|a\s+week|per\s+week)/i.test(text)) {
    const withoutDay = dayMatch ? text.replace(dayMatch[0], '') : text;
    const weekly = withoutDay.split(/[;(]/)[0] ?? '';
    let sum = 0;
    let found = false;
    for (const m of weekly.matchAll(/(\d+)(?:\s*-\s*(\d+))?/g)) {
      sum += Number(m[2] ?? m[1]);
      found = true;
    }
    maxPerWeek = found && sum > 0 ? sum : null;
  }
  return { maxPerDay, maxPerWeek };
}

/** `2026-10-07 12:00` (IST) → UTC instant; date-only or "week" precision → null. */
export function legacyIstDateTime(dateIst: string | null, timeIst: string | null): Date | null {
  if (!dateIst || !timeIst) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIst) || !/^\d{2}:\d{2}$/.test(timeIst)) return null;
  const d = new Date(`${dateIst}T${timeIst}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}
