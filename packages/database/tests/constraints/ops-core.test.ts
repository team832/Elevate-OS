import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OPS_ACTIVITY_KINDS,
  OPS_ACTIVITY_OUTCOMES,
  OPS_ADMISSION_CHECK_ITEMS,
  OPS_CONSENT_STATUSES,
  OPS_CONTACT_CHANNELS,
  OPS_DECISION_STATES,
  OPS_EMPLOYMENT_STATUSES,
  OPS_FOLLOW_UP_KINDS,
  OPS_GUARDIAN_RELATIONSHIPS,
  OPS_HANDOFF_ATTEMPT_KINDS,
  OPS_HANDOFF_ATTEMPT_OUTCOMES,
  OPS_HANDOFF_STATUSES,
  OPS_INTEREST_MODES,
  OPS_STUDENT_STAGES,
} from '../../src/schema/index';
import {
  FUTURE,
  NOW,
  insert,
  insertSql,
  one,
  rolledBack,
  runCases,
  setup,
  variants,
  vocab,
  type Row,
} from './helpers';

const SELF = '00000000-0000-4000-8000-0000000000aa';
const SUBJECT = '00000000-0000-4000-8000-0000000000bb';
let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];
const pg = () => ctx.pg;

const lead = (o: Row = {}): Row => ({
  code: 'LEAD-000099',
  student_name: 'Sample Lead',
  guardian_email: 'sample.guardian@example.test',
  first_received_at: NOW,
  created_by: ctx.ids.user,
  ...o,
});
/** Closed by default, so it never collides with the base lead's open admission. */
const admission = (o: Row = {}): Row => ({
  code: 'ADM-000099',
  lead_id: ctx.ids.lead,
  status: 'lost',
  created_by: ctx.ids.user,
  ...o,
});
const followUp = (o: Row = {}): Row => ({
  lead_id: ctx.ids.lead,
  kind: 'general',
  title: 'Sample call back',
  due_date: '2026-10-22',
  owner_staff_id: ctx.ids.staff,
  ...o,
});
const event = (o: Row = {}): Row => ({
  type: 'ops.sample.created',
  version: 1,
  producer: 'ops',
  idempotency_key: 'sample-1',
  payload: '{}',
  ...o,
});
const enrolmentAttempt = (o: Row = {}): Row => ({
  admission_id: ctx.ids.admission,
  attempt: 2,
  request_event_id: ids.event2,
  kind: 'after_rejection',
  reason: 'Sample reason',
  requested_by: ctx.ids.user,
  ...o,
});
const preference = (o: Row = {}): Row => ({
  lead_id: ids.lead2,
  consent_status: 'given',
  consent_by: 'guardian',
  allowed_channels: '{call,email}',
  recorded_by: ctx.ids.user,
  ...o,
});
const approval = (o: Row = {}): Row => ({
  subject_module: 'ops',
  subject_type: 'admission',
  subject_id: SUBJECT,
  policy: 'ops.sample.policy',
  requested_by: ctx.ids.user,
  ...o,
});
const coded = (code: string) => (o: Row) => ({ code, name: 'Sample unit', ...o });

beforeAll(async () => {
  ctx = await setup();
  const { pg, ids: base } = ctx;
  ids.lead2 = await insert(pg, 'ops.leads', lead({ code: 'LEAD-000002' }));
  ids.admission2 = await insert(pg, 'ops.admissions', admission({ code: 'ADM-000002' }));
  ids.event1 = await insert(pg, 'core.integration_events', event());
  ids.event2 = await insert(pg, 'core.integration_events', event({ idempotency_key: 'sample-2' }));
  await insert(pg, 'ops.settings', { key: 'sample.setting', value: '1' });
  await insert(pg, 'ops.lead_sources', { code: 'SAMPLE_WALK_IN', label: 'Sample walk-in' });
  await insert(pg, 'ops.duplicate_flags', {
    lead_id: base.lead,
    matched_lead_id: ids.lead2,
    level: 'exact',
    signals: '{guardian_email}',
  });
  await insert(pg, 'ops.admission_checks', {
    admission_id: base.admission,
    item_key: 'admission_form',
    status: 'done',
    recorded_by: base.user,
  });
  await insert(
    pg,
    'ops.enrolment_attempts',
    enrolmentAttempt({ attempt: 1, request_event_id: ids.event1, kind: 'initial' }),
  );
  await insert(pg, 'ops.contact_preferences', preference({ lead_id: base.lead }));
  ids.staff2 = await insert(pg, 'core.staff_members', {
    full_name: 'Sample Coordinator',
    user_id: base.user2,
  });
  await insert(pg, 'ops.staff_profiles', { staff_id: ids.staff2, staff_code: 'SAMPLE-01' });
  await insert(pg, 'core.departments', coded('SAMPLE_DESK')({}));
  await insert(pg, 'core.programmes', coded('SAMPLE_CLAT')({}));
  await insert(pg, 'core.branches', coded('SAMPLE_BR')({}));
  await insert(pg, 'core.approvals', approval());
  await insert(pg, 'core.event_deliveries', {
    event_id: ids.event1,
    consumer: 'academic.sample-consumer',
    status: 'processed',
  });
  await insert(pg, 'core.idempotency_keys', {
    scope: 'POST /ops/api/v1/leads',
    key: 'k-1',
    request_hash: 'h',
    expires_at: FUTURE,
  });
});
afterAll(() => ctx.t.close());

