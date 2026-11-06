/**
 * "Portal access" on the KYC & guardians tab (F4-13): the student's and guardians' portal logins,
 * consent for a minor, setup slips, switch off / on. Restricted like the rest of the tab; every
 * action is checked again on the server. Server component.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { toIsoDate } from '@elevate/shared-types';
import { Alert, StatusBadge } from '@elevate/shared-ui';
import { portalAccessFor } from '../../../server/portal-access';
import { istToday } from '../../../domain/dates';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { PortalSlipButton } from '../../../ui/portal-slip';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';

export async function PortalAccessSegment({
  studentId,
  name,
  user,
  action,
  base,
}: {
  studentId: string;
  name: string;
  user: AuthenticatedUser;
  action?: string;
  base: string;
}) {
  const r = await load((db) => portalAccessFor(db, user, studentId));
  if (!r.ok) return r.view;
  const p = r.data;
  const here = listHref(base, { tab: 'kyc' });
  const write = can(user, 'ops:guardians:write');
  const blocked = p.minor && !p.consent.approved;
  const choose = (list: readonly { id: string; fullName: string }[]) =>
    list.map((g) => ({ value: g.id, label: g.fullName }));
  const fields: FieldSpec[] = [
    {
      name: 'kind',
      label: 'Who gets the login',
      type: 'select',
      required: true,
      options: [
        { value: 'student', label: 'The student' },
        { value: 'guardian', label: 'A guardian' },
      ],
      section: 'Login',
    },
    {
      name: 'guardianId',
      label: 'Guardian (for a guardian’s login)',
      type: 'select',
      options: choose(p.guardians),
      emptyHint: 'Add the guardian above first.',
      section: 'Login',
    },
    ...(p.joinable.length
      ? [
          {
            name: 'joinUserId',
            label: 'Add to the login this parent already has for a sibling (optional)',
            type: 'select' as const,
            options: p.joinable.map((j) => ({ value: j.userId, label: j.label })),
            hint: 'Leave empty to make a new login.',
            section: 'Login',
          },
        ]
      : []),
    ...(p.minor
      ? ([
          {
            name: 'consentGuardianId',
            label: 'Guardian who gave consent',
            type: 'select',
            required: true,
            options: choose(p.guardians),
            section: 'Guardian consent (student under 18)',
          },
          {
            name: 'consentGivenOn',
            label: 'Day the guardian agreed',
            type: 'date',
            required: true,
            defaultValue: istToday(new Date()),
            section: 'Guardian consent (student under 18)',
          },
          {
            name: 'consentConfirmed',
            label: `The guardian read and agreed to the consent text (version ${p.consent.version})`,
            type: 'checkbox',
            hint: p.consent.text,
            section: 'Guardian consent (student under 18)',
          },
        ] satisfies FieldSpec[])
      : []),
  ];
  return (
    <Segment
      title="Portal access"
      flush
      description="Logins to the student and parent portal: read-only attendance, published results, homework, fees and timetable of this student only."
      actions={
        write && !blocked ? (
          <a href={listHref(base, { tab: 'kyc', action: 'portal' })}>Give portal access</a>
        ) : null
      }
    >
      {p.enabled ? null : (
        <Alert tone="info">
          The portal is not open yet (Settings: “Student and parent portal open” is off). You can
          give access and print slips now; signing in starts when it is switched on.
        </Alert>
      )}
      {p.dobConflict ? (
        <Alert tone="warning">
          Two different dates of birth are recorded on this student’s enquiries. Correct the date of
          birth on the enquiries: until then no portal access can be given, and guardian logins do
          not show this student while “Guardian logins for students aged 18 or over” is off.
        </Alert>
      ) : null}
      {!p.minor && !p.guardianAccessToAdults ? (
        <Alert tone="info">
          This student is 18 or over. Only the student can get a portal login: guardian logins for
          adult students are switched off (Settings: “Guardian logins for students aged 18 or
          over”).
        </Alert>
      ) : null}
      {blocked ? (
        <Alert tone="warning">
          This student is under 18, or no date of birth is recorded. Portal access needs a
          guardian’s consent, and the consent wording is not approved yet.
        </Alert>
      ) : null}
      <RecordTable
        rows={p.accounts}
        rowKey={(a) => a.id}
        empty="No portal login yet."
        columns={[
          {
            key: 'who',
            header: 'Login holder',
            render: (a) => `${a.displayName} (${a.kind === 'student' ? 'student' : 'guardian'})`,
          },
          { key: 'login', header: 'Login', render: (a) => a.login },
          {
            key: 'consent',
            header: 'Guardian consent',
            render: (a) =>
              a.consent
                ? `${a.consent.guardianName ?? 'Guardian no longer listed'}, ${fmtDate(toIsoDate(a.consent.givenAt))}, version ${a.consent.version}`
                : 'Not recorded (student 18 or over when given)',
          },
          {
            key: 'state',
            header: 'State',
            render: (a) => (
              <>
                <StatusBadge tone={a.disabledAt ? 'neutral' : 'success'}>
                  {a.disabledAt ? `Off since ${fmtDate(toIsoDate(a.disabledAt))}` : 'On'}
                </StatusBadge>{' '}
                {a.passwordSet ? 'Password set.' : 'No password yet.'}{' '}
                {a.liveCodeExpiresAt
                  ? `Setup code valid until ${fmtDateTime(a.liveCodeExpiresAt)}.`
                  : 'No valid setup code.'}
              </>
            ),
          },
          ...(write
            ? [
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (a: (typeof p.accounts)[number]) => (
                    <>
                      {a.disabledAt ? null : (
                        <PortalSlipButton
                          action={`/ops/api/v1/portal-access/${a.id}/code`}
                          labelSuffix={` for ${a.displayName}`}
                        />
                      )}
                      <ActionForm
                        action={`/ops/api/v1/portal-access/${a.id}`}
                        method="PATCH"
                        compact
                        variant={a.disabledAt ? 'secondary' : 'danger'}
                        submitLabel={a.disabledAt ? 'Switch on' : 'Switch off'}
                        labelSuffix={` portal login of ${a.displayName}`}
                        extra={{ enabled: Boolean(a.disabledAt) }}
                      />
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      {write && action === 'portal' && !blocked ? (
        <FormModal id="portal-form" title="Give portal access" meta={name} closeHref={here}>
          <ActionForm
            action={`/ops/api/v1/students/${studentId}/portal-access`}
            submitLabel="Give portal access"
            redirectTo={here.replace(/^\/ops/, '')}
            secondary={<a href={here}>Cancel</a>}
            successText="Portal access given. Print a setup slip from the list."
            fields={fields}
          />
        </FormModal>
      ) : null}
    </Segment>
  );
}
