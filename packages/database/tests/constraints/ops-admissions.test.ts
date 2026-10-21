import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPS_ADMISSION_STATUSES, OPS_APPLICATION_STATUSES } from '../../src/schema/index';
import { NOW, insert, one, runCases, setup, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let programme = '';
let admission2 = '';
let application = '';
let form = '';
beforeAll(async () => {
  ctx = await setup();
  const { pg, ids } = ctx;
  programme = await insert(pg, 'core.programmes', { code: 'CLAT', name: 'CLAT' });
  admission2 = await insert(
    pg,
    'ops.admissions',
    admission({
      code: 'ADM-000002',
      admission_number: '777',
      programme_id: programme,
      status: 'new',
    }),
  );
  application = await insert(
    pg,
    'ops.applications',
    app({ reference: 'APP-000001', admission_id: ids.admission }),
  );
  await insert(pg, 'ops.application_versions', {
    application_id: application,
    version: 1,
    snapshot: '{}',
    content_hash: 'b'.repeat(64),
    created_by: ids.user,
  });
  // D-040 order: the admission carries the number before its approval row is written.
  await pg.query(`UPDATE ops.admissions SET admission_number = '001' WHERE id = $1`, [
    ids.admission,
  ]);
  form = await insert(pg, 'ops.application_forms', {
    application_id: application,
    version: 1,
    template_version: 'application-form/1',
    pdf_sha256: 'a'.repeat(64),
    generated_by: ids.user,
  });
  await insert(pg, 'ops.signature_confirmations', signature());
  await insert(pg, 'ops.admission_approvals', approval());
});
afterAll(() => ctx.t.close());

/** Closed by default: the setup admission is the lead's one open case without a programme. */
function admission(o: Row = {}): Row {
  return {
    code: 'ADM-000003',
    lead_id: ctx.ids.lead,
    created_by: ctx.ids.user,
    status: 'lost',
    ...o,
  };
}
function app(o: Row = {}): Row {
  const { ids } = ctx;
  return {
    reference: 'APP-000002',
    student_id: ids.student,
    admission_id: admission2,
    origin: 'direct',
    created_by: ids.user,
    ...o,
  };
}
function signature(o: Row = {}): Row {
  return {
    application_id: application,
    version: 1,
    form_id: form,
    signers: JSON.stringify([{ role: 'student', name: 'Sample Student' }]),
    signed_on: '2026-10-21',
    confirmed_by: ctx.ids.user,
    ...o,
  };
}
function approval(o: Row = {}): Row {
  return {
    admission_id: ctx.ids.admission,
    application_id: application,
    application_version: 1,
    approved_by: ctx.ids.user,
    reauth_method: 'password',
    reauth_verified_at: NOW,
    accepted_snapshot: '{}',
    admission_number: '001',
    ...o,
  };
}

describe('admissions', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'admission statuses (OPS_ADMISSION_STATUSES) are the only transition targets',
        'ops.admission_transitions',
        OPS_ADMISSION_STATUSES,
        'admission_transitions_to_check',
        (v) => ({ admission_id: ctx.ids.admission, to_status: v, actor_type: 'system' }),
      ),
      one(
        'an admission status outside the vocabulary is refused',
        'ops.admissions',
        () => admission({ status: 'bogus' }),
        'admissions_status_check',
      ),
      {
        rule: 'admission number format (001 style or a formatted code, ≤ 40 chars)',
        table: 'ops.admissions',
        values: [
          '002',
          '014',
          '2026/001',
          'ELEV-2026-CL-2110-001',
          '',
          '-001',
          '/001',
          '00 1',
          'X'.repeat(41),
        ],
        build: (v) => admission({ admission_number: v }),
        expected: {
          '002': 'ok',
          '014': 'ok',
          '2026/001': 'ok',
          'ELEV-2026-CL-2110-001': 'ok',
          '': 'admissions_number_format',
          '-001': 'admissions_number_format',
          '/001': 'admissions_number_format',
          '00 1': 'admissions_number_format',
          ['X'.repeat(41)]: 'admissions_number_format',
        },
      },
      one(
        'an admission number is never given twice',
        'ops.admissions',
        () => admission({ admission_number: '777' }),
        'admissions_admission_number_key',
      ),
      one(
        'one open admission per lead and programme',
        'ops.admissions',
        () => admission({ programme_id: programme, status: 'new' }),
        'admissions_one_open_per_programme',
      ),
      one(
        'one open admission per lead without a programme',
        'ops.admissions',
        () => admission({ status: 'new' }),
        'admissions_one_open_without_programme',
      ),
      one(
        'on_hold remembers the status it was held from',
        'ops.admissions',
        () => admission({ status: 'on_hold' }),
        'admissions_held_from_check',
      ),
      one(
        'enrolled needs the Academic enrolment and student ids',
        'ops.admissions',
        () => admission({ status: 'enrolled' }),
        'admissions_enrolled_has_ids',
      ),
      one(
        'legacy "verified" needs who and when',
        'ops.admissions',
        () => admission({ legacy_verification: 'verified' }),
        'admissions_legacy_verified_check',
      ),
    ],
  );
});

