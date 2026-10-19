'use server';

import {
  addComment,
  addVersion,
  archiveContentItem,
  createPlacement,
  decideContent,
  setAssignment,
  submitForReview,
  versionBody,
  withdrawFromReview,
} from '../../server';
import { go, run, str, strs } from './common';

const back = (id: string) => `content/${id}`;

export async function addVersionAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const assetName = str(form, 'assetFileName');
  const parsed = versionBody.safeParse({
    title: str(form, 'title'),
    body: (form.get('body') as string | null) ?? '',
    showsStudents: form.get('showsStudents') === 'on',
    consentReference: str(form, 'consentReference') ?? null,
    changeNote: str(form, 'changeNote') ?? null,
    assets: assetName
      ? [
          {
            fileName: assetName,
            mimeType: str(form, 'assetMimeType') ?? 'application/octet-stream',
            externalUrl: str(form, 'assetUrl') ?? null,
            showsStudents: form.get('assetShowsStudents') === 'on',
            rightsState: str(form, 'assetRights') ?? 'own',
          },
        ]
      : [],
  });
  if (!parsed.success)
    go(back(id), {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  const res = await run((db, user) => addVersion(db, user, id, parsed.data));
  if (!res.ok) go(back(id), { error: res.error });
  go(back(id), {
    notice: res.value.approvalVoided
      ? `Version ${res.value.version.versionNumber} saved. The previous approval no longer applies; the item is back in review.`
      : `Version ${res.value.version.versionNumber} saved.`,
  });
}

export async function submitAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const res = await run((db, user) => submitForReview(db, user, id, str(form, 'comment') ?? null));
  if (!res.ok) go(back(id), { error: res.error });
  const blocks = res.value.ruleCheck.blocking.length;
  go(back(id), {
    notice: `Submitted for review.${blocks ? ` ${blocks} blocking flag(s) must be fixed before it can be approved.` : ''}`,
  });
}

export async function withdrawAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const res = await run((db, user) => withdrawFromReview(db, user, id));
  if (!res.ok) go(back(id), { error: res.error });
  go(back(id), { notice: 'Withdrawn to draft.' });
}

export async function decideAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const decision = str(form, 'decision') === 'approve' ? 'approve' : 'request_changes';
  const res = await run((db, user) =>
    decideContent(db, user, id, {
      decision,
      comment: str(form, 'comment'),
      acknowledgedRuleCodes: strs(form, 'ack'),
    }),
  );
  if (!res.ok) go(back(id), { error: res.error });
  go(back(id), {
    notice: decision === 'approve' ? 'Approved this version.' : 'Changes requested.',
  });
}

export async function archiveAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const res = await run((db, user) => archiveContentItem(db, user, id, str(form, 'reason') ?? ''));
  if (!res.ok) go(back(id), { error: res.error });
  go(back(id), { notice: 'Archived.' });
}

export async function commentAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const res = await run((db, user) => addComment(db, user, id, { body: str(form, 'body') ?? '' }));
  if (!res.ok) go(back(id), { error: res.error });
  go(back(id), { notice: 'Comment added.' });
}

export async function assignAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const role = str(form, 'role') as 'writer' | 'designer' | 'editor' | 'presenter';
  const res = await run((db, user) =>
    setAssignment(db, user, id, {
      role,
      userId: str(form, 'userId') ?? null,
      staffMemberId: str(form, 'staffMemberId') ?? null,
    }),
  );
  if (!res.ok) go(back(id), { error: res.error });
  go(back(id), { notice: `Assignment for ${role} saved.` });
}

export async function createPlacementAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const variant = str(form, 'variant');
  const res = await run((db, user) =>
    createPlacement(db, user, id, {
      accountCode: (str(form, 'accountCode') ?? '').toUpperCase(),
      variant: variant === 'short' || variant === 'long' ? variant : null,
    }),
  );
  if (!res.ok) go(back(id), { error: res.error });
  const w = res.value.warnings.map((x) => x.message).join(' ');
  go(back(id), {
    notice: `Placement ${res.value.placement.code} planned.${w ? ` Note: ${w}` : ''}`,
  });
}
