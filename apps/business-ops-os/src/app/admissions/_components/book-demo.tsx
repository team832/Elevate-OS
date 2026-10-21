/**
 * "Book a demo" form, shown in the pop-up at `/ops/admissions?new=1`: N demo days (setting
 * `admissions.demo.day_count`, checked again on the server), each with a first class and an
 * optional second one (more can be added from the record), plus the basic KYC (blank keeps
 * what the lead already has).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState } from '@elevate/shared-ui';
import { bookableAdmissions } from '../../../server/demos';
import { formOptions } from '../../../server/options';
import { loadSettings } from '../../../server/settings';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { load } from '../../../ui/frame';
import { programmeName } from './demo-bits';
import { kycFields } from './demo-kyc';

export async function BookDemo({
  user,
  cancelHref,
}: {
  user: AuthenticatedUser;
  cancelHref: string;
}) {
  const r = await load(async (db) => ({
    cases: await bookableAdmissions(db, user),
    options: await formOptions(db),
    count: (await loadSettings(db))['admissions.demo.day_count'],
  }));
  if (!r.ok) return r.view;
  const { cases, options, count } = r.data;
  if (cases.length === 0)
    return (
      <EmptyState
        title="No student is ready for a demo"
        description="A demo is booked after counselling. Open the lead, go to its admission case and record the counselling there, then come back."
        action={<a href="/ops/leads">Go to leads</a>}
      />
    );
  /** Slot `k` of day `day`: the first class is required, the second optional (dropped if blank). */
  const slot = (day: number, k: number): FieldSpec[] => {
    const i = (day - 1) * 2 + k;
    const section = k === 0 ? `Day ${day}` : `Day ${day}: second class (optional)`;
    return [
      {
        name: `sessions.${i}.dayNumber`,
        label: 'Day',
        type: 'hidden',
        defaultValue: String(day),
        section,
      },
      {
        name: `sessions.${i}.startsAt`,
        label: 'Start (IST)',
        type: 'datetime',
        required: k === 0,
        section,
      },
      { name: `sessions.${i}.subject`, label: 'Subject', required: k === 0, section },
      {
        name: `sessions.${i}.teacherStaffId`,
        label: 'Teacher',
        type: 'select',
        options: options.staff,
        section,
      },
    ];
  };
  const sessionFields = Array.from({ length: count.value.count }, (_, d) => [
    ...slot(d + 1, 0),
    ...slot(d + 1, 1),
  ]).flat();
  return (
    <>
      <p className="el-field-hint">
        Only counselled students without an open demo are listed. Missing someone? Record their
        counselling on the admission case first: <a href="/ops/leads">open the lead</a>, then its
        admission case.
      </p>
      <p className="el-field-hint">
        {count.value.count} demo days ({count.decisionState} setting), each on its own date with one
        or more classes. Teachers with a login get an in-app notification. Details left blank keep
        what the lead already has.
      </p>
      <ActionForm
        action="/ops/api/v1/demos"
        submitLabel="Book demo"
        secondary={<a href={cancelHref}>Cancel</a>}
        redirectTo="/ops/admissions?open={id}"
        fields={[
          {
            name: 'admissionId',
            label: 'Student',
            type: 'select',
            required: true,
            options: cases.map((c) => ({
              value: c.id,
              label: `${c.studentName} · ${c.code}${c.programmeCode ? ` · ${programmeName(c.programmeCode, options.programmes)}` : ''}`,
            })),
            section: 'Student and programme',
          },
          {
            name: 'programmeCode',
            label: 'Programme (blank = the case programme)',
            type: 'select',
            options: options.programmes,
            section: 'Student and programme',
          },
          {
            name: 'counsellorStaffId',
            label: 'Counsellor (blank = the case counsellor)',
            type: 'select',
            options: options.staff,
            section: 'Student and programme',
          },
          {
            name: 'durationMinutes',
            label: 'Class length (minutes)',
            type: 'number',
            defaultValue: '60',
            section: 'Student and programme',
          },
          ...sessionFields,
          ...kycFields(options, 'kyc.'),
          { name: 'notes', label: 'Notes', type: 'textarea', section: 'Notes' },
        ]}
      />
    </>
  );
}