describe('ops settings, lead sources, leads and enquiries', () => {
  runCases(pg, [
    vocab(
      'setting decision states (OPS_DECISION_STATES)',
      'ops.settings',
      OPS_DECISION_STATES,
      'settings_decision_state_check',
      (v) => ({ key: 'sample.other', value: '1', decision_state: v }),
    ),
    one(
      'a setting key is stored once',
      'ops.settings',
      () => ({ key: 'sample.setting', value: '2' }),
      'settings_key_key',
    ),
    variants(
      'lead source rules',
      'ops.lead_sources',
      (o) => ({ code: 'SAMPLE_REFERRAL', label: 'Sample referral', ...o }),
      {
        retired: [{ status: 'retired' }, 'ok'],
        'lower-case code': [{ code: 'sample_referral' }, 'lead_sources_code_format'],
        'code taken': [{ code: 'SAMPLE_WALK_IN' }, 'lead_sources_code_key'],
        'status bogus': [{ status: 'bogus' }, 'lead_sources_status_check'],
      },
    ),
    vocab(
      'lead interest modes (OPS_INTEREST_MODES)',
      'ops.leads',
      OPS_INTEREST_MODES,
      'leads_interest_mode_check',
      (v) => lead({ interest_mode: v }),
    ),
    vocab(
      'lead school stages (OPS_STUDENT_STAGES)',
      'ops.leads',
      OPS_STUDENT_STAGES,
      'leads_stage_check',
      (v) => lead({ current_stage: v }),
    ),
    vocab(
      'lead guardian relationships (OPS_GUARDIAN_RELATIONSHIPS)',
      'ops.leads',
      OPS_GUARDIAN_RELATIONSHIPS,
      'leads_relationship_check',
      (v) => lead({ guardian_relationship: v }),
    ),
    variants('lead rules', 'ops.leads', lead, {
      'no contact at all': [{ guardian_email: null }, 'leads_has_contact'],
      'student phone not E.164': [{ student_phone: 'not-a-phone' }, 'leads_phone_e164'],
      'emergency phone not E.164': [
        { emergency_contact_phone: 'not-a-phone' },
        'leads_emergency_phone_e164',
      ],
      'email with capitals': [{ guardian_email: 'Sample@example.test' }, 'leads_email_lowercase'],
      '6 interests': [{ interested_programme_codes: '{A,B,C,D,E,F}' }, 'ok'],
      '7 interests': [{ interested_programme_codes: '{A,B,C,D,E,F,G}' }, 'leads_interests_check'],
      'code LEAD-1': [{ code: 'LEAD-1' }, 'leads_code_format'],
      'code taken': [{ code: 'LEAD-000001' }, 'leads_code_key'],
      'merged into itself': [{ id: SELF, merged_into_lead_id: SELF }, 'leads_not_merged_into_self'],
      'merged into an unknown lead': [
        { merged_into_lead_id: SUBJECT },
        'leads_merged_into_lead_id_leads_id_fk',
      ],
      'no first received time': [{ first_received_at: null }, '23502'],
    }),
    variants(
      'enquiry rules',
      'ops.enquiries',
      (o) => ({
        lead_id: ctx.ids.lead,
        received_at: NOW,
        source_code: 'SAMPLE_WALK_IN',
        created_by: ctx.ids.user,
        ...o,
      }),
      {
        'known source': [{}, 'ok'],
        'unknown source code': [
          { source_code: 'NOT_A_SOURCE' },
          'enquiries_source_code_lead_sources_code_fk',
        ],
        'interest mode bogus': [{ interest_mode: 'bogus' }, 'enquiries_interest_mode_check'],
      },
    ),
  ]);
});

