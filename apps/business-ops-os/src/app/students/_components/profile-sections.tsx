/**
 * Student record building blocks (owner brief §8 A–J), shared by the profile
 * page, the list pop-up and the report: bordered DetailTables and RecordTables
 * for admission facts, programmes, status history, exit records, upcoming
 * items, Academic results/attendance ("Source unavailable", never zeros),
 * guardians and activity; plus the lifecycle and admission-number forms, each
 * in a FormModal opened by `?action=`. Server components.
 */
import type { ReactNode } from 'react';
import { OPS_EXIT_MATERIAL_STATUSES } from '@elevate/database';
import {
  Alert,
  ButtonLink,
  JourneyRail,
  SourceBadge,
  StatusBadge,
  type JourneyStage,
} from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../../../domain';
import type { getStudent } from '../../../server/students';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, fmtPaise, humanise, statusTone } from '../../../ui/format';
import { listHref } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment, Timeline } from '../../../ui/sections';

export type Profile = Awaited<ReturnType<typeof getStudent>>;
type Level = { level?: 2 | 3 };

export const statusLabel = (s: string) =>
  ADMISSION_STATUS_LABELS[s as AdmissionStatus] ?? humanise(s);

/** Batches belong to Academic OS; Ops only knows whether one is requested or assigned. */
export const batchLabel = (enrolled: string | null, intended: string | null) =>
  enrolled ? 'Assigned in Academic OS' : intended ? 'Requested from Academic OS' : 'To be assigned';

const StatusCell = ({ status, label }: { status: string; label: string }) => (
  <StatusBadge tone={statusTone(status)}>{label}</StatusBadge>
);

/** Admission facts (A Overview): number, status, programmes, dates, counsellor, hold/exit. */
export function AdmissionFacts({ d }: { d: Profile }) {
  const a = d.admission;
  const exit = d.exitRecords.find((x) => !x.reactivatedAt);
  const converted = d.demos.filter((x) => x.outcome === 'converted');
  return (
    <DetailTable
      rows={[
        {
          label: 'Admission no.',
          value: `${a.admissionNumber ?? 'Not assigned'}${d.numberChanges.length > 1 ? ` (changed ${d.numberChanges.length - 1} time(s))` : ''}`,
        },
        { label: 'Status', value: <StatusCell status={a.status} label={a.statusLabel} /> },
        {
          label: 'Programmes',
          value: d.cases.length
            ? d.cases.map((c) => c.programme?.name ?? 'Programme not set').join(' + ')
            : 'Not set',
        },
        { label: 'Counsellor', value: d.owner?.fullName ?? 'Unassigned' },
        { label: 'Admitted on', value: fmtDate(a.admissionDate) },
        {
          label: 'Mode and start',
          value: `${humanise(a.deliveryMode)}, from ${fmtDate(a.intendedStartDate)}`,
        },
        {
          label: 'Demo',
          value: converted.length
            ? converted.map((x) => (
                <a key={x.id} href={`/ops/admissions/demos/${x.id}`}>
                  Converted demo ({fmtDateTime(x.outcomeAt)})
                </a>
              ))
            : d.demos.length
              ? `${d.demos.length} demo(s), none converted`
              : 'No demo (joined without one)',
        },
        !!a.holdReviewDate && {
          label: 'On hold',
          value: `Review on ${fmtDate(a.holdReviewDate)}: ${a.statusReason ?? 'no reason recorded'}`,
        },
        exit && {
          label: 'Exit',
          value: `${statusLabel(exit.exitStatus)} on ${fmtDate(exit.exitDate)}: ${exit.reason}`,
        },
        {
          label: 'Academic OS',
          value: d.academic.path ? (
            <a href={d.academic.path}>Open in Academic OS</a>
          ) : (
            'Not enrolled yet'
          ),
        },
      ]}
    />
  );
}

