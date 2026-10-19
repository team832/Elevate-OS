'use server';

import {
  cancelPlacement,
  createCampaign,
  createCampaignBody,
  importMetricsBody,
  importMetricsCsv,
  publishPlacement,
  recordManualPublication,
  schedulePlacement,
  setPlacementCampaign,
  unschedulePlacement,
} from '../../server';
import { go, run, str } from './common';

const back = (form: FormData) => str(form, 'returnTo') ?? 'calendar';

/** `datetime-local` values are entered in IST. */
function istLocalToIso(local: string | undefined): string | undefined {
  if (!local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return undefined;
  return new Date(`${local}:00+05:30`).toISOString();
}

export async function scheduleAction(form: FormData): Promise<void> {
  const id = str(form, 'placementId') ?? '';
  const publishAt = istLocalToIso(str(form, 'publishAt'));
  if (!publishAt) go(back(form), { error: 'Enter a publish date and time (IST).' });
  const res = await run((db, user) => schedulePlacement(db, user, id, { publishAt }));
  if (!res.ok) go(back(form), { error: res.error });
  const w = res.value.warnings.map((x) => x.message).join(' ');
  go(back(form), { notice: `Scheduled ${res.value.placement.code}.${w ? ` Warnings: ${w}` : ''}` });
}

export async function unscheduleAction(form: FormData): Promise<void> {
  const res = await run((db, user) =>
    unschedulePlacement(db, user, str(form, 'placementId') ?? ''),
  );
  if (!res.ok) go(back(form), { error: res.error });
  go(back(form), { notice: `Unscheduled ${res.value.code}.` });
}

export async function cancelPlacementAction(form: FormData): Promise<void> {
  const res = await run((db, user) =>
    cancelPlacement(db, user, str(form, 'placementId') ?? '', str(form, 'reason') ?? 'Cancelled'),
  );
  if (!res.ok) go(back(form), { error: res.error });
  go(back(form), { notice: `Cancelled ${res.value.code}.` });
}

export async function publishAction(form: FormData): Promise<void> {
  const res = await run((db, user) => publishPlacement(db, user, str(form, 'placementId') ?? ''));
  if (!res.ok) go(back(form), { error: res.error });
  if (res.value.outcome === 'failed')
    go(back(form), { error: `Publish attempt failed: ${res.value.message}` });
  go(back(form), { notice: res.value.message });
}

export async function manualPublicationAction(form: FormData): Promise<void> {
  const publishedAt = istLocalToIso(str(form, 'publishedAt'));
  const url = str(form, 'url');
  if (!publishedAt || !url)
    go(back(form), { error: 'Both the actual publish time and the live link are required.' });
  const res = await run((db, user) =>
    recordManualPublication(db, user, str(form, 'placementId') ?? '', { publishedAt, url }),
  );
  if (!res.ok) go(back(form), { error: res.error });
  go(back(form), { notice: `Recorded publication of ${res.value.placement.code}.` });
}

export async function setCampaignAction(form: FormData): Promise<void> {
  const res = await run((db, user) =>
    setPlacementCampaign(db, user, str(form, 'placementId') ?? '', str(form, 'campaignId') ?? null),
  );
  if (!res.ok) go(back(form), { error: res.error });
  go(back(form), { notice: 'Campaign updated.' });
}

export async function createCampaignAction(form: FormData): Promise<void> {
  const parsed = createCampaignBody.safeParse({
    code: str(form, 'code'),
    name: str(form, 'name'),
    objective: str(form, 'objective') ?? null,
    startsOn: str(form, 'startsOn') ?? null,
    endsOn: str(form, 'endsOn') ?? null,
    status: str(form, 'status') ?? 'draft',
  });
  if (!parsed.success)
    go('campaigns', { error: parsed.error.issues.map((i) => i.message).join('; ') });
  const res = await run((db, user) => createCampaign(db, user, parsed.data));
  if (!res.ok) go('campaigns', { error: res.error });
  go('campaigns', { notice: `Campaign ${res.value.code} created.` });
}

export async function importMetricsAction(form: FormData): Promise<void> {
  const file = form.get('file');
  const csv = file instanceof File && file.size > 0 ? await file.text() : (str(form, 'csv') ?? '');
  const fileName =
    file instanceof File && file.size > 0 ? file.name : (str(form, 'fileName') ?? 'pasted.csv');
  const capturedAt = istLocalToIso(str(form, 'capturedAt'));
  const parsed = importMetricsBody.safeParse({
    accountCode: str(form, 'accountCode'),
    fileName,
    csv,
    dateFormat: str(form, 'dateFormat'),
    capturedAt,
    dryRun: form.get('dryRun') === 'on',
  });
  if (!parsed.success)
    go('metrics/import', {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  const res = await run((db, user) => importMetricsCsv(db, user, parsed.data));
  if (!res.ok) go('metrics/import', { error: res.error });
  const r = res.value;
  const summary = `${r.dryRun ? 'Dry run' : r.duplicate ? 'Already imported (no change)' : 'Imported'}: ${r.rowsAccepted} accepted, ${r.rowsRejected} rejected, ${r.rowsSkipped} skipped; matched by link ${r.matchCounts.matched_link}, suggested ${r.matchCounts.suggested_title_date}, unmatched ${r.matchCounts.unmatched}.`;
  const rejected = r.rejected
    .slice(0, 10)
    .map((x) => `row ${x.rowNumber}: ${x.reasons.join(' ')}`)
    .join(' | ');
  if (r.rowsRejected)
    go('metrics/import', { notice: summary, error: `Rejected rows — ${rejected}` });
  go('metrics/import', { notice: summary });
}