describe('contact activity, duplicates, follow-ups and contact preferences', () => {
  const activity = (o: Row) => ({
    lead_id: ctx.ids.lead,
    kind: 'call',
    outcome: 'no_answer',
    occurred_at: NOW,
    created_by: ctx.ids.user,
    ...o,
  });
  runCases(pg, [
    vocab(
      'activity kinds (OPS_ACTIVITY_KINDS)',
      'ops.lead_activities',
      OPS_ACTIVITY_KINDS,
      'lead_activities_kind_check',
      (v) => activity({ kind: v }),
    ),
    vocab(
      'activity outcomes (OPS_ACTIVITY_OUTCOMES)',
      'ops.lead_activities',
      OPS_ACTIVITY_OUTCOMES,
      'lead_activities_outcome_check',
      (v) => activity({ outcome: v }),
    ),
    variants(
      'duplicate flag rules',
      'ops.duplicate_flags',
      (o) => ({
        lead_id: ids.lead2,
        matched_lead_id: ctx.ids.lead,
        level: 'possible',
        signals: '{student_name}',
        ...o,
      }),
      {
        'reverse pair': [{}, 'ok'],
        'same pair twice': [
          { lead_id: () => ctx.ids.lead, matched_lead_id: id('lead2') },
          'duplicate_flags_pair_key',
        ],
        'lead matched with itself': [{ matched_lead_id: id('lead2') }, 'duplicate_flags_not_self'],
        'level bogus': [{ level: 'bogus' }, 'duplicate_flags_level_check'],
        'status bogus': [{ status: 'bogus' }, 'duplicate_flags_status_check'],
      },
    ),
    vocab(
      'follow-up kinds (OPS_FOLLOW_UP_KINDS)',
      'ops.follow_ups',
      OPS_FOLLOW_UP_KINDS,
      'follow_ups_kind_check',
      (v) => followUp({ kind: v }),
    ),
    vocab(
      'follow-up sources',
      'ops.follow_ups',
      ['manual', 'rule'],
      'follow_ups_source_check',
      (v) => followUp({ source: v }),
    ),
    variants('follow-up rules (BR-OPS-9)', 'ops.follow_ups', followUp, {
      'done without a completion time': [
        { status: 'done', outcome: 'Sample outcome' },
        'follow_ups_done_has_time',
      ],
      'done without an outcome': [
        { status: 'done', completed_at: NOW },
        'follow_ups_done_has_outcome',
      ],
      'done with a completion time and outcome': [
        { status: 'done', completed_at: NOW, outcome: 'Sample outcome' },
        'ok',
      ],
      'status bogus': [{ status: 'bogus' }, 'follow_ups_status_check'],
      'no owner': [{ owner_staff_id: null }, '23502'],
      'no due date': [{ due_date: null }, '23502'],
    }),
    vocab(
      'consent statuses (OPS_CONSENT_STATUSES)',
      'ops.contact_preferences',
      OPS_CONSENT_STATUSES,
      'contact_preferences_status_check',
      (v) => preference({ consent_status: v, allowed_channels: v === 'given' ? '{call}' : '{}' }),
    ),
    vocab(
      'allowed contact channels (OPS_CONTACT_CHANNELS)',
      'ops.contact_preferences',
      OPS_CONTACT_CHANNELS,
      'contact_preferences_channels_check',
      (v) => preference({ allowed_channels: `{${v}}` }),
    ),
    variants('contact preference rules', 'ops.contact_preferences', preference, {
      'refused but channels allowed': [
        { consent_status: 'refused' },
        'contact_preferences_refused_no_channels',
      ],
      'consent by bogus': [{ consent_by: 'bogus' }, 'contact_preferences_by_check'],
      'preferred contact bogus': [
        { preferred_contact: 'bogus' },
        'contact_preferences_preferred_check',
      ],
      'second row for one lead': [{ lead_id: () => ctx.ids.lead }, 'contact_preferences_pkey'],
    }),
  ]);
});