/** B Programmes and batches: one admission case per programme. */
export function ProgrammesTable({ d }: { d: Profile }) {
  return (
    <RecordTable
      caption="One admission case per programme"
      rows={d.cases}
      rowKey={(c) => c.id}
      columns={[
        { key: 'programme', header: 'Programme', render: (c) => c.programme?.name ?? 'Not set' },
        {
          key: 'case',
          header: 'Admission',
          render: (c) => <a href={`/ops/admissions/${c.id}`}>{c.admissionNumber ?? c.code}</a>,
        },
        {
          key: 'status',
          header: 'Status',
          render: (c) => <StatusCell status={c.status} label={c.statusLabel} />,
        },
        {
          key: 'batch',
          header: 'Batch',
          render: (c) => batchLabel(c.enrolledBatchId, c.intendedBatchId),
        },
        { key: 'admitted', header: 'Admitted', render: (c) => fmtDate(c.admissionDate) },
        { key: 'enrolled', header: 'Enrolled', render: (c) => fmtDateTime(c.enrolledAt) },
      ]}
    />
  );
}

/** Status history of the main case (transition table, oldest first). */
export function HistoryTable({ d }: { d: Profile }) {
  return (
    <RecordTable
      rows={d.history}
      rowKey={(t) => t.id}
      empty="No status changes recorded."
      columns={[
        { key: 'at', header: 'When', render: (t) => fmtDateTime(t.at) },
        {
          key: 'from',
          header: 'From',
          render: (t) => (t.fromStatus ? statusLabel(t.fromStatus) : '—'),
        },
        { key: 'to', header: 'To', render: (t) => statusLabel(t.toStatus) },
        {
          key: 'by',
          header: 'Recorded by',
          render: (t) =>
            t.actorType === 'system' ? 'Academic OS reply' : (t.actorName ?? 'Unknown user'),
        },
        {
          key: 'reason',
          header: 'Reason',
          render: (t) => [t.reasonLabel, t.reason].filter(Boolean).join(': ') || 'Not recorded',
        },
      ]}
    />
  );
}

/** Exit records (newest first): one DetailTable each. */
export function ExitRecords({ d, level = 2 }: { d: Profile } & Level) {
  if (!d.exitRecords.length) return null;
  return d.exitRecords.map((x) => (
    <Segment
      key={x.id}
      level={level}
      flush
      title={`Exit record: ${statusLabel(x.exitStatus)}`}
      meta={x.reactivatedAt ? <StatusBadge tone="info">Reactivated</StatusBadge> : null}
    >
      <DetailTable
        rows={[
          { label: 'Exit date', value: fmtDate(x.exitDate) },
          { label: 'Reason', value: x.reasonLabel ? `${x.reasonLabel}: ${x.reason}` : x.reason },
          { label: 'Recorded by', value: `${x.recordedByName}, ${fmtDateTime(x.recordedAt)}` },
          { label: 'Student feedback', value: x.exitFeedback ?? 'Not recorded' },
          { label: 'Guardian feedback', value: x.guardianFeedback ?? 'Not recorded' },
          { label: 'Fee or refund reference', value: x.feeReference ?? 'None given' },
          x.balancePaise !== undefined && {
            label: 'Balance at exit',
            value:
              x.balancePaise === null
                ? 'Not recorded'
                : x.balancePaise < 0
                  ? `${fmtPaise(-x.balancePaise)} credit to the student`
                  : `${fmtPaise(x.balancePaise)} owed`,
          },
          { label: 'Materials', value: humanise(x.materialStatus) },
          { label: 'Closing notes', value: x.closingNotes ?? 'None' },
          { label: 'Reactivation allowed', value: x.reactivationAllowed ? 'Yes' : 'No' },
          x.reactivatedAt && { label: 'Reactivated', value: fmtDateTime(x.reactivatedAt) },
        ]}
      />
    </Segment>
  ));
}