describe('admission numbers', () => {
  runCases(
    () => ctx.pg,
    [
      {
        rule: 'counter scope is "all" or Y + 4-digit year',
        table: 'ops.admission_number_counters',
        values: ['all', 'Y2026', 'ALL', 'Y26', '2026'],
        build: (v) => ({ scope_key: v }),
        expected: {
          all: 'ok',
          Y2026: 'ok',
          ALL: 'admission_number_counters_scope_format',
          Y26: 'admission_number_counters_scope_format',
          2026: 'admission_number_counters_scope_format',
        },
      },
      one(
        'a counter never hands out 0',
        'ops.admission_number_counters',
        () => ({ scope_key: 'Y2027', next_value: 0 }),
        'admission_number_counters_next_check',
      ),
      {
        rule: 'a manual number change needs a reason of at least 10 characters',
        table: 'ops.admission_number_changes',
        values: ['too short', 'Typo fixed by office'],
        build: (v) => ({
          admission_id: ctx.ids.admission,
          new_number: '001',
          kind: 'manual',
          reason: v,
          actor_user_id: ctx.ids.user,
        }),
        expected: {
          'too short': 'admission_number_changes_manual_reason',
          'Typo fixed by office': 'ok',
        },
      },
      one(
        'a number change is auto or manual',
        'ops.admission_number_changes',
        () => ({
          admission_id: ctx.ids.admission,
          new_number: '001',
          kind: 'bogus',
          actor_user_id: ctx.ids.user,
        }),
        'admission_number_changes_kind_check',
      ),
    ],
  );
});

describe('applications, signatures and final approval', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'application statuses (OPS_APPLICATION_STATUSES)',
        'ops.applications',
        OPS_APPLICATION_STATUSES,
        'applications_status_check',
        (v) => app({ status: v }),
      ),
      {
        rule: 'application reference is APP- and 6 digits',
        table: 'ops.applications',
        values: ['APP-000002', 'APP-1', 'app-000002', 'APP-0000002'],
        build: (v) => app({ reference: v }),
        expected: {
          'APP-000002': 'ok',
          'APP-1': 'applications_reference_format',
          'app-000002': 'applications_reference_format',
          'APP-0000002': 'applications_reference_format',
        },
      },
      {
        rule: 'origin demo needs a demo and origin readmission a previous admission',
        table: 'ops.applications',
        values: ['direct', 'demo', 'readmission'],
        build: (v) => app({ origin: v }),
        expected: {
          direct: 'ok',
          demo: 'applications_demo_link',
          readmission: 'applications_readmission_link',
        },
      },
      one(
        'a direct application has no demo',
        'ops.applications',
        () => app({ demo_id: ctx.ids.demo }),
        'applications_demo_link',
      ),
      one(
        'one application per admission case',
        'ops.applications',
        () => app({ admission_id: ctx.ids.admission }),
        'applications_admission_key',
      ),
      one(
        'one live signature confirmation per application',
        'ops.signature_confirmations',
        () => signature(),
        'signature_confirmations_live_key',
      ),
      one(
        'an invalidated confirmation records who and why',
        'ops.signature_confirmations',
        () => signature({ invalidated_at: NOW }),
        'signature_confirmations_invalidated_check',
      ),
      one(
        'a confirmation has at least one signer',
        'ops.signature_confirmations',
        () => signature({ signers: '[]' }),
        'signature_confirmations_signers_check',
      ),
      one(
        'one final approval per admission',
        'ops.admission_approvals',
        () => approval(),
        'admission_approvals_admission_key',
      ),
      one(
        'an admission number is given by one approval only',
        'ops.admission_approvals',
        () => approval({ admission_id: admission2 }),
        'admission_approvals_number_key',
      ),
      one(
        "the approval's number must be the admission's number",
        'ops.admission_approvals',
        () => approval({ admission_id: admission2, admission_number: '999' }),
        'admission_approvals_admission_number_fk',
      ),
      one(
        'an approval names an existing application version',
        'ops.admission_approvals',
        () =>
          approval({ admission_id: admission2, admission_number: '777', application_version: 2 }),
        'admission_approvals_version_fk',
      ),
      one(
        'a form shows an existing version of its application',
        'ops.application_forms',
        () => ({
          application_id: application,
          version: 2,
          template_version: 'application-form/1',
          pdf_sha256: 'a'.repeat(64),
          generated_by: ctx.ids.user,
        }),
        'application_forms_version_fk',
      ),
      one(
        'a signature names a form of the same application version',
        'ops.signature_confirmations',
        () =>
          signature({
            version: 2,
            invalidated_at: NOW,
            invalidated_by: ctx.ids.user,
            invalidated_reason: 'Sample test',
          }),
        'signature_confirmations_form_fk',
      ),
      one(
        're-authentication method is password',

        'ops.admission_approvals',
        () =>
          approval({ admission_id: admission2, admission_number: '002', reauth_method: 'bogus' }),
        'admission_approvals_reauth_check',
      ),
    ],
  );
});

describe('a confirmed admission number is immutable (D-040)', () => {
  it.each(['002', null])('changing it to %s is refused by the database', async (next) => {
    await expect(
      ctx.pg.query(`UPDATE ops.admissions SET admission_number = $1 WHERE id = $2`, [
        next,
        ctx.ids.admission,
      ]),
    ).rejects.toMatchObject({ constraint: 'admission_approvals_admission_number_fk' });
  });
});
