import { afterAll, beforeAll, describe } from 'vitest';
import { OPS_GUARDIAN_RELATIONSHIPS, OPS_ONBOARDING_STATUSES } from '../../src/schema/index';
import { NOW, insert, one, runCases, setup, vocab, type Row } from './helpers';
import { isMaskedReference } from '@elevate/shared-contracts';

const MASKED_CASES = [
  'XXXX-XXXX-1234',
  'XXXX XXXX 9012',
  '•••••1234F',
  '1234 5678 9012',
  '1234-5678-9012',
  'ABCDE1234F',
  '1234',
  'XXXX123456',
  'X',
];

let ctx: Awaited<ReturnType<typeof setup>>;
let item = '';
beforeAll(async () => {
  ctx = await setup();
  const { pg, ids } = ctx;
  await insert(pg, 'ops.guardians', guardian({ is_primary: true }));
  const [low, high] = [ids.student, ids.student2].sort();
  await insert(pg, 'ops.student_siblings', {
    student_id: low,
    sibling_student_id: high,
    created_by: ids.user,
  });
  await insert(pg, 'ops.onboarding_templates', template());
  item = await insert(pg, 'ops.onboarding_items', {
    admission_id: ids.admission,
    item_key: 'id_card',
    label: 'ID card',
    kind: 'check',
    added_explicitly: true,
    created_by: ids.user,
  });
});
afterAll(() => ctx.t.close());

function guardian(o: Row = {}): Row {
  return {
    student_id: ctx.ids.student,
    full_name: 'Sample Guardian',
    relationship: 'mother',
    created_by: ctx.ids.user,
    ...o,
  };
}
function template(o: Row = {}): Row {
  return {
    code: 'class_12',
    version: 1,
    programme_codes: '{CLAT}',
    items: '[]',
    created_by: ctx.ids.user,
    ...o,
  };
}
const kyc = (o: Row = {}): Row => ({
  student_id: ctx.ids.student,
  subject_type: 'student',
  document_type: 'aadhaar',
  masked_reference: 'XXXX-XXXX-1234',
  created_by: ctx.ids.user,
  ...o,
});
const sibling = (pair: 'ordered' | 'reversed' | 'same'): Row => {
  const [low, high] = [ctx.ids.student, ctx.ids.student2].sort();
  const ends = { ordered: [low, high], reversed: [high, low], same: [low, low] }[pair];
  return { student_id: ends[0], sibling_student_id: ends[1], created_by: ctx.ids.user };
};

describe('guardians', () => {
  runCases(
    () => ctx.pg,
    [
      one(
        'a guardian belongs to an existing student',
        'ops.guardians',
        () => guardian({ student_id: crypto.randomUUID() }),
        'guardians_student_id_students_id_fk',
      ),
      vocab(
        'relationships (OPS_GUARDIAN_RELATIONSHIPS)',
        'ops.guardians',
        OPS_GUARDIAN_RELATIONSHIPS,
        'guardians_relationship_check',
        (v) => guardian({ relationship: v }),
      ),
      {
        rule: 'guardian phone is E.164',
        table: 'ops.guardians',
        values: ['+15550100', '15550100', '+0555010012', '+1555'],
        build: (v) => guardian({ phone: v }),
        expected: {
          '+15550100': 'ok',
          15550100: 'guardians_phone_e164',
          '+0555010012': 'guardians_phone_e164',
          '+1555': 'guardians_phone_e164',
        },
      },
      one(
        'guardian email is stored lower-case',
        'ops.guardians',
        () => guardian({ email: 'Mum@example.test' }),
        'guardians_email_lowercase',
      ),
      {
        rule: 'at most one live primary guardian per student (archived ones do not count)',
        table: 'ops.guardians',
        values: ['live', 'archived'],
        build: (v) => guardian({ is_primary: true, archived_at: v === 'archived' ? NOW : null }),
        expected: { live: 'guardians_one_primary_per_student', archived: 'ok' },
      },
    ],
  );
});

describe('siblings and KYC documents', () => {
  runCases(
    () => ctx.pg,
    [
      {
        rule: 'a sibling pair is stored once, lower id first, never a student with themself',
        table: 'ops.student_siblings',
        values: ['ordered', 'reversed', 'same'],
        build: (v) => sibling(v as 'ordered'),
        expected: {
          ordered: 'student_siblings_pair_key',
          reversed: 'student_siblings_ordered',
          same: 'student_siblings_ordered',
        },
      },
      {
        // Same rule as isMaskedReference (shared-contracts), which decides the expectation.
        rule: 'a KYC reference is masked: 2–40 chars, at most 4 digits, a mask character',
        table: 'ops.kyc_documents',
        values: MASKED_CASES,
        build: (v) => kyc({ masked_reference: v }),
        expected: Object.fromEntries(
          MASKED_CASES.map((v) => [v, isMaskedReference(v) ? 'ok' : 'kyc_documents_masked_check']),
        ),
      },
      one(
        'a guardian document names its guardian',
        'ops.kyc_documents',
        () => kyc({ subject_type: 'guardian' }),
        'kyc_documents_guardian_link',
      ),
      one(
        'a verified document records who verified it and when',
        'ops.kyc_documents',
        () => kyc({ verification_status: 'verified' }),
        'kyc_documents_verified_pair',
      ),
      one(
        'a rejected document needs a note',
        'ops.kyc_documents',
        () => kyc({ verification_status: 'rejected', verified_by: ctx.ids.user, verified_at: NOW }),
        'kyc_documents_rejected_note',
      ),
    ],
  );
});

describe('onboarding', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'onboarding item event statuses (OPS_ONBOARDING_STATUSES)',
        'ops.onboarding_item_events',
        OPS_ONBOARDING_STATUSES,
        'onboarding_item_events_status_check',
        (v) => ({
          item_id: item,
          status: v,
          note: 'Waiting for photo',
          actor_user_id: ctx.ids.user,
        }),
      ),
      one(
        'a blocked onboarding item needs a note',
        'ops.onboarding_item_events',
        () => ({ item_id: item, status: 'blocked', actor_user_id: ctx.ids.user }),
        'onboarding_item_events_blocked_note',
      ),
      {
        rule: 'templates are unique per (code, version)',
        table: 'ops.onboarding_templates',
        values: ['1', '2'],
        build: (v) => template({ version: v }),
        expected: { 1: 'onboarding_templates_code_version_key', 2: 'ok' },
      },
      one(
        'an item not added explicitly comes from a template',
        'ops.onboarding_items',
        () => ({
          admission_id: ctx.ids.admission,
          item_key: 'kit',
          label: 'Kit',
          kind: 'material',
          created_by: ctx.ids.user,
        }),
        'onboarding_items_template_check',
      ),
      one(
        'a material issue has a quantity of at least 1',
        'ops.material_issues',
        () => ({
          admission_id: ctx.ids.admission,
          catalogue_code: 'clat_kit',
          title: 'CLAT kit',
          quantity: 0,
          kind: 'issue',
          issued_on: '2026-10-21',
          actor_user_id: ctx.ids.user,
        }),
        'material_issues_quantity_check',
      ),
    ],
  );
});