/** G Upcoming: open follow-ups and meetings still to happen, soonest first. */
export function UpcomingTable({ d }: { d: Profile }) {
  const rows = [
    ...d.followUps.map((f) => ({
      key: f.id,
      sort: f.dueDate,
      when: fmtDate(f.dueDate),
      what: `Follow-up: ${f.title}`,
      who: d.owner?.fullName ?? 'Unassigned',
    })),
    ...d.upcomingCounselling.map((s) => ({
      key: s.id,
      sort: s.scheduledAt.toISOString(),
      when: fmtDateTime(s.scheduledAt),
      what: `${humanise(s.type)} (${humanise(s.status)}, ${s.mode})`,
      who: s.counsellorName,
    })),
  ].sort((x, y) => x.sort.localeCompare(y.sort));
  return (
    <RecordTable
      rows={rows}
      rowKey={(r) => r.key}
      empty="Nothing scheduled. Add a follow-up from the admission record or book a meeting under Meetings."
      columns={[
        { key: 'when', header: 'When' },
        { key: 'what', header: 'What' },
        { key: 'who', header: 'With' },
      ]}
    />
  );
}

/** J Activity: from the audit trail (private fields removed), newest first: when · what · who. */
export function ActivityTimeline({ rows }: { rows: Profile['timeline'] }) {
  if (!rows.length) return <p>No activity recorded.</p>;
  return (
    <Timeline
      label="Activity, newest first"
      items={rows.map((t) => ({
        key: t.id,
        when: fmtDateTime(t.at),
        title: humanise(t.action.replace(/[._]/g, ' ')),
        detail: `By ${t.actorName}`,
      }))}
    />
  );
}

/** Header labels of a student: status, admission number, legacy flag, sample badge. */
export function StudentMeta({ d }: { d: Profile }) {
  const a = d.admission;
  return (
    <>
      <StatusBadge tone={statusTone(a.status)}>{a.statusLabel}</StatusBadge>
      <span>{a.admissionNumber ?? 'No admission number'}</span>
      {a.legacyVerificationRequired ? (
        <StatusBadge tone="warning">Legacy — verification required</StatusBadge>
      ) : null}
      {d.identity?.isSample ? <SourceBadge source="sample" /> : null}
    </>
  );
}

/**
 * The student on the admission journey, from the server's own status: everything up to
 * Confirmed is done once admitted; the last stage is Active (current), On hold (current, with
 * its reason) or Active done with the exit. Demo is done only when a demo converted; a legacy
 * record has no evidence of Application and Signed, so they read "Not recorded".
 */
export function StudentJourney({ d }: { d: Profile }) {
  const a = d.admission;
  const exit = d.exitRecords.find((x) => !x.reactivatedAt);
  const confirmed = Boolean(a.admittedAt) || d.population !== 'in_admission';
  const last: Omit<JourneyStage, 'key'> =
    d.population === 'on_hold'
      ? {
          label: 'On hold',
          state: 'current',
          note: `${a.statusReason ?? 'Reason not recorded'}${a.holdReviewDate ? ` · review ${fmtDate(a.holdReviewDate)}` : ''}`,
        }
      : d.population === 'former'
        ? {
            label: 'Active',
            state: 'done',
            note: exit
              ? `${statusLabel(exit.exitStatus)} ${fmtDate(exit.exitDate)}`
              : a.statusLabel,
          }
        : { label: 'Active', state: confirmed ? 'current' : 'upcoming', note: a.stateLabel };
  // A stage the record has no evidence for says so, rather than disappearing or claiming done.
  const evidence = (key: string, label: string, done: boolean, missing = 'Not recorded') =>
    done ? { key, label, state: 'done' as const } : { key, label, note: missing };
  const legacy = a.legacyVerificationRequired;
  const stages: JourneyStage[] = [
    evidence(
      'demo',
      'Demo',
      d.demos.some((x) => x.outcome === 'converted'),
      d.demos.length ? 'Not converted' : 'No demo',
    ),
    evidence('application', 'Application', !legacy),
    evidence('signed', 'Signed', !legacy),
    {
      key: 'confirmed',
      label: 'Confirmed',
      state: confirmed ? 'done' : 'current',
      note: a.admissionDate ? fmtDate(a.admissionDate) : undefined,
    },
    { key: 'active', ...last },
  ];
  return <JourneyRail label="Admission journey" stages={stages} />;
}