describe('admissions, checklist, enrolment attempts and staff profiles', () => {
  const check = (o: Row) => ({
    admission_id: ids.admission2,
    item_key: 'kit_issued',
    status: 'done',
    recorded_by: ctx.ids.user,
    ...o,
  });
  runCases(pg, [
    vocab(
      'enrolment handoff statuses (OPS_HANDOFF_STATUSES)',
      'ops.admissions',
      OPS_HANDOFF_STATUSES,
      'admissions_handoff_check',
      (v) => admission({ handoff_status: v }),
    ),
    vocab(
      'admission delivery modes',
      'ops.admissions',
      ['offline', 'online', 'hybrid'],
      'admissions_delivery_mode_check',
      (v) => admission({ delivery_mode: v }),
    ),
    variants('admission rules', 'ops.admissions', admission, {
      'code ADM-1': [{ code: 'ADM-1' }, 'admissions_code_format'],
      'code taken': [{ code: 'ADM-000001' }, 'admissions_code_key'],
      'enrolment attempt -1': [{ enrolment_attempt: -1 }, 'admissions_attempt_check'],
      'reason code chose_competitor': [{ status_reason_code: 'chose_competitor' }, 'ok'],
      'reason code with capitals': [
        { status_reason_code: 'Chose_Competitor' },
        'admissions_reason_code_format',
      ],
      'legacy required': [{ legacy_verification: 'required' }, 'ok'],
      'legacy bogus': [{ legacy_verification: 'bogus' }, 'admissions_legacy_check'],
      'on hold from bogus': [
        { status: 'on_hold', held_from_status: 'bogus' },
        'admissions_held_from_status_check',
      ],
      'unknown lead': [{ lead_id: SUBJECT }, 'admissions_lead_id_leads_id_fk'],
    }),
    vocab(
      'admission checklist items (OPS_ADMISSION_CHECK_ITEMS)',
      'ops.admission_checks',
      OPS_ADMISSION_CHECK_ITEMS,
      'admission_checks_item_check',
      (v) => check({ item_key: v }),
    ),
    variants('admission checklist rules', 'ops.admission_checks', check, {
      'status bogus': [{ status: 'bogus' }, 'admission_checks_status_check'],
      'same item twice': [
        { admission_id: () => ctx.ids.admission, item_key: 'admission_form' },
        'admission_checks_pkey',
      ],
    }),
    vocab(
      'enrolment attempt kinds (OPS_HANDOFF_ATTEMPT_KINDS)',
      'ops.enrolment_attempts',
      OPS_HANDOFF_ATTEMPT_KINDS,
      'enrolment_attempts_kind_check',
      (v) => enrolmentAttempt({ kind: v }),
    ),
    vocab(
      'enrolment attempt outcomes (OPS_HANDOFF_ATTEMPT_OUTCOMES)',
      'ops.enrolment_attempts',
      OPS_HANDOFF_ATTEMPT_OUTCOMES,
      'enrolment_attempts_outcome_check',
      (v) => enrolmentAttempt({ outcome: v }),
    ),
    variants('enrolment attempt rules (OPS-075)', 'ops.enrolment_attempts', enrolmentAttempt, {
      'attempt 0': [{ attempt: 0 }, 'enrolment_attempts_attempt_check'],
      'after a failure without a reason': [
        { kind: 'after_failure', reason: null },
        'enrolment_attempts_failure_reason',
      ],
      'attempt number taken': [{ attempt: 1 }, 'enrolment_attempts_admission_attempt_key'],
      'request event reused': [
        { request_event_id: id('event1') },
        'enrolment_attempts_request_event_key',
      ],
    }),
    variants(
      'staff profile rules',
      'ops.staff_profiles',
      (o) => ({ staff_id: ctx.ids.staff, ...o }),
      {
        'no staff code': [{}, 'ok'],
        'staff code taken': [{ staff_code: 'SAMPLE-01' }, 'staff_profiles_staff_code_key'],
        'second profile': [{ staff_id: id('staff2') }, 'staff_profiles_pkey'],
        'employment bogus': [{ employment_type: 'bogus' }, 'staff_profiles_employment_check'],
        'verification bogus': [
          { verification_status: 'bogus' },
          'staff_profiles_verification_check',
        ],
        'unknown staff member': [
          { staff_id: SUBJECT },
          'staff_profiles_staff_id_staff_members_id_fk',
        ],
        'employment status bogus': [
          { employment_status: 'bogus' },
          'staff_profiles_employment_status_check',
        ],
        'exited without a last day': [{ employment_status: 'exited' }, 'staff_profiles_left_check'],
        'exited with a last day': [
          { employment_status: 'exited', joined_on: '2025-06-01', left_on: '2026-10-01' },
          'ok',
        ],
        'left before joining': [
          { employment_status: 'exited', joined_on: '2026-06-01', left_on: '2026-05-01' },
          'staff_profiles_left_check',
        ],
        'active with a last day': [
          { employment_status: 'active', left_on: '2026-10-01' },
          'staff_profiles_left_check',
        ],
        'on notice with a last day': [
          { employment_status: 'on_notice', left_on: '2026-11-30' },
          'ok',
        ],
        'blank time zone': [{ timezone: '' }, 'staff_profiles_timezone_check'],
        'unknown branch': [{ branch_id: SUBJECT }, 'staff_profiles_branch_id_branches_id_fk'],
      },
    ),
    vocab(
      'employment statuses (OPS_EMPLOYMENT_STATUSES)',
      'ops.staff_profiles',
      OPS_EMPLOYMENT_STATUSES,
      'staff_profiles_employment_status_check',
      (v) => ({
        staff_id: ctx.ids.staff,
        employment_status: v,
        ...(v === 'exited' ? { left_on: '2026-10-01' } : {}),
      }),
    ),
  ]);
});

