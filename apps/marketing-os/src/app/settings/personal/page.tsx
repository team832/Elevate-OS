import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Alert, Button, Card, Checkbox, Field, TextArea, TextInput } from '@elevate/shared-ui';
import { formatIst, modulePath } from '../../../domain';
import { campaignFilter, listCampaigns, memberOptions } from '../../../server';
import { courseOptions } from '../../../server/campaigns';
import { PERIOD_LABELS } from '../../../server/dashboard-filters';
import {
  CHECKLIST_MAX,
  FOCUS_MAX,
  GOALS_MAX,
  WEEKDAYS,
  getMyPreferences,
} from '../../../server/preferences';
import { PickField, optionsOf } from '../../../ui/fields';
import { MarketingPage, Section, type SearchParams } from '../../../ui/shell';
import { savePersonalSettingsAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Personal Settings' };

const DAY_LABELS = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
} as const satisfies Record<(typeof WEEKDAYS)[number], string>;
const VIEW_LABELS = { month: 'Month', week: 'Week', list: 'List' };
const REMINDER_LABELS = {
  '': 'Only when HR sends them',
  '2': 'Every 2 hours',
  '4': 'Every 4 hours',
  '8': 'Every 8 hours',
  '24': 'Once a day',
};

export default async function PersonalSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={modulePath('settings/personal')}
      active="personal-settings"
      title="Personal Settings"
      description="How Marketing OS opens for you and how you plan your own day. Only you can see or change these."
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const [p, owners, campaigns, courses] = await Promise.all([
              getMyPreferences(db, user),
              memberOptions(db),
              listCampaigns(db, await campaignFilter(db, user)),
              courseOptions(db),
            ]);
            const m = p.marketing;
            const focus = [...m.focusBlocks, null].slice(0, FOCUS_MAX);
            const checklist = [...m.checklist, null, null, null].slice(0, CHECKLIST_MAX);
            return (
              <form action={savePersonalSettingsAction} className="el-stack">
                <Alert tone="info" title="What these settings cannot change">
                  Personal settings never change HR deadlines, task assignments, permissions or the
                  reports you have to submit. They only set your defaults and your own planning
                  notes.
                </Alert>
                <Card
                  title="Default Overview filters"
                  description="Used when you open the Overview without choosing filters."
                >
                  <div className="el-grid">
                    <PickField
                      id="period"
                      label="Reporting period"
                      value={m.dashboard.period}
                      options={optionsOf(PERIOD_LABELS)}
                    />
                    <PickField
                      id="owner"
                      label="Owner"
                      value={m.dashboard.owner}
                      options={owners}
                      none="Everyone in my scope"
                    />
                    <PickField
                      id="campaign"
                      label="Campaign"
                      value={m.dashboard.campaign}
                      options={campaigns.map((c) => ({ id: c.id, name: `${c.code} · ${c.name}` }))}
                      none="All campaigns"
                    />
                    <PickField
                      id="course"
                      label="Course"
                      value={m.dashboard.course}
                      options={courses}
                      none="All courses"
                    />
                    <PickField
                      id="calendarView"
                      label="Calendar opens in"
                      value={m.calendarView}
                      options={optionsOf(VIEW_LABELS)}
                    />
                  </div>
                </Card>
                <Card
                  title="Working hours and focus blocks"
                  description="Your own plan for the week, in IST. It does not move any deadline."
                >
                  <div className="el-grid">
                    <Field id="workStart" label="Work starts">
                      <TextInput
                        id="workStart"
                        name="workStart"
                        type="time"
                        defaultValue={m.workingHours?.start}
                      />
                    </Field>
                    <Field id="workEnd" label="Work ends">
                      <TextInput
                        id="workEnd"
                        name="workEnd"
                        type="time"
                        defaultValue={m.workingHours?.end}
                      />
                    </Field>
                  </div>
                  <fieldset className="el-inline-form">
                    <legend>Working days</legend>
                    {WEEKDAYS.map((d) => (
                      <Checkbox
                        key={d}
                        name="days"
                        value={d}
                        label={DAY_LABELS[d]}
                        defaultChecked={m.workingHours?.days.includes(d)}
                      />
                    ))}
                  </fieldset>
                  {focus.map((b, i) => (
                    <fieldset key={i} className="el-grid">
                      <legend>Focus block {i + 1}</legend>
                      <PickField
                        id={`focus${i}Day`}
                        label="Day"
                        value={b?.day}
                        options={optionsOf(DAY_LABELS)}
                      />
                      <Field id={`focus${i}Start`} label="From">
                        <TextInput
                          id={`focus${i}Start`}
                          name={`focus${i}Start`}
                          type="time"
                          defaultValue={b?.start}
                        />
                      </Field>
                      <Field id={`focus${i}End`} label="To">
                        <TextInput
                          id={`focus${i}End`}
                          name={`focus${i}End`}
                          type="time"
                          defaultValue={b?.end}
                        />
                      </Field>
                      <Field id={`focus${i}Label`} label="What for">
                        <TextInput
                          id={`focus${i}Label`}
                          name={`focus${i}Label`}
                          maxLength={80}
                          defaultValue={b?.label}
                          placeholder="Script writing"
                        />
                      </Field>
                    </fieldset>
                  ))}
                  <p className="el-field-hint">
                    Leave a block&apos;s times empty to remove it. Up to {FOCUS_MAX} blocks.
                  </p>
                </Card>
                <Card
                  title="Notifications"
                  description="Reminders and pop-up notices are not sent yet; your choice is kept for when they are."
                >
                  <div className="el-grid">
                    <PickField
                      id="reminder"
                      label="Extra reminders about my open tasks"
                      value={p.notifications.reminderIntervalHours?.toString() ?? ''}
                      options={optionsOf(REMINDER_LABELS)}
                      hint="Reminders HR requires are always sent on HR's schedule, whatever you choose here."
                    />
                  </div>
                  <Checkbox
                    name="popUps"
                    label="Show a short notice when I open a page and something new has arrived"
                    defaultChecked={p.notifications.popUps}
                  />
                </Card>
                <Card
                  title="My checklist and goals"
                  description="Private notes for yourself. Goals are not targets: HR and your manager set targets."
                >
                  {checklist.map((c, i) => (
                    <div key={i} className="el-inline-form">
                      <Checkbox
                        name={`item${i}Done`}
                        label="Done"
                        defaultChecked={c?.done}
                        aria-label={`Item ${i + 1} done`}
                      />
                      <Field id={`item${i}`} label={`Item ${i + 1}`}>
                        <TextInput
                          id={`item${i}`}
                          name={`item${i}`}
                          maxLength={120}
                          defaultValue={c?.label}
                        />
                      </Field>
                    </div>
                  ))}
                  <Field
                    id="goals"
                    label="Personal goals (one per line)"
                    hint={`Optional, up to ${GOALS_MAX}.`}
                  >
                    <TextArea id="goals" name="goals" rows={4} defaultValue={m.goals.join('\n')} />
                  </Field>
                </Card>
                <div className="el-inline-form">
                  <Button type="submit">Save personal settings</Button>
                  <span className="el-field-hint">
                    {p.updatedAt ? `Last saved ${formatIst(p.updatedAt)}.` : 'Not saved yet.'}
                  </span>
                </div>
              </form>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