/** The one next step for the header, from the server's own flags (nothing when none applies). */
export function PrimaryAction({ d, base }: { d: Profile; base: string }) {
  const [label, href] = d.actions.resume
    ? ['Resume classes', listHref(base, { action: 'resume' })]
    : d.handoff.retry.allowed
      ? ['Request enrolment again', `/ops/admissions/${d.admission.id}`]
      : d.actions.report
        ? ['Student report', `/ops/students/${d.identity?.id}/report`]
        : [];
  return label ? (
    <ButtonLink variant="primary" href={href}>
      {label}
    </ButtonLink>
  ) : null;
}

const RELATIONSHIPS = ['mother', 'father', 'guardian', 'other'];

/** F Guardians (restricted; students are mostly minors). */
export function GuardiansSegment({ d, base }: { d: Profile; base: string }) {
  if (d.guardians === 'hidden')
    return (
      <Segment title="Guardians">
        <Alert tone="info" title="Restricted">
          Guardian details need permission to see this student’s private details.
        </Alert>
      </Segment>
    );
  const id = d.identity?.id;
  const edit = d.actions.editGuardians && id;
  const liveGuardians = d.guardians.filter((g) => !g.archivedAt).length;
  return (
    <Segment
      title="Guardians"
      flush
      description="Restricted: shown only to staff allowed to see private details."
      actions={
        edit ? (
          <a href={listHref(base, { tab: 'kyc', action: 'guardian' })}>Add a guardian</a>
        ) : null
      }
    >
      <RecordTable
        rows={d.guardians}
        rowKey={(g) => g.id}
        empty="No guardians recorded. The guardian given on the enquiry is under Contact and consent."
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (g) => (
              <>
                {g.fullName}{' '}
                {g.archivedAt ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
              </>
            ),
          },
          { key: 'rel', header: 'Relationship', render: (g) => humanise(g.relationship) },
          {
            key: 'role',
            header: 'Primary / emergency',
            render: (g) =>
              [g.isPrimary && 'Primary', g.isEmergency && 'Emergency'].filter(Boolean).join(', ') ||
              '—',
          },
          { key: 'phone', header: 'Phone', render: (g) => g.phone ?? 'Not recorded' },
          { key: 'email', header: 'Email', render: (g) => g.email ?? 'Not recorded' },
          { key: 'address', header: 'Address', render: (g) => g.address ?? 'Not recorded' },
          { key: 'pref', header: 'Contact by', render: (g) => humanise(g.preferredContact) },
          { key: 'consent', header: 'Consent', render: (g) => humanise(g.consentStatus) },
          ...(edit
            ? [
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (g: (typeof d.guardians)[number]) => (
                    <>
                      {g.isPrimary || g.archivedAt ? null : (
                        <ActionForm
                          action={`/ops/api/v1/students/${id}/guardians/${g.id}`}
                          method="PATCH"
                          compact
                          variant="secondary"
                          submitLabel="Make primary"
                          labelSuffix={`: ${g.fullName}`}
                          extra={{ isPrimary: true }}
                        />
                      )}
                      {g.isPrimary && liveGuardians > 1 ? (
                        <span className="el-field-hint">Make another guardian primary first</span>
                      ) : (
                        <ActionForm
                          action={`/ops/api/v1/students/${id}/guardians/${g.id}`}
                          method="PATCH"
                          compact
                          variant="secondary"
                          submitLabel={g.archivedAt ? 'Restore' : 'Archive'}
                          labelSuffix={` ${g.fullName}`}
                          extra={{ archived: !g.archivedAt }}
                        />
                      )}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Segment>
  );
}

/** Links that open the lifecycle forms; why none is available when there is none. */
export function lifecycleLinks(d: Profile, base: string) {
  const { hold, resume, exitStatuses, reactivate } = d.actions;
  const links = [
    hold && { action: 'hold', label: 'Put on hold' },
    resume && { action: 'resume', label: 'Resume classes' },
    exitStatuses.length > 0 && { action: 'exit', label: 'Record an exit' },
    reactivate && { action: 'reactivate', label: 'Reactivate' },
    d.actions.overrideNumber &&
      d.admission.admissionNumber && { action: 'number', label: 'Correct admission number' },
  ].filter((l): l is { action: string; label: string } => Boolean(l));
  const readmit = d.population === 'former' && d.identity && (
    <a
      key="readmit"
      className="el-button el-button-secondary"
      href={`/ops/students/past?open=${d.identity.id}`}
    >
      Readmit
    </a>
  );
  return [
    ...links.map((l) => (
      <a
        key={l.action}
        className="el-button el-button-secondary"
        href={listHref(base, { action: l.action })}
      >
        {l.label}
      </a>
    )),
    ...(readmit ? [readmit] : []),
  ];
}

export const NO_LIFECYCLE =
  'No status change is available: either the student’s status does not allow one, or your role cannot change student status (or reactivate a student).';

const REASON: FieldSpec = { name: 'reason', label: 'Reason', type: 'textarea', required: true };

/** The form behind `?action=` on the profile, in a FormModal; nothing for an unknown or unpermitted action. */
export function ProfileForm({ d, action, base }: { d: Profile; action?: string; base: string }) {
  const a = d.admission;
  const lifecycle = `/ops/api/v1/admissions/${a.id}/lifecycle`;
  // ActionForm's router adds the basePath itself (D-022).
  const done = base.replace(/^\/ops/, '');
  const cancel = <a href={base}>Cancel</a>;
  const forms: Record<string, { title: string; ok: unknown; form: () => ReactNode }> = {
    hold: {
      title: 'Put on hold',
      ok: d.actions.hold,
      form: () => (
        <ActionForm
          action={lifecycle}
          submitLabel="Put on hold"
          extra={{ action: 'hold' }}
          redirectTo={done}
          secondary={cancel}
          fields={[
            { ...REASON, section: 'Hold' },
            {
              name: 'reviewDate',
              label: 'Review date',
              type: 'date',
              required: true,
              section: 'Hold',
            },
          ]}
        />
      ),
    },
    resume: {
      title: 'Resume classes',
      ok: d.actions.resume,
      form: () => (
        <ActionForm
          action={lifecycle}
          submitLabel="Resume classes"
          extra={{ action: 'resume' }}
          redirectTo={done}
          secondary={cancel}
          fields={[{ ...REASON, section: 'Resume' }]}
        />
      ),
    },
    exit: {
      title: 'Record an exit',
      ok: d.actions.exitStatuses.length > 0,
      form: () => (
        <ActionForm
          action={lifecycle}
          submitLabel="Record exit"
          variant="danger"
          extra={{ action: 'exit' }}
          redirectTo={done}
          secondary={cancel}
          fields={[
            {
              name: 'exitStatus',
              label: 'Exit status',
              type: 'select',
              required: true,
              section: 'Exit',
              options: d.actions.exitStatuses.map((s) => ({
                value: s,
                label: ADMISSION_STATUS_LABELS[s],
              })),
            },
            { name: 'exitDate', label: 'Exit date', type: 'date', required: true, section: 'Exit' },
            {
              name: 'reasonCode',
              label: 'Reason category',
              type: 'select',
              section: 'Exit',
              options: d.closureReasons.map((c) => ({ value: c.code, label: c.label })),
            },
            { ...REASON, section: 'Exit' },
            {
              name: 'exitFeedback',
              label: 'Student feedback at exit',
              type: 'textarea',
              section: 'Feedback and fees',
            },
            {
              name: 'guardianFeedback',
              label: 'Guardian feedback at exit',
              type: 'textarea',
              section: 'Feedback and fees',
            },
            {
              name: 'feeReference',
              label: 'Pending fee or refund reference',
              section: 'Feedback and fees',
            },
            {
              name: 'materialStatus',
              label: 'Books and materials',
              type: 'select',
              defaultValue: 'not_recorded',
              section: 'Feedback and fees',
              options: OPS_EXIT_MATERIAL_STATUSES.map((v) => ({ value: v, label: humanise(v) })),
            },
            {
              name: 'closingNotes',
              label: 'Closing notes',
              type: 'textarea',
              section: 'Feedback and fees',
            },
            {
              name: 'reactivationAllowed',
              label: 'Reactivation allowed later',
              type: 'checkbox',
              section: 'Feedback and fees',
            },
          ]}
        />
      ),
    },
    reactivate: {
      title: 'Reactivate',
      ok: d.actions.reactivate,
      form: () => (
        <>
          <p className="el-field-hint">
            The student returns to Admitted and enrolment is requested again. The person who
            recorded the exit cannot approve the reactivation.
          </p>
          <ActionForm
            action={lifecycle}
            submitLabel="Reactivate"
            extra={{ action: 'reactivate' }}
            redirectTo={done}
            secondary={cancel}
            fields={[{ ...REASON, section: 'Reactivation' }]}
          />
        </>
      ),
    },
    number: {
      title: 'Correct the admission number',
      ok: d.actions.overrideNumber && a.admissionNumber,
      form: () => (
        <ActionForm
          action={`/ops/api/v1/admissions/${a.id}/admission-number`}
          submitLabel="Save admission number"
          redirectTo={done}
          secondary={cancel}
          fields={[
            {
              name: 'admissionNumber',
              label: 'New admission number',
              required: true,
              section: 'Admission number',
            },
            {
              name: 'reason',
              label: 'Reason (at least 10 characters)',
              type: 'textarea',
              required: true,
              section: 'Admission number',
            },
          ]}
        />
      ),
    },
    guardian: {
      title: 'Add a guardian',
      ok: d.actions.editGuardians && d.identity,
      form: () => (
        <ActionForm
          action={`/ops/api/v1/students/${d.identity?.id}/guardians`}
          submitLabel="Add guardian"
          redirectTo={done}
          secondary={cancel}
          fields={[
            { name: 'fullName', label: 'Full name', required: true, section: 'Guardian' },
            {
              name: 'relationship',
              label: 'Relationship',
              type: 'select',
              required: true,
              section: 'Guardian',
              options: RELATIONSHIPS.map((v) => ({ value: v, label: humanise(v) })),
            },
            {
              name: 'phone',
              label: 'Phone',
              type: 'tel',
              hint: 'Indian numbers with or without +91.',
              section: 'Contact',
            },
            { name: 'email', label: 'Email', type: 'email', section: 'Contact' },
            { name: 'address', label: 'Address', type: 'textarea', section: 'Contact' },
            {
              name: 'isPrimary',
              label: 'Primary contact (the first guardian always is)',
              type: 'checkbox',
              section: 'Contact',
            },
            {
              name: 'isEmergency',
              label: 'Emergency contact',
              type: 'checkbox',
              section: 'Contact',
            },
            {
              name: 'preferredContact',
              label: 'Contact by',
              type: 'select',
              section: 'Contact',
              options: ['call', 'whatsapp', 'sms', 'email'].map((v) => ({
                value: v,
                label: humanise(v),
              })),
            },
            {
              name: 'consentStatus',
              label: 'Consent to contact',
              type: 'select',
              required: true,
              defaultValue: 'not_recorded',
              section: 'Contact',
              options: ['not_recorded', 'given', 'refused', 'withdrawn'].map((v) => ({
                value: v,
                label: humanise(v),
              })),
            },
            { name: 'notes', label: 'Notes', type: 'textarea', section: 'Contact' },
          ]}
        />
      ),
    },
  };
  const f = action ? forms[action] : undefined;
  if (!f?.ok) return null;
  return (
    <FormModal id="student-form" title={f.title} meta={d.person.fullName} closeHref={base}>
      {f.form()}
    </FormModal>
  );
}