describe('core organisation, approvals, audit, notifications and outbox', () => {
  runCases(pg, [
    ...(
      [
        ['core.departments', 'SAMPLE_DESK', 'departments'],
        ['core.programmes', 'SAMPLE_CLAT', 'programmes'],
        ['core.branches', 'SAMPLE_BR', 'branches'],
      ] as const
    ).map(([table, taken, name]) =>
      variants(`${name}: code format, unique code, status`, table, coded('SAMPLE_NEW'), {
        'code SAMPLE_NEW': [{}, 'ok'],
        'lower-case code': [{ code: 'sample' }, `${name}_code_format`],
        'one-letter code': [{ code: 'S' }, `${name}_code_format`],
        'code taken': [{ code: taken }, `${name}_code_key`],
        'status bogus': [{ status: 'bogus' }, `${name}_status_check`],
      }),
    ),
    variants(
      'staff member rules',
      'core.staff_members',
      (o) => ({ full_name: 'Sample Staff', ...o }),
      {
        'no login (several allowed)': [{}, 'ok'],
        'login already linked': [{ user_id: () => ctx.ids.user2 }, 'staff_members_user_id_key'],
        'own manager': [{ id: SELF, manager_id: SELF }, 'staff_members_not_own_manager'],
        'status bogus': [{ status: 'bogus' }, 'staff_members_status_check'],
        'unknown department': [
          { department_id: SUBJECT },
          'staff_members_department_id_departments_id_fk',
        ],
      },
    ),
    variants('approval rules', 'core.approvals', approval, {
      'second pending request': [{}, 'approvals_one_pending_per_subject'],
      'pending for another policy': [{ policy: 'ops.other.policy' }, 'ok'],
      'approved beside the pending one': [
        { status: 'approved', decided_at: NOW, decided_by: () => ctx.ids.user2 },
        'ok',
      ],
      'approved without a decider': [
        { status: 'approved', decided_at: NOW },
        'approvals_decision_consistency',
      ],
      'pending with a decision time': [
        { policy: 'ops.other.policy', decided_at: NOW },
        'approvals_decision_consistency',
      ],
      'withdrawn without a time': [{ status: 'withdrawn' }, 'approvals_decision_consistency'],
      'withdrawn with a time only': [{ status: 'withdrawn', decided_at: NOW }, 'ok'],
      'module bogus': [
        { subject_module: 'bogus', policy: 'ops.other.policy' },
        'approvals_subject_module_check',
      ],
    }),
    variants(
      'audit event rules',
      'core.audit_events',
      (o) => ({
        actor_type: 'system',
        module: 'ops',
        action: 'lead.created',
        entity_type: 'lead',
        ...o,
      }),
      {
        'system actor without a user': [{}, 'ok'],
        'user actor without a user id': [{ actor_type: 'user' }, 'audit_events_user_actor_has_id'],
        'user actor with a user id': [
          { actor_type: 'user', actor_user_id: () => ctx.ids.user },
          'ok',
        ],
        'actor type bogus': [{ actor_type: 'bogus' }, 'audit_events_actor_type_check'],
        'module bogus': [{ module: 'bogus' }, 'audit_events_module_check'],
        'no action': [{ action: null }, '23502'],
      },
    ),
    variants(
      'notification rules',
      'core.notifications',
      (o) => ({
        user_id: ctx.ids.user,
        module: 'ops',
        kind: 'sample',
        title: 'Sample notice',
        ...o,
      }),
      {
        'relative link': [{ link: '/ops/admissions' }, 'ok'],
        'absolute link': [{ link: 'https://example.test/x' }, 'notifications_link_relative'],
        'tasks link': [{ link: '/ops/tasks' }, 'ok'],
        'root link': [{ link: '/' }, 'ok'],
        'protocol-relative link': [
          { link: '//evil.example.test/x' },
          'notifications_link_relative',
        ],
        'backslash link': [{ link: '/\\evil' }, 'notifications_link_relative'],
        'module bogus': [{ module: 'bogus' }, 'notifications_module_check'],
        'unknown user': [{ user_id: SUBJECT }, 'notifications_user_id_users_id_fk'],
      },
    ),
    variants('outbox event rules (D-011)', 'core.integration_events', event, {
      'same producer and key': [{}, 'integration_events_producer_key'],
      'same key from another producer': [{ producer: 'academic' }, 'ok'],
      'version 0': [
        { idempotency_key: 'sample-3', version: 0 },
        'integration_events_version_positive',
      ],
      'producer bogus': [{ producer: 'bogus' }, 'integration_events_producer_check'],
      'no payload': [{ idempotency_key: 'sample-3', payload: null }, '23502'],
    }),
    variants(
      'event delivery rules',
      'core.event_deliveries',
      (o) => ({
        event_id: ids.event1,
        consumer: 'academic.sample-consumer',
        status: 'failed',
        ...o,
      }),
      {
        'same event and consumer': [{}, 'event_deliveries_event_consumer_key'],
        'another consumer': [{ consumer: 'marketing.sample-consumer' }, 'ok'],
        'status bogus': [{ consumer: 'x', status: 'bogus' }, 'event_deliveries_status_check'],
        'attempts 0': [{ consumer: 'x', attempts: 0 }, 'event_deliveries_attempts_positive'],
        'unknown event': [
          { event_id: SUBJECT },
          'event_deliveries_event_id_integration_events_id_fk',
        ],
      },
    ),
    variants(
      'idempotency keys (D-012, NULLS NOT DISTINCT)',
      'core.idempotency_keys',
      (o) => ({
        scope: 'POST /ops/api/v1/leads',
        key: 'k-1',
        request_hash: 'h',
        expires_at: FUTURE,
        ...o,
      }),
      {
        'same key, both service calls': [{}, 'idempotency_keys_scope_user_key'],
        'same key from a user': [{ user_id: () => ctx.ids.user }, 'ok'],
        'same key, other scope': [{ scope: 'POST /ops/api/v1/follow-ups' }, 'ok'],
      },
    ),
  ]);
});

