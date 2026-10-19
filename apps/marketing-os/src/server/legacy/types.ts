/**
 * Shapes of the legacy extracts in data/legacy/marketing/*.json (only the fields the
 * importer reads). The importer takes parsed JSON so it is testable without the files.
 */
export interface LegacySource {
  path: string;
  locator: string;
}

export interface LegacyAccountsFile {
  records: {
    code: string;
    platform: string;
    exam_or_scope: string | null;
    display_name: string | null;
    proposed_display_name?: string | null;
    handle: string | null;
    handle_status: string;
    proposed_handle?: string | null;
    audience: string | null;
    job: string | null;
    cadence: string | null;
    content_rules: string[];
    status: string;
    legacy_status: string;
    metricool_brand: string | null;
    exam_page: boolean;
    notes?: string[];
    source: LegacySource[];
  }[];
  conflicts: {
    id: string;
    description: string;
    status: string;
    accounts_in_other_model: string[];
    source: LegacySource[];
  }[];
}

export interface LegacyRulesFile {
  records: {
    id: string;
    kind: string;
    description: string;
    matcher: unknown;
    manual_check: boolean;
    action_on_match: string | null;
    applies_to: string[];
    status: string;
    source_text: string | null;
    notes: string | null;
    source: LegacySource[];
  }[];
}

export interface LegacyIdeasFile {
  records: {
    legacy_id: string;
    title: string;
    course: string;
    pillar: string | null;
    origin: string | null;
    master_asset: string | null;
    legacy_status: string;
    notes: string | null;
    duplicate_of_legacy_id_group: string | null;
    duplicate_occurrence: number | null;
    proposed_code: string | null;
    proposed_code_status: string | null;
    library_folders: string[];
    source: LegacySource;
  }[];
  duplicate_groups: {
    legacy_id: string;
    occurrences: { line: number; title: string; proposed_code: string | null }[];
    resolution_hint: string;
    status: string;
  }[];
}

export interface LegacyPlacementsFile {
  records: {
    version_id: string;
    idea_legacy_id: string;
    account_code: string;
    variant: 'short' | 'long' | null;
    format: string | null;
    legacy_status: string;
    status: string;
    date_ist_raw: string | null;
    date_ist: string | null;
    time_ist: string | null;
    date_precision: string | null;
    link_or_file: string | null;
    result_24h_raw: string | null;
    notes: string | null;
    ambiguous: boolean;
    ambiguity_reason: string | null;
    source: LegacySource;
  }[];
}

export interface LegacyPostAuditFile {
  summary: { audited_on: string; account_code: string };
  records: {
    n: number;
    posted: string | null;
    type: string | null;
    link: string | null;
    topic: string | null;
    ownership: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    likely_boosted: boolean;
    verdict_actions: string[];
    reason: string | null;
    source: LegacySource;
  }[];
}

export interface LegacyMarketingData {
  accounts: LegacyAccountsFile;
  rules: LegacyRulesFile;
  ideas: LegacyIdeasFile;
  placements: LegacyPlacementsFile;
  postAudit: LegacyPostAuditFile;
}

export function sourceRef(source: LegacySource): string {
  const line = /line (\d+)/.exec(source.locator);
  return line ? `${source.path}#L${line[1]}` : `${source.path}#${source.locator}`;
}