describe('on-delete behaviour of referenced rows', () => {
  const rows = async (sql: string, param: string) => (await ctx.pg.query(sql, [param])).rows;
  const add = (table: string, row: Row) => insert(ctx.pg, table, row);
  const user = (email: string) =>
    add('core.users', { email, display_name: 'Sample User (fictional)' });

  it('set-null links are cleared and owned rows cascade', async () => {
    const state = await rolledBack(ctx.pg, async () => {
      const staff = await add('core.staff_members', { full_name: 'Sample Leaver' });
      const report = await add('core.staff_members', {
        full_name: 'Sample Report',
        manager_id: staff,
      });
      const ownedLead = await add(
        'ops.leads',
        lead({ code: 'LEAD-000097', owner_staff_id: staff }),
      );
      await add('ops.staff_profiles', { staff_id: staff });
      const leaver = await user('leaver@example.test');
      const linked = await add('core.staff_members', {
        full_name: 'Sample Linked',
        user_id: leaver,
      });
      await add('core.user_roles', { user_id: leaver, role: 'sample_role' });
      await add('core.user_roles', {
        user_id: ctx.ids.user2,
        role: 'sample_role',
        granted_by: leaver,
      });
      await add('ops.settings', { key: 'sample.deleted', value: '1', updated_by: leaver });
      const ev = await add('core.integration_events', event({ idempotency_key: 'sample-gone' }));
      const ev3 = await add('core.integration_events', event({ idempotency_key: 'sample-3' }));
      const adm = await add(
        'ops.admissions',
        admission({ code: 'ADM-000097', last_request_event_id: ev }),
      );
      await add('ops.admission_transitions', {
        admission_id: adm,
        to_status: 'lost',
        actor_type: 'system',
        event_id: ev,
      });
      await add(
        'ops.enrolment_attempts',
        enrolmentAttempt({ attempt: 3, request_event_id: ev3, reply_event_id: ev }),
      );
      await ctx.pg.query('DELETE FROM core.staff_members WHERE id = $1', [staff]);
      await ctx.pg.query('DELETE FROM core.users WHERE id = $1', [leaver]);
      await ctx.pg.query('DELETE FROM core.integration_events WHERE id = $1', [ev]);
      return {
        leadOwner: await rows('SELECT owner_staff_id FROM ops.leads WHERE id = $1', ownedLead),
        manager: await rows('SELECT manager_id FROM core.staff_members WHERE id = $1', report),
        profile: await rows('SELECT 1 FROM ops.staff_profiles WHERE staff_id = $1', staff),
        login: await rows('SELECT user_id FROM core.staff_members WHERE id = $1', linked),
        ownRoles: await rows('SELECT 1 FROM core.user_roles WHERE user_id = $1', leaver),
        grantedBy: await rows(
          `SELECT granted_by FROM core.user_roles WHERE user_id = $1 AND role = 'sample_role'`,
          ctx.ids.user2,
        ),
        settingBy: await rows(
          'SELECT updated_by FROM ops.settings WHERE key = $1',
          'sample.deleted',
        ),
        admissionEvent: await rows(
          'SELECT last_request_event_id FROM ops.admissions WHERE id = $1',
          adm,
        ),
        transitionEvent: await rows(
          'SELECT event_id FROM ops.admission_transitions WHERE admission_id = $1',
          adm,
        ),
        attemptReply: await rows(
          'SELECT reply_event_id FROM ops.enrolment_attempts WHERE request_event_id = $1',
          ev3,
        ),
      };
    });
    expect(state).toEqual({
      leadOwner: [{ owner_staff_id: null }],
      manager: [{ manager_id: null }],
      profile: [],
      login: [{ user_id: null }],
      ownRoles: [],
      grantedBy: [{ granted_by: null }],
      settingBy: [{ updated_by: null }],
      admissionEvent: [{ last_request_event_id: null }],
      transitionEvent: [{ event_id: null }],
      attemptReply: [{ reply_event_id: null }],
    });
  });

  it('restrict links refuse deleting a referenced parent', async () => {
    const scenarios: Record<string, [() => Promise<[string, string]>, string]> = {
      'unreferenced staff member (control)': [
        async () => ['core.staff_members', await add('core.staff_members', { full_name: 'S' })],
        'ok',
      ],
      'staff member owning a follow-up': [
        async () => {
          const s = await add('core.staff_members', { full_name: 'Sample Owner' });
          await add('ops.follow_ups', followUp({ owner_staff_id: s }));
          return ['core.staff_members', s];
        },
        'follow_ups_owner_staff_id_staff_members_id_fk',
      ],
      'user who created a lead': [
        async () => {
          const u = await user('creator@example.test');
          await add('ops.leads', lead({ created_by: u }));
          return ['core.users', u];
        },
        'leads_created_by_users_id_fk',
      ],
      'department with staff': [
        async () => {
          const d = await add('core.departments', coded('SAMPLE_GONE')({}));
          await add('core.staff_members', { full_name: 'Sample Member', department_id: d });
          return ['core.departments', d];
        },
        'staff_members_department_id_departments_id_fk',
      ],
      'programme a lead is interested in': [
        async () => {
          const p = await add('core.programmes', coded('SAMPLE_GONE')({}));
          await add('ops.leads', lead({ programme_id: p }));
          return ['core.programmes', p];
        },
        'leads_programme_id_programmes_id_fk',
      ],
      'student with an admission': [
        async () => ['core.students', ctx.ids.student],
        'admissions_student_id_students_id_fk',
      ],
      'lead a duplicate was merged into': [
        async () => {
          const target = await add('ops.leads', lead());
          await add('ops.leads', lead({ code: 'LEAD-000098', merged_into_lead_id: target }));
          return ['ops.leads', target];
        },
        'leads_merged_into_lead_id_leads_id_fk',
      ],
      'lead with an enquiry': [
        async () => {
          const l = await add('ops.leads', lead());
          await add('ops.enquiries', {
            lead_id: l,
            received_at: NOW,
            source_code: 'SAMPLE_WALK_IN',
            created_by: ctx.ids.user,
          });
          return ['ops.leads', l];
        },
        'enquiries_lead_id_leads_id_fk',
      ],
      'outbox event with a delivery': [
        async () => {
          const ev = await add('core.integration_events', event({ idempotency_key: 'sample-d' }));
          await add('core.event_deliveries', { event_id: ev, consumer: 'x', status: 'dead' });
          return ['core.integration_events', ev];
        },
        'event_deliveries_event_id_integration_events_id_fk',
      ],
      'outbox event that requested an enrolment': [
        async () => {
          const ev = await add('core.integration_events', event({ idempotency_key: 'sample-r' }));
          await add(
            'ops.enrolment_attempts',
            enrolmentAttempt({ attempt: 4, request_event_id: ev }),
          );
          return ['core.integration_events', ev];
        },
        'enrolment_attempts_request_event_id_integration_events_id_fk',
      ],
    };
    const actual: Record<string, string> = {};
    for (const [name, [arrange]] of Object.entries(scenarios)) {
      actual[name] = await rolledBack(ctx.pg, async () => {
        const [table, target] = await arrange();
        await ctx.pg.query(`DELETE FROM ${table} WHERE id = $1`, [target]);
        return 'ok';
      });
    }
    expect(actual).toEqual(
      Object.fromEntries(Object.entries(scenarios).map(([name, [, want]]) => [name, want])),
    );
  });
});

describe('column defaults', () => {
  const TX = 'transaction time';
  const defaults: [string, () => Row, Row][] = [
    [
      'core.users',
      () => ({ email: 'fresh@example.test', display_name: 'Sample Fresh' }),
      {
        status: 'active',
        password_hash: null,
        created_at: TX,
        updated_at: TX,
      },
    ],
    ['core.students', () => ({ full_name: 'Sample Fresh' }), { is_sample: false, created_at: TX }],
    ['core.staff_members', () => ({ full_name: 'Sample Fresh' }), { status: 'active' }],
    ['core.departments', () => coded('SAMPLE_FRESH')({}), { status: 'provisional' }],
    ['core.programmes', () => coded('SAMPLE_FRESH')({}), { status: 'planned' }],
    ['core.branches', () => coded('SAMPLE_FRESH')({}), { status: 'provisional' }],
    [
      'core.approvals',
      () => approval({ subject_id: SELF }),
      {
        status: 'pending',
        requested_at: TX,
      },
    ],
    [
      'core.audit_events',
      () => ({ actor_type: 'system', module: 'ops', action: 'a', entity_type: 'e' }),
      {
        at: TX,
      },
    ],
    [
      'core.integration_events',
      () => event({ idempotency_key: 'sample-fresh' }),
      {
        occurred_at: TX,
      },
    ],
    [
      'core.event_deliveries',
      () => ({ event_id: ids.event2, consumer: 'x', status: 'processed' }),
      {
        attempts: 1,
      },
    ],
    [
      'core.idempotency_keys',
      () => ({ scope: 's', key: 'k', request_hash: 'h', expires_at: FUTURE }),
      {
        completed: false,
      },
    ],
    ['ops.settings', () => ({ key: 'sample.fresh', value: '1' }), { decision_state: 'proposed' }],
    [
      'ops.lead_sources',
      () => ({ code: 'SAMPLE_FRESH', label: 'Sample' }),
      {
        status: 'active',
        sort_order: 0,
      },
    ],
    [
      'ops.leads',
      () => lead({ code: 'LEAD-000096' }),
      {
        is_sample: false,
        interest_mode: 'undecided',
        interested_programme_codes: [],
        created_at: TX,
        updated_at: TX,
      },
    ],
    [
      'ops.admissions',
      () => ({ code: 'ADM-000096', lead_id: ids.lead2, created_by: ctx.ids.user }),
      {
        status: 'new',
        handoff_status: 'not_requested',
        enrolment_attempt: 0,
        demo_skipped: false,
        status_changed_at: TX,
      },
    ],
    ['ops.follow_ups', () => followUp(), { status: 'open', source: 'manual' }],
    [
      'ops.staff_profiles',
      () => ({ staff_id: ctx.ids.staff }),
      {
        is_sample: false,
        employment_type: 'not_recorded',
        employment_status: 'not_recorded',
        timezone: 'Asia/Kolkata',
        verification_status: 'unverified',
        role_labels: [],
        updated_at: TX,
      },
    ],
  ];

  it('fill status, flag, counter and timestamp defaults (timestamps = transaction time)', async () => {
    const actual = await rolledBack(ctx.pg, async () => {
      const now = (await ctx.pg.query<{ now: Date }>('SELECT now()')).rows[0]!.now;
      const got: Record<string, Row> = {};
      const want: Record<string, Row> = {};
      for (const [table, build, expected] of defaults) {
        const row = (await ctx.pg.query<Row>(...insertSql(table, build()))).rows[0]!;
        got[table] = Object.fromEntries(Object.keys(expected).map((k) => [k, row[k]]));
        want[table] = Object.fromEntries(
          Object.entries(expected).map(([k, v]) => [k, v === TX ? now : v]),
        );
      }
      return { got, want };
    });
    if (typeof actual === 'string') throw new Error(actual);
    expect(actual.got).toEqual(actual.want);
  });
});
